/**
 * ============================================================================
 *  AUTH ROUTER (specification sections 1, 7, 9, 18, 20, 21, 23)
 * ============================================================================
 *
 *  Mounted at /api/auth. Five endpoints, and every one of them is a real
 *  operation - the Sign in / Sign up buttons in the UI call these rather than
 *  toggling local state.
 *
 *    POST /api/auth/request-token   email -> a code is emailed
 *    POST /api/auth/verify-token    email + code -> a session cookie
 *    POST /api/auth/signup          register a new business and its owner
 *    POST /api/auth/logout          revoke the session
 *    GET  /api/auth/me              who am I, and which business
 *
 *  WHAT NEVER APPEARS IN A RESPONSE
 *  --------------------------------
 *  the login code, the stored hash, the session record, another business's
 *  data, or the caller's `businessId` - which the client has no need to know
 *  and must not be trusted with.
 */

import { Router, type Request, type Response } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { PACKAGE_PRICES } from "../../src/platform/packages";
import { emptyLedger } from "../../src/platform/billing";
import {
  buildMallPlacement,
  findRoomConflicts,
  formatRoomNumbers,
  parseRoomNumbers,
} from "../../src/platform/malls";
import type { Business, PackageId, RentalApplication, Subscription } from "../../src/platform/types";
import { allRentalApplications } from "../rental/store";
import { SESSION_COOKIE } from "./types";
import type { User, UserRole } from "./types";
import { toPublicUser } from "./types";
import { GENERIC_RESET_FAILED_MESSAGE, GENERIC_RESET_SENT_MESSAGE } from "./types";
import { completePasswordReset, requestPasswordReset } from "./passwordReset";
import {
  checkPasswordPolicy,
  hashPassword,
  isValidUsername,
  loginCodeSecret,
  needsRehash,
  normalizeUsername,
  verifyPassword,
} from "./crypto";
import { googleClientId, googleConfigured, verifyGoogleIdToken, verifyYotiScan, yotiConfigured } from "./identity";
import {
  GENERIC_CODE_FAILED_MESSAGE,
  GENERIC_CODE_SENT_MESSAGE,
  TOO_MANY_TOKENS_MESSAGE,
  hideTokenLimit,
  requestLoginCode,
  verifyLoginCodeAndOpenSession,
} from "./tokens";
import {
  clearSessionCookie,
  createSession,
  publicUser,
  resolveAuthContext,
  revokeAllForUser,
  revokeSession,
  setSessionCookie,
  sweepSessions,
} from "./sessions";
import {
  allUsers,
  isValidEmail,
  normalizeEmail,
  persistUsers,
  userByEmail,
  userByGoogleSub,
  userByUsername,
  usernameTaken,
} from "./store";
import { allBusinesses, allMalls, businessById, mallByIdOrName, persist, saveSubscription, seedMalls } from "../platform/store";

export const authRouter = Router();

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function clientIp(req: Request): string | null {
  return req.ip || req.socket.remoteAddress || null;
}

function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ error: message });
}


// ---------------------------------------------------------------------------
// 1. Request a login code
// ---------------------------------------------------------------------------

/**
 * Section 7 + 8.
 *
 * The response is the same shape for a known and an unknown email. The ONLY
 * exception is Section 4's token-limit error, which is documented in
 * tokens.ts and can be suppressed with AUTH_HIDE_TOKEN_LIMIT=true.
 */
authRouter.post("/request-token", async (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const email = String((req.body ?? {}).email ?? "");

  const outcome = await requestLoginCode(email, clientIp(req));

  // `outcome.ok === false` rather than `!outcome.ok`: this project runs with
  // strictNullChecks OFF (no `"strict"` in tsconfig), and without it TypeScript
  // does not narrow a boolean-literal discriminant by truthiness. An explicit
  // comparison narrows correctly. Verified on TypeScript 5.8.3.
  if (outcome.ok === false) {
    if (outcome.reason === "too-many" && !hideTokenLimit()) {
      // Section 4, verbatim.
      return res.status(429).json({ success: false, error: TOO_MANY_TOKENS_MESSAGE });
    }
    if (outcome.reason === "rate-limited") {
      return res
        .status(429)
        .json({ success: false, error: "Too many requests. Please wait before trying again." });
    }
    // Section 8: identical to the success message. An unknown address looks
    // exactly like a known one whose email failed to send.
    return res.status(200).json({ success: true, message: GENERIC_CODE_SENT_MESSAGE });
  }

  return res.status(200).json({
    success: true,
    message: GENERIC_CODE_SENT_MESSAGE,
    expiresAt: outcome.expiresAt,
  });
});

