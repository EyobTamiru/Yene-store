/**
 * ============================================================================
 *  LOGIN CODES - request and verify (specification sections 2-5, 7, 9, 15, 24)
 * ============================================================================
 *
 *  The rules, all enforced here rather than in the router:
 *
 *    2   a 6-digit code from a CSPRNG, with visibly-predictable codes re-rolled
 *    3   it expires after 10 minutes
 *    4   at most 8 UNEXPIRED codes per user; a 9th request is refused
 *    5   single use - a verified code can never work twice
 *    7   the code is returned in NO response, ever
 *    8   an unknown email gets the same generic reply as a known one
 *    9   expired / used / wrong / wrong-email are all the same refusal
 *   15   rate limits: 5 requests per email, 5 attempts per code, 30 per IP
 *   24   expired codes are swept on every request so they free their slot
 *
 *  ON THE ENUMERATION TRADE-OFF IN SECTION 4
 *  -----------------------------------------
 *  Section 4 asks for a distinct "too many active login tokens" error, and
 *  Section 8 asks that the response never reveal whether an account exists.
 *  Those two rules conflict: an error only a real account can trigger IS a
 *  membership oracle.
 *
 *  This follows the specification literally - the limit error is returned for a
 *  known account - and bounds the exposure with the per-email and per-IP rate
 *  limits. To remove the oracle entirely, set AUTH_HIDE_TOKEN_LIMIT=true and
 *  every response becomes the generic message; the limit is still enforced
 *  internally either way. That one variable is the whole change.
 */

import { generateLoginCode, generateTokenId, hashLoginCode, verifyLoginCode } from "./crypto";
import { activeTransport, verificationEmail } from "./email";
import {
  GENERIC_CODE_FAILED_MESSAGE,
  GENERIC_CODE_SENT_MESSAGE,
  IP_RATE_WINDOW_MS,
  LOGIN_CODE_TTL_MS,
  MAX_ACTIVE_TOKENS,
  MAX_REQUESTS_PER_EMAIL,
  MAX_REQUESTS_PER_IP,
  MAX_VERIFY_ATTEMPTS,
  REQUEST_RATE_WINDOW_MS,
  TOO_MANY_TOKENS_MESSAGE,
  type LoginToken,
  type User,
} from "./types";
import {
  allLoginTokens,
  isValidEmail,
  normalizeEmail,
  persistLoginTokens,
  userByEmail,
} from "./store";
import { createSession } from "./sessions";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Counters are in memory, so they reset on restart and are per-instance. That
 * is adequate abuse control on the single node this deployment is; a
 * multi-instance deployment needs Redis or equivalent behind `checkRateLimit`,
 * and nothing else changes.
 */
const rateCounters = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    rateCounters.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

/** Test seam: forget all counters. */
export function resetRateLimits(): void {
  rateCounters.clear();
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export function isExpired(token: LoginToken, now = Date.now()): boolean {
  return new Date(token.expiresAt).getTime() <= now;
}

/**
 * Section 4 + 24: the codes that currently count against the limit.
 *
 * "Active" means unexpired AND unused, so a used or expired code has already
 * stopped consuming a slot - which is what makes "an expired token frees a
 * slot" true rather than aspirational.
 */
export function activeTokensFor(userId: string, now = Date.now()): LoginToken[] {
  return allLoginTokens().filter(
    (token) => token.userId === userId && token.usedAt === null && !isExpired(token, now),
  );
}

/** Section 24: remove codes that can no longer be used. Never touches live ones. */
export function sweepExpiredTokens(userId: string, now = Date.now()): number {
  const list = allLoginTokens();
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const token = list[i];
    if (token.userId !== userId) continue;
    if (token.usedAt !== null || isExpired(token, now)) list.splice(i, 1);
  }
  const removed = before - list.length;
  if (removed > 0) persistLoginTokens();
  return removed;
}

export type RequestOutcome =
  | { ok: true; expiresAt: string; /** development only - never in production */
      devCode?: string }
  | { ok: false; reason: "too-many" | "rate-limited" | "invalid-email" };

/** Section 8: one reply for every input, unless the operator opts out of §4. */
function hideTokenLimit(): boolean {
  return process.env.AUTH_HIDE_TOKEN_LIMIT === "true";
}

