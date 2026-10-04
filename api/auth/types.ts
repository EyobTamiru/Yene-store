/**
 * ============================================================================
 *  EMAIL-TOKEN AUTHENTICATION - TYPES AND RULES
 * ============================================================================
 *
 *  Additive to the existing platform. Nothing here replaces Sections 1-9
 *  (Yene AI Support) or Sections 10-55 (the platform); it supplies the real
 *  identity those systems have so far only been able to fake in development.
 *
 *  WHAT EXISTED BEFORE THIS FILE
 *  -----------------------------
 *  `api/support/auth.ts` and `api/platform/auth.ts` each resolved a caller from
 *  an `Authorization: Bearer` token against a hard-coded `dev:*` map, and
 *  returned a GUEST for anything else. In production that meant every
 *  tenant-scoped route was closed - safe, but unusable.
 *
 *  There was no User record, no session, no cookie and no email provider in
 *  the project. The hits for "session" in `api/support/tickets.ts` are AI chat
 *  transcripts, a different concept entirely, and are untouched.
 *
 *  THE THREE INVARIANTS
 *  ---------------------
 *  1. THE FRONTEND NEVER CHOOSES A BUSINESS (Section 10).
 *     No request body, query string or header can set `businessId`. A session
 *     stores only a `userId`; `businessId` is resolved from the user record on
 *     every request. There is no code path where a caller supplies one.
 *
 *  2. THE PLAIN CODE NEVER REACHES STORAGE (Sections 2, 16).
 *     We keep an HMAC-SHA256 hash under a server secret, not a bare SHA-256.
 *     A 6-digit code has only 900,000 possible values, so an unsalted hash is
 *     trivially reversible by anyone who reads the file - the secret is what
 *     makes that expensive.
 *
 *  3. AN ATTACKER LEARNS NOTHING ABOUT WHO HAS AN ACCOUNT (Section 8).
 *     `request-token` returns one message for every input.
 */

// ---------------------------------------------------------------------------
// Limits - every one of these is a specification number
// ---------------------------------------------------------------------------

/** Section 3: a login code expires after 10 minutes. */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;

/** Section 2: a 6-digit numeric code. */
export const LOGIN_CODE_DIGITS = 6;
export const LOGIN_CODE_MIN = 100_000;
export const LOGIN_CODE_MAX = 1_000_000;

/** Section 4: at most 8 UNEXPIRED codes may exist for one user. */
export const MAX_ACTIVE_TOKENS = 8;

/** Section 15: 5 code requests per email per 15 minutes. */
export const MAX_REQUESTS_PER_EMAIL = 5;
export const REQUEST_RATE_WINDOW_MS = 15 * 60 * 1000;

/** Section 15: 5 verification attempts per issued code. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Section 15: a coarse IP limit, so one host cannot enumerate the directory. */
export const MAX_REQUESTS_PER_IP = 30;
export const IP_RATE_WINDOW_MS = 15 * 60 * 1000;

/** Section 12: how long a verified session stays usable. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** A password reset link lives for one hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * At most ONE unexpired reset link per account.
 *
 * Requesting a second one retires the first. That is the point: a leaked link
 * that is already sitting in an old inbox must stop working the moment the
 * owner asks for a new one, and the newest email is the only one that can.
 */
export const MAX_ACTIVE_RESET_TOKENS = 1;

/** 3 reset requests per email per 15 minutes. */
export const MAX_RESET_REQUESTS_PER_EMAIL = 3;
export const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

/** 5 wrong token submissions per issued link, then the link is dead. */
export const MAX_RESET_ATTEMPTS = 5;

/** The cookie name. `__Host-` prefix requires Secure + Path=/ + no Domain. */
export const SESSION_COOKIE = "yene_session";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Roles a real user can hold. Section 23 keeps Super Admin separate. */
export type UserRole = "owner" | "manager" | "employee" | "customer" | "super-admin";

/**
 * How a person proved who they are.
 *
 * `email-code` is the original passwordless flow and remains valid - an account
 * created before passwords existed keeps working. `password` is a local
 * credential. `google` and `yoti` are federated: the password is not stored at
 * all and the subject id is what links the account.
 */
export type IdentityProvider = "email-code" | "password" | "google" | "yoti";

export interface User {
  id: string;
  email: string;
  name: string;
  /**
   * The tenant this user belongs to - resolved here and never from a request.
   * `null` only for a platform-level Super Admin, who is authorised by role
   * and not by owning a business.
   */
  businessId: string | null;
  role: UserRole;
  active: boolean;
  createdAt: string;