// ---------------------------------------------------------------------------
// 2. Verify the code and open a session
// ---------------------------------------------------------------------------

authRouter.post("/verify-token", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as { email?: string; token?: string };
  const outcome = verifyLoginCodeAndOpenSession(
    String(body.email ?? ""),
    String(body.token ?? "").replace(/\s+/g, ""),
    clientIp(req),
  );

  if (outcome.ok === false) {
    // Section 9: one message for every failure mode.
    return res.status(400).json({ success: false, error: GENERIC_CODE_FAILED_MESSAGE });
  }

  setSessionCookie(res, outcome.sessionId, SESSION_COOKIE);
  return res.status(200).json({
    success: true,
    message: "Authentication successful",
    user: publicUser(outcome.user),
  });
});


// ---------------------------------------------------------------------------
// 3. Sign up a new business
// ---------------------------------------------------------------------------

/**
 * Section 10: a business rents a store.
 *
 * Creates the Business (status Trial), a Trial subscription, and the owner
 * User whose email is the login. The owner signs in through the SAME
 * email-token flow - there is no second, weaker auth path for new accounts.
 *
 * The subdomain is derived from the business name and de-duplicated, so two
 * businesses both called "ABC Fashion" still get a working URL.
 *
 * EXPORTED because the rental approval path provisions a store too, and two
 * copies of the de-duplication rule would eventually disagree about what a
 * taken subdomain is.
 */