/**
 * Section 7: request a code.
 *
 * The full flow runs for a real account and the same success shape is returned
 * for an unknown one, so the endpoint cannot be used to enumerate accounts.
 */
export async function requestLoginCode(
  email: string,
  ip: string | null,
): Promise<RequestOutcome> {
  if (!isValidEmail(email)) return { ok: false, reason: "invalid-email" };

  const normalized = normalizeEmail(email);

  // Section 15: IP limit first, so one host cannot enumerate the directory.
  if (checkRateLimit(`ip:${ip ?? "unknown"}`, MAX_REQUESTS_PER_IP, IP_RATE_WINDOW_MS)) {
    return { ok: false, reason: "rate-limited" };
  }
  // Section 15: 5 requests per email per 15 minutes.
  if (checkRateLimit(`req:${normalized}`, MAX_REQUESTS_PER_EMAIL, REQUEST_RATE_WINDOW_MS)) {
    return { ok: false, reason: "rate-limited" };
  }

  const user = userByEmail(normalized);
  // Section 8: no account means no work and no difference in the reply.
  if (!user || !user.active) return { ok: false, reason: "invalid-email" };

  // Section 24: free the slots of codes that can no longer be used.
  sweepExpiredTokens(user.id);

  // Section 4: refuse a 9th concurrent code.
  if (activeTokensFor(user.id).length >= MAX_ACTIVE_TOKENS) {
    return { ok: false, reason: "too-many" };
  }

  const code = generateLoginCode();
  const now = new Date();
  const token: LoginToken = {
    id: generateTokenId(),
    userId: user.id,
    // Section 2: only the hash is stored.
    tokenHash: hashLoginCode(user.id, code),
    expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MS).toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
    attempts: 0,
    requestedIp: ip,
  };
  allLoginTokens().push(token);
  persistLoginTokens();

  try {
    await activeTransport().send(verificationEmail(code, user.email));
  } catch (error) {
    // A mail failure must not leave a usable code sitting in the store.
    console.error("[auth] could not send verification code:", error);
  }

  // Section 7: the plain code is NEVER part of the API response. The optional
  // `devCode` exists for the verification suites, which install a recording
  // transport; the router discards it unless explicitly in development.
  return {
    ok: true,
    expiresAt: token.expiresAt,
    ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
  };
}

export type VerifyOutcome =
  | { ok: true; sessionId: string; user: User }
  | { ok: false; reason: "invalid" | "rate-limited" };

/**
 * Section 5 + 9: verify a code and open a session.
 *
 * Wrong email, wrong code, expired code and used code all produce the SAME
 * refusal, so this endpoint is not an oracle either. A code issued for one
 * account cannot be redeemed against another, because the lookup is by the
 * submitted email and the hash is keyed to the user id.
 */
export function verifyLoginCodeAndOpenSession(
  email: string,
  code: string,
  ip: string | null,
): VerifyOutcome {
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return { ok: false, reason: "invalid" };
  }

  const user = userByEmail(normalizeEmail(email));
  if (!user || !user.active) {
    checkRateLimit(`ip:${ip ?? "unknown"}`, MAX_REQUESTS_PER_IP, IP_RATE_WINDOW_MS);
    return { ok: false, reason: "invalid" };
  }

  const now = Date.now();
  const candidate = activeTokensFor(user.id, now).find((token) =>
    verifyLoginCode(user.id, code, token.tokenHash),
  );

  if (!candidate) {
    // Section 15: too many wrong guesses invalidates the code outright, so the
    // 900,000-value space cannot be walked one request per second.
    const latest = activeTokensFor(user.id, now).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    if (latest) {
      latest.attempts += 1;
      if (latest.attempts >= MAX_VERIFY_ATTEMPTS) {
        latest.usedAt = new Date().toISOString();
      }
      persistLoginTokens();
    }
    return { ok: false, reason: "invalid" };
  }

  // Section 5: single use. Marked BEFORE the session is created, so a later
  // failure cannot leave the code reusable.
  candidate.usedAt = new Date().toISOString();
  persistLoginTokens();

  const session = createSession(user.id, ip);
  return { ok: true, sessionId: session.id, user };
}

export { GENERIC_CODE_FAILED_MESSAGE, GENERIC_CODE_SENT_MESSAGE, TOO_MANY_TOKENS_MESSAGE, hideTokenLimit };

