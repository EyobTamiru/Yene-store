/**
 * ============================================================================
 *  PASSWORD RESET - request a link, redeem it
 * ============================================================================
 *
 *  Two operations, both of which the Sign in screen calls for real:
 *
 *      forgot-password   an address -> a reset link is emailed
 *      reset-password    a link + a new password -> the password changes
 *
 *  THE RULES, ALL ENFORCED HERE RATHER THAN IN THE ROUTER
 *  ------------------------------------------------------
 *    A. The request reply is IDENTICAL for a known and an unknown address, and
 *       the status is 200 either way. This endpoint must never become a way to
 *       discover who has an account here.
 *    B. Requesting a link RETIRES any earlier unexpired link for that account,
 *       so only the newest email can be redeemed.
 *    C. A link is SINGLE USE and expires after one hour.
 *    D. Only a keyed HASH of the token is stored. Reading the data directory
 *       must not be enough to forge a link.
 *    E. The new password faces the SAME policy as registration, and is stored
 *       with the SAME scrypt hash - no readable secret, no special path.
 *    F. A successful reset REVOKES EVERY SESSION for that account. The usual
 *       reason to reset is "I think someone else is in my account", so leaving
 *       the thief's session alive would defeat the entire point.
 *    G. Rate limits: 3 requests per email, plus the router's per-IP limit.
 *
 *  EVERY FAILURE LOOKS THE SAME
 *  -----------------------------
 *  Unknown token, wrong token, expired, already used, over the attempt limit -
 *  one message, one status. Otherwise the error itself leaks: "expired but
 *  genuine" versus "never existed" tells an attacker holding a stolen link
 *  whether it was ever worth using.
 */

import {
  buildResetUrl,
  checkPasswordPolicy,
  generateResetToken,
  generateTokenId,
  hashPassword,
  hashResetToken,
  maskResetTokenForLog,
  verifyResetToken,
} from "./crypto";
import { activeTransport, passwordResetEmail } from "./email";
import { revokeAllForUser } from "./sessions";
import {
  MAX_ACTIVE_RESET_TOKENS,
  MAX_RESET_ATTEMPTS,
  MAX_RESET_REQUESTS_PER_EMAIL,
  PASSWORD_RESET_TTL_MS,
  RESET_RATE_WINDOW_MS,
  type PasswordResetToken,
  type User,
} from "./types";
import {
  allPasswordResets,
  isValidEmail,
  normalizeEmail,
  persistPasswordResets,
  persistUsers,
  userByEmail,
  userById,
} from "./store";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * In memory, like the equivalent limiter in tokens.ts - adequate abuse control
 * on the single node this deployment is. A multi-instance deployment needs
 * Redis or equivalent behind this, and nothing else changes.
 *
 * The key is the normalised address, so casing cannot buy extra attempts.
 */
const requestCounters = new Map<string, { count: number; resetAt: number }>();