export function subdomainFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "store";
  const taken = new Set(allBusinesses().map((business) => business.subdomain));
  if (!taken.has(`${base}.yene-store.com`)) return `${base}.yene-store.com`;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = `${base}${attempt}.yene-store.com`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${randomBytes(3).toString("hex")}.yene-store.com`;
}

/**
 * Has this email got an APPROVED rental application?
 *
 * The single place the sign-up gate consults, so the rule is stated once. An
 * approved application is what grants a mall counter - a sign-up on its own
 * never does, and a pending one is not enough.
 *
 * Matched on the applicant's own email, which is the same address sign-up
 * collects, so an approval carries across to the store registration without the
 * applicant having to explain the connection.
 */
function approvedRentalFor(email: string | null | undefined): RentalApplication | null {
  const wanted = normalizeEmail(String(email ?? ""));
  if (!wanted) return null;
  return (
    allRentalApplications().find(
      (application) =>
        application.status === "approved" &&
        application.email.trim().toLowerCase() === wanted,
    ) ?? null
  );
}

authRouter.post("/signup", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as {
    businessName?: string;
    email?: string;
    phone?: string;
    location?: string;
    packageId?: PackageId;
    type?: "standalone" | "mall";
    /** Mall id from the picker, or the typed name. Resolved server-side. */
    mall?: string;
    /** Kept for the older client, which sent the name in its own field. */
    mallName?: string;
    floor?: string;
    /** Accepts an array, or one field with separators. See parseRoomNumbers. */
    rooms?: string[] | string;
    roomNumber?: string;
  };
  const businessName = String(body.businessName ?? "").trim().slice(0, 80);
  const email = normalizeEmail(String(body.email ?? ""));
  const packageId: PackageId = body.packageId ?? "silver";

  if (businessName.length < 2) return badRequest(res, "Enter your business name.");
  if (!isValidEmail(email)) return badRequest(res, "Enter a valid email address.");
  if (!["silver", "gold", "platinum", "super"].includes(packageId)) {
    return badRequest(res, "Choose a valid package.");
  }
  if (userByEmail(email)) {
    // Sign-up must not become an account-existence oracle either.
    return res.status(409).json({
      error: "We could not create that account. If you already have one, sign in instead.",
    });
  }

  // -------------------------------------------------------------------------
  // Section 41: a mall store is filed under a mall that ALREADY EXISTS.
  //
  // The mall is resolved against the directory here, never taken from the body.
  // Accepting a typed name verbatim would let anyone invent a mall by signing
  // up, and would let one seller file a store under a mall while the directory
  // showed a different name for it.
  // -------------------------------------------------------------------------
  seedMalls();
  const mallWanted = body.mall ?? body.mallName ?? "";
  const mall = body.type === "mall" ? mallByIdOrName(mallWanted) : null;
  const rooms = parseRoomNumbers(body.rooms ?? body.roomNumber);

  if (body.type === "mall" && !mall) {
    return res.status(400).json({
      error:
        "Choose a mall from the list. If your mall is not listed, contact Yene " +
        "Business Group so it can be added.",
      malls: allMalls().map((entry) => ({ id: entry.id, name: entry.name, city: entry.city })),
    });
  }

  // -------------------------------------------------------------------------
  // THE GATE. A mall counter cannot be taken by signing up.
  //
  // This route is the one that creates a business and its owner, and until now
  // it did so for anyone who typed a business name - which meant the whole
  // rental feature could be bypassed by using the sign-up form instead of
  // applying. `api/verify/store.ts` has always stated the rule; this is where it
  // is enforced.
  //
  // A person without an approved application is sent to apply for the counter
  // they actually want, because an application is what carries the name and
  // phone number the approval is matched against. Refusing here is therefore
  // not a dead end, it is the correct route.
  // -------------------------------------------------------------------------
  if (body.type === "mall") {
    const approved = approvedRentalFor(body.email);
    if (!approved) {
      return res.status(403).json({
        error:
          "A mall counter must be approved before you can trade from it. " +
          "Choose the mall, floor and shop number you want and send us a rental request.",
        nextStep: "rental-application",
        requiresApproval: true,
      });
    }
  }

  // A counter belongs to one store. Two sellers claiming the same room is the
  // failure a free-text placement field would have allowed, so it is refused
  // here rather than discovered later.
  if (mall && rooms.length > 0) {
    const clashes = findRoomConflicts(allBusinesses(), mall, rooms);
    if (clashes.length > 0) {
      return res.status(409).json({
        error: `${formatRoomNumbers(clashes)} ${clashes.length === 1 ? "is" : "are"} already registered in ${mall.name}. Please choose another room.`,
      });
    }
  }

  const id = `biz-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const business: Business = {
    id,
    name: businessName,
    type: body.type === "mall" ? "mall" : "standalone",
    mall:
      body.type === "mall"
        ? buildMallPlacement({
            mall,
            requestedName: mallWanted,
            floor: body.floor,
            rooms,
            // A self-registered mall store has no agreement of its own, so
            // Section 41 does NOT grant it a free subdomain. A mall covered by
            // a YENE-STORE agreement passes that agreement through.
            agreementId: mall?.agreementId ?? null,
          })
        : null,
    subdomain: subdomainFor(businessName),
    status: "Trial",
    packageId,
    trustedSeller: false,
    location: String(body.location ?? "").trim() || "Addis Ababa",
    rating: 0,
    createdAt: now,
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName,
      description: "",
      businessInformation: "",
      theme: "yene",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [],
      contact: {
        phone: String(body.phone ?? "").trim(),
        email,
        address: String(body.location ?? "").trim(),
      },
      policies: { returns: "", shipping: "", terms: "", privacy: "" },
      delivery: { options: [], freeAbove: null },
      paymentOptions: ["Cash on delivery"],
    },
  };


  const subscription: Subscription = {
    businessId: id,
    packageId,
    status: "Trial",
    startedAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autoRenew: false,
    pendingChange: null,
    lastUpgradeAmount: 0,
  };

  const owner: User = {
    id: `usr-${id}`,
    email,
    name: businessName,
    // The tenant travels with the user record. This is the ONLY place a
    // businessId is ever written for a new account.
    businessId: id,
    role: "owner" as UserRole,
    active: true,
    createdAt: now,
  };

  allBusinesses().push(business);
  allUsers().push(owner);
  persist.businesses();
  persistUsers();
  saveSubscription(subscription, emptyLedger());

  return res.status(201).json({
    success: true,
    message: "Your store is ready. Sign in with your email to continue.",
    business: { id: business.id, name: business.name, subdomain: business.subdomain },
    packagePrice: PACKAGE_PRICES[packageId],
    nextStep: "Sign in to receive your verification code.",
  });
});