  // -------------------------------------------------------------------------
  // Additive fields. Every one is optional, because `data/auth-users.json`
  // already holds rows written before they existed and this project has no
  // migration step. `undefined` and `null` both read as "not set".
  // -------------------------------------------------------------------------

  /** Sign-in handle. Unique when present; may be absent for older accounts. */
  username?: string | null;
  /** scrypt hash. NEVER leaves the server - not in /me, not in any response. */
  passwordHash?: string | null;
  /** The provider this account authenticates with. Defaults to email-code. */
  identityProvider?: IdentityProvider;

  /** Google's stable user id (`sub`). The account key for a Google login. */
  googleSub?: string | null;
  /** Yoti's session/scan reference, once a Yoti check has succeeded. */
  yotiReference?: string | null;
  /** The name Yoti read from the ID document, for display only. */
  yotiVerifiedName?: string | null;

  /**
   * Whether this account may rent a store.
   *
   * Sign-up is deliberately open to any customer, but RENTING is gated on the
   * identity profile being submitted - so this starts false and is only set
   * true by the verification flow, never by the sign-up request itself.
   */
  storeRentalApproved?: boolean;
}

/** The public projection of a user. Contains no secret, ever. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    role: user.role,
    identityProvider: user.identityProvider ?? "email-code",
    hasPassword: Boolean(user.passwordHash),
    yotiVerifiedName: user.yotiVerifiedName ?? null,
    storeRentalApproved: user.storeRentalApproved === true,
  };
}

/**
 * The analogue of the specification's `LoginToken` model.
 *
 * Field names deliberately match the Prisma sketch in Section 6
 * (`tokenHash`, `expiresAt`, `usedAt`, `createdAt`, `@@index([userId])`)
 * so this maps onto a real database without a redesign later. `attempts` and
 * `requestedIp` are additions the rate limiting in Section 15 requires.
 */
export interface LoginToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  /** Failed verification attempts against THIS code. */
  attempts: number;
  /** Rate-limit key. Stored, never returned. */
  requestedIp: string | null;
}

/**
 * Section 12: a session holds an identifier, not a bag of business facts.
 *
 * Only `userId` is persisted alongside it, so a user who moves to another
 * business is re-resolved on the next request rather than carrying a stale
 * tenant with them.
 */
export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ip: string | null;
}

/** What `requireAuth` attaches to the request. */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  /** Resolved from the user record, never from the request. */
  businessId: string | null;
  role: UserRole;
  isSuperAdmin: boolean;
  sessionId: string;
}

/** Section 8: the one response every email gets, known or not. */
export const GENERIC_CODE_SENT_MESSAGE =
  "If an account exists for this email, a verification code has been sent.";

/** Section 7/9: one failure message, so the verify endpoint cannot enumerate. */
export const GENERIC_CODE_FAILED_MESSAGE =
  "That verification code is not valid. Check it and try again.";

/** Section 4, returned verbatim. */
export const TOO_MANY_TOKENS_MESSAGE =
  "Too many active login tokens. Please wait for an existing token to expire or use one of the existing tokens.";

/** Section 5/9: shown for expired, used, wrong, or unknown-email codes. */
export const INVALID_SESSION_MESSAGE = "Authentication required";

/**
 * The ONE reply every address gets from `forgot-password`, known account or
 * not.
 *
 * Same principle as GENERIC_CODE_SENT_MESSAGE: this endpoint must never become
 * a way to discover who has an account here, so the wording cannot vary and the
 * status code is always 200.
 */
export const GENERIC_RESET_SENT_MESSAGE =
  "If an account exists for that email, a password reset link is on its way. Check your inbox and your spam folder.";

/**
 * One refusal for every way a token can fail - unknown, expired, already used,
 * or over its attempt limit. The client cannot tell them apart either, so a
 * stolen token cannot be probed to learn how far it got.
 */
export const GENERIC_RESET_FAILED_MESSAGE =
  "That password reset link is no longer valid. Request a new one and try again.";

/** The storage shape of an issued reset link. */
export interface PasswordResetToken {
  id: string;
  userId: string;
  /** HMAC of the token. The plaintext is NEVER written to disk. */
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  /** Wrong submissions against THIS link. */
  attempts: number;
  /** Rate-limit key. Stored, never returned. */
  requestedIp: string | null;
}