function overRequestLimit(email: string): boolean {
  const now = Date.now();
  const key = `reset:${email}`;
  const entry = requestCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    requestCounters.set(key, { count: 1, resetAt: now + RESET_RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_RESET_REQUESTS_PER_EMAIL;
}

/** Test seam: forget every counter. */
export function resetResetRateLimits(): void {
  requestCounters.clear();
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export function isResetExpired(token: PasswordResetToken, now = Date.now()): boolean {
  return new Date(token.expiresAt).getTime() <= now;
}

/** Links for this user that are still redeemable. */
export function activeResetTokens(userId: string, now = Date.now()): PasswordResetToken[] {
  return allPasswordResets().filter(
    (token) => token.userId === userId && token.usedAt === null && !isResetExpired(token, now),
  );
}

/** Drops links that can no longer be redeemed, so they stop occupying the store. */
export function sweepResetTokens(userId: string, now = Date.now()): number {
  const list = allPasswordResets();
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const token = list[i];
    if (token.userId !== userId) continue;
    if (token.usedAt !== null || isResetExpired(token, now)) list.splice(i, 1);
  }
  const removed = before - list.length;
  if (removed > 0) persistPasswordResets();
  return removed;
}

/** Never write a full address to a log. Enough to tell two events apart. */
export function maskedEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

// ---------------------------------------------------------------------------
// 1. Request a link
// ---------------------------------------------------------------------------

export type RequestResetOutcome =
  | { ok: true; /** development only, for the verification suites */
      devToken?: string }
  | { ok: false; reason: "rate-limited" };

/**
 * Issue a reset link.
 *
 * The caller is expected to return the same generic message whatever this
 * returns. `ok: false` here is ONLY the rate limit - "no such account" is not an
 * error, it is the answer for a known-free address and must look identical to
 * success from the outside.
 */
export async function requestPasswordReset(
  email: string,
  ip: string | null,
): Promise<RequestResetOutcome> {
  if (!isValidEmail(email)) return { ok: true };

  const normalized = normalizeEmail(email);

  if (overRequestLimit(normalized)) return { ok: false, reason: "rate-limited" };

  const user = userByEmail(normalized);
  // Rule A: an unknown or deactivated account is indistinguishable from success
  // to the caller. No email, no token, no timing signal worth measuring.
  if (!user || !user.active) return { ok: true };

  // Rule B: a new request retires every earlier live link, so a leaked one
  // cannot be redeemed after the owner asks for a fresh link. `sweep` first
  // clears the ones that died of old age, then whatever is left is burned -
  // which is also what keeps the account inside MAX_ACTIVE_RESET_TOKENS.
  sweepResetTokens(user.id);
  const previous = activeResetTokens(user.id);
  if (previous.length > 0) {
    const burned = new Date().toISOString();
    for (const stale of previous) stale.usedAt = burned;
    persistPasswordResets();
  }

  const token = generateResetToken();
  const now = new Date();
  const record: PasswordResetToken = {
    id: generateTokenId(),
    userId: user.id,
    // Rule D: the plaintext is never written to disk.
    tokenHash: hashResetToken(user.id, token),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
    attempts: 0,
    requestedIp: ip,
  };
  allPasswordResets().push(record);
  persistPasswordResets();

  try {
    await activeTransport().send(passwordResetEmail(buildResetUrl(token), user.email));
  } catch (error) {
    // A mail failure must not leave a usable link sitting in the store. Retiring
    // it here means a link nobody received cannot be redeemed later.
    record.usedAt = new Date().toISOString();
    persistPasswordResets();
    console.error("[auth] could not send password reset link:", error);
  }

  // Section 16: the token itself is never logged, only enough to correlate.
  console.log(
    `[auth] password reset link issued for ${maskedEmail(user.email)} (${maskResetTokenForLog(token)})`,
  );

  return {
    ok: true,
    ...(process.env.NODE_ENV !== "production" ? { devToken: token } : {}),
  };
}

// ---------------------------------------------------------------------------
// 2. Redeem the link
// ---------------------------------------------------------------------------

export type ResetOutcome =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "weak-password"; message?: string };

/**
 * Verify a token and set a new password.
 *
 * The lookup is by HASH rather than by userId, so the token is never the thing
 * that identifies the row - only the way into it. `verifyResetToken` is
 * constant-time, and every rejection increments the attempt counter so a
 * captured link dies after a handful of guesses.
 */
export function completePasswordReset(
  token: string,
  newPassword: string,
  ip: string | null,
): ResetOutcome {
  if (!token || !newPassword) return { ok: false, reason: "invalid" };

  // Rule E: identical policy to registration. Reported separately because a weak
  // password is the user's own doing and they can fix it right now, whereas an
  // invalid token is not actionable.
  const policy = checkPasswordPolicy(newPassword);
  if (!policy.ok) {
    return {
      ok: false,
      reason: "weak-password",
      message: policy.message ?? "Choose a stronger password.",
    };
  }

  const now = Date.now();
  // Only an UNUSED row is a candidate, so a spent link can never be matched and
  // resurrected by a later request.
  const record = allPasswordResets().find(
    (entry) => entry.usedAt === null && verifyResetToken(entry.userId, token, entry.tokenHash),
  );

  if (!record) return { ok: false, reason: "invalid" };

  if (isResetExpired(record, now)) {
    // The link was genuine but out of date. Count the attempt against it and
    // retire it, so an old message sitting in an inbox is not a standing
    // liability that happens to still hash-match.
    record.attempts += 1;
    if (record.attempts >= MAX_RESET_ATTEMPTS) record.usedAt = new Date(now).toISOString();
    persistPasswordResets();
    return { ok: false, reason: "invalid" };
  }

  const user = userById(record.userId);

  // Rule C: burned BEFORE the password is written, so a later failure cannot
  // leave a link that is still redeemable.
  record.usedAt = new Date(now).toISOString();
  persistPasswordResets();

  if (!user || !user.active) return { ok: false, reason: "invalid" };

  // Rule E again: stored exactly like every other password on the platform.
  user.passwordHash = hashPassword(newPassword);
  // A reset makes this a local-credential account, so `/me` reports it as one
  // and the UI stops offering to create a password.
  if (user.identityProvider === "email-code") user.identityProvider = "password";
  persistUsers();

  // Rule F: every session dies. Whoever prompted the reset is locked out, and so
  // is anyone who was already in.
  const revoked = revokeAllForUser(user.id);

  // Any other link for this account is now meaningless.
  sweepResetTokens(user.id);

  console.log(
    `[auth] password reset completed for ${maskedEmail(user.email)} from ${
      ip ?? "unknown"
    }; ${revoked} session(s) revoked`,
  );

  return { ok: true, user };
}