// ---------------------------------------------------------------------------
// 3b. Sign in with a username or email + password
// ---------------------------------------------------------------------------

/**
 * Per-identifier failure counter, so guessing one password is slow rather than
 * limited only by the coarse per-IP limit. The key is the SUBMITTED identifier
 * hashed, so the map never holds an email address in memory.
 */
const passwordFailures = new Map<string, { count: number; lockedUntil: number }>();
const PASSWORD_LOCK_THRESHOLD = 8;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;

function failureKey(identifier: string): string {
  return createHmac("sha256", loginCodeSecret())
    .update(identifier.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

function lockedOut(identifier: string): boolean {
  const key = failureKey(identifier);
  const entry = passwordFailures.get(key);
  if (!entry) return false;
  if (entry.lockedUntil <= Date.now()) {
    passwordFailures.delete(key);
    return false;
  }
  return true;
}

function notePasswordFailure(identifier: string): void {
  const key = failureKey(identifier);
  const entry = passwordFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= PASSWORD_LOCK_THRESHOLD) entry.lockedUntil = Date.now() + PASSWORD_LOCK_MS;
  passwordFailures.set(key, entry);
}

function clearPasswordFailures(identifier: string): void {
  passwordFailures.delete(failureKey(identifier));
}

/** One message for "no such account" and "wrong password". Always. */
const GENERIC_PASSWORD_MESSAGE = "That email/username and password combination is not correct.";

authRouter.post("/signin", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as { identifier?: string; password?: string };
  const identifier = String(body.identifier ?? "").trim();
  const password = String(body.password ?? "");

  if (!identifier || !password) {
    return badRequest(res, "Enter your email or username and your password.");
  }
  if (lockedOut(identifier)) {
    return res
      .status(429)
      .json({ error: "Too many failed attempts. Please wait 15 minutes and try again." });
  }

  // A username never contains '@', so the two namespaces are tried in turn.
  const user = identifier.includes("@") ? userByEmail(identifier) : userByUsername(identifier);

  // `verifyPassword` runs against a dummy hash when the user is absent, so a
  // missing account and a wrong password cost the same time and memory.
  const ok = verifyPassword(password, user?.passwordHash);

  if (!user || !ok || !user.active) {
    notePasswordFailure(identifier);
    return res.status(401).json({ success: false, error: GENERIC_PASSWORD_MESSAGE });
  }

  clearPasswordFailures(identifier);

  // Transparently upgrade a hash written under weaker parameters.
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    user.passwordHash = hashPassword(password);
    persistUsers();
  }

  const session = createSession(user.id, clientIp(req), req.headers["user-agent"] ?? null);
  setSessionCookie(res, session.id, SESSION_COOKIE);
  return res.status(200).json({
    success: true,
    message: "Signed in.",
    user: toPublicUser(user),
  });
});

// ---------------------------------------------------------------------------
// 3e. Forgot password, and reset it
// -------------------------------------------------------------------------
//
// Two real operations, not a UI toggle. `/forgot-password` NEVER reveals
// whether the address is registered: the response body and the status code are
// identical for a known account, an unknown one and a malformed one. Only the
// rate limit produces a different answer, and that is keyed on the address, so
// it discloses nothing about whether the address exists.
//
// The token is never in either response - it exists only in the email, and
// only as a keyed hash on disk.

authRouter.post("/forgot-password", async (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const email = String((req.body ?? {}).email ?? "");

  const outcome = await requestPasswordReset(email, clientIp(req));

  if (outcome.ok === false && outcome.reason === "rate-limited") {
    return res
      .status(429)
      .json({ success: false, error: "Too many requests. Please wait before trying again." });
  }

  // The generic message, verbatim, for every address - known, unknown, or
  // deactivated. Status 200 in all three cases.
  return res.status(200).json({ success: true, message: GENERIC_RESET_SENT_MESSAGE });
});

authRouter.post("/reset-password", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as { token?: string; password?: string };
  const outcome = completePasswordReset(
    String(body.token ?? "").trim(),
    String(body.password ?? ""),
    clientIp(req),
  );

  if (outcome.ok === false) {
    // A weak password is the one failure the user can act on, so it says what
    // is wrong. Everything else - unknown, expired, used, over the attempt
    // limit - gets the identical refusal, so a stolen link cannot be probed to
    // learn whether it was ever genuine.
    if (outcome.reason === "weak-password") {
      return badRequest(res, outcome.message ?? "Choose a stronger password.");
    }
    return res.status(400).json({ success: false, error: GENERIC_RESET_FAILED_MESSAGE });
  }

  // Deliberately NOT signing in here. Every session was just revoked on purpose,
  // and quietly minting a new one would undo that: the point of the reset is
  // that the person holding the link proves they can set the password, then
  // signs in themselves.
  return res.status(200).json({
    success: true,
    message: "Your password has been reset. Sign in with your new password.",
    user: toPublicUser(outcome.user),
  });
});

// ---------------------------------------------------------------------------
// 3c. Register a CUSTOMER (no business yet)
// ---------------------------------------------------------------------------

/**
 * Sign-up is open to any customer, exactly as specified. It creates a user with
 * `role: "customer"` and NO businessId - renting a store is a separate, gated
 * step that requires the identity profile to be verified first.
 */
authRouter.post("/register", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(String(body.email ?? ""));
  const username = normalizeUsername(String(body.username ?? ""));
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 120);

  if (!isValidEmail(email)) return badRequest(res, "Enter a valid email address.");
  if (!isValidUsername(username)) {
    return badRequest(
      res,
      "Username must be 3-30 characters, start with a letter, and use letters, digits, dot, underscore or hyphen.",
    );
  }
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return badRequest(res, policy.message ?? "Choose a stronger password.");
  if (name.length < 2) return badRequest(res, "Enter your full name.");

  if (userByEmail(email)) {
    return res
      .status(409)
      .json({ error: "We could not create that account. If you already have one, sign in instead." });
  }
  if (usernameTaken(username)) {
    return res.status(409).json({ error: "That username is already taken. Please choose another." });
  }

  const now = new Date().toISOString();
  const user: User = {
    id: `usr-${randomBytes(5).toString("hex")}`,
    email,
    username,
    name,
    // A customer has no tenant. It is assigned only when a store is rented.
    businessId: null,
    role: "customer",
    active: true,
    createdAt: now,
    passwordHash: hashPassword(password),
    identityProvider: "password",
    // Sign-up never grants rental rights. Only the verification flow can.
    storeRentalApproved: false,
  };

  allUsers().push(user);
  persistUsers();

  const session = createSession(user.id, clientIp(req), req.headers["user-agent"] ?? null);
  setSessionCookie(res, session.id, SESSION_COOKIE);

  return res.status(201).json({
    success: true,
    message: "Welcome to YENE-STORE. Complete your profile to rent a store.",
    user: toPublicUser(user),
  });
});

// ---------------------------------------------------------------------------
// 3d. Sign in with Google
// ---------------------------------------------------------------------------

/** Which federated providers this deployment can actually use. */
authRouter.get("/providers", (_req: Request, res: Response) => {
  return res.status(200).json({
    google: googleConfigured(),
    googleClientId: googleClientId(),
    yoti: yotiConfigured(),
  });
});


authRouter.post("/google", async (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  const body = (req.body ?? {}) as { idToken?: string };
  const result = await verifyGoogleIdToken(String(body.idToken ?? ""));

  if (result.ok === false) {
    const status = result.configured ? 401 : 503;
    return res.status(status).json({ success: false, error: result.error });
  }

  const profile = result.profile;

  // The account key is Google's stable `sub`, never the email. Matching on
  // email alone would let anyone who registers the same address at Google claim
  // an existing local account.
  let user = userByGoogleSub(profile.sub);
  let created = false;

  if (!user) {
    // Google has just proved control of this address, so linking an existing
    // local account is safe here in a way the password routes cannot claim. The
    // account keeps its own role, business and rental approval.
    user = userByEmail(profile.email);
  }

  if (!user) {
    user = {
      id: `usr-${randomBytes(5).toString("hex")}`,
      email: profile.email,
      name: profile.name ?? profile.email.split("@")[0],
      // A federated login never grants a tenant, a role or rental rights.
      businessId: null,
      role: "customer",
      active: true,
      createdAt: new Date().toISOString(),
      googleSub: profile.sub,
      identityProvider: "google",
      storeRentalApproved: false,
    };
    allUsers().push(user);
    created = true;
  } else if (!user.googleSub) {
    user.googleSub = profile.sub;
    user.identityProvider = "google";
  }

  persistUsers();

  const session = createSession(user.id, clientIp(req), req.headers["user-agent"] ?? null);
  setSessionCookie(res, session.id, SESSION_COOKIE);

  return res.status(200).json({
    success: true,
    message: created ? "Welcome to YENE-STORE." : "Signed in.",
    created,
    user: toPublicUser(user),
  });
});

// ---------------------------------------------------------------------------
// 3f. Attach a Yoti ID check to the signed-in account
// ---------------------------------------------------------------------------

authRouter.post("/yoti", async (req: Request, res: Response) => {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) return res.status(401).json({ error: "Please sign in first." });

  const body = (req.body ?? {}) as { payloadToken?: string };
  const result = await verifyYotiScan(String(body.payloadToken ?? ""));
  const user = allUsers().find((entry) => entry.id === context.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });

  if (!result.configured) {
    return res.status(503).json({
      success: false,
      error: "Yoti ID verification is not configured on this server. Set YOTI_API_KEY to enable it.",
    });
  }

  // Only a reference Yoti actually returned is stored. A failed or empty
  // response leaves the account untouched - it never records a Yoti check that
  // did not happen.
  if (!result.reference) {
    return res
      .status(400)
      .json({ success: false, error: "Yoti could not confirm that check. Please try again." });
  }

  user.yotiReference = result.reference;
  if (result.verifiedName && !user.yotiVerifiedName) user.yotiVerifiedName = result.verifiedName;
  persistUsers();

  return res.status(200).json({ success: true, user: toPublicUser(user) });
});

// ---------------------------------------------------------------------------
// 4. Who am I
// ---------------------------------------------------------------------------

authRouter.get("/me", (req: Request, res: Response) => {
  sweepSessions();
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) return res.status(200).json({ authenticated: false });

  const business = context.businessId ? businessById(context.businessId) : null;
  // Re-read the user so the newly added fields (username, provider, rental
  // approval) are reported. The context is the authority for WHO is calling;
  // the record is the authority for WHAT is true about them.
  const user = allUsers().find((entry) => entry.id === context.userId);

  return res.status(200).json({
    authenticated: true,
    // `toPublicUser` is the only projection used here, so `passwordHash` and
    // every other secret can never reach the browser through this route.
    user: user
      ? toPublicUser(user)
      : { id: context.userId, name: context.name, email: context.email, role: context.role },
    // Resolved server-side and shown read-only. The client sends nothing back.
    business: business
      ? {
          id: business.id,
          name: business.name,
          subdomain: business.subdomain,
          status: business.status,
          packageId: business.packageId,
        }
      : null,
    isSuperAdmin: context.isSuperAdmin,
  });
});

// ---------------------------------------------------------------------------
// 5. Logout
// ---------------------------------------------------------------------------

authRouter.post("/logout", (req: Request, res: Response) => {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (context) revokeSession(context.sessionId);
  clearSessionCookie(res, SESSION_COOKIE);
  // Revoking every device is the safer default on a shared computer.
  if (context && process.env.AUTH_LOGOUT_ALL_DEVICES === "true") {
    revokeAllForUser(context.userId);
  }
  return res.status(200).json({ success: true, message: "Signed out." });
});

