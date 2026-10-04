/**
 * ============================================================================
 *  PASSWORD HASHING
 * ============================================================================
 *
 *  `scrypt` from `node:crypto`. No new dependency, and it is a memory-hard
 *  KDF, which is the right primitive for a human-chosen password.
 *
 *  WHY NOT SHA-256, EVEN THOUGH crypto.ts USES IT FOR LOGIN CODES
 *  --------------------------------------------------------------
 *  The two are not the same problem. A 6-digit login code is hashed so a stolen
 *  token file cannot be *replayed*, and the HMAC key is what makes brute force
 *  expensive. A password is low-entropy (a human picks it), so a fast digest
 *  would be cracked at billions of guesses per second. scrypt is deliberately
 *  slow AND memory-hard, so each guess costs real time and real RAM.
 *
 *  THE STORED FORMAT
 *  -----------------
 *      scrypt$N$r$p$<salt-b64>$<hash-b64>
 *
 *  The parameters live INSIDE the string, so raising N, r or p later does not
 *  invalidate existing hashes - `verifyPassword` reads whatever the row was
 *  written with and re-hashes accordingly. That is what makes a cost increase
 *  a migration rather than a flag day.
 *
 *  TIMING
 *  ------
 *  A wrong password and an account with no password must cost the same, or the
 *  response time discloses which emails are registered. `DUMMY_HASH` is
 *  verified against when no hash exists so both paths do identical work.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Current cost. Raise over time; old hashes keep verifying. */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;

/**
 * A real scrypt hash of a value nobody will ever submit. Verifying against this
 * when the account has no password makes "no such account" and "wrong password"
 * take the same time and the same memory.
 */
const DUMMY_HASH = `scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==`;

/** Node caps scrypt's memory; 32MB by default is under the 128MB default. */
function derive(password: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: 128 * 1024 * 1024 });
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return [ALGORITHM, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * Constant-time verification. Returns false - never throws - for a malformed or
 * absent hash, so a corrupt row cannot turn a login into a 500.
 */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const target = stored && stored.includes("$") ? stored : DUMMY_HASH;
  const parts = target.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd stored parameters rather than allocating on their behalf.
  if (N > 1_048_576 || r > 32 || p > 16) return false;

  try {
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    const actual = derive(password, salt, N, r, p);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we use now. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored || !stored.includes("$")) return true;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r || Number(parts[3]) < PARAMS.p;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export interface PasswordPolicyResult {
  ok: boolean;
  message: string | null;
}

/**
 * Length is the dominant factor in password strength, so the floor is 8 and
 * there is no composition rule (no "must contain a symbol") - those rules push
 * people toward predictable substitutions. The check is capped at 200 because
 * scrypt cost grows with input length and a 64KB password is a denial-of-service
 * vector, not a security feature.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN} characters.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { ok: false, message: `Use at most ${PASSWORD_MAX} characters.` };
  }
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, message: "That is a single repeated character. Choose something harder to guess." };
  }
  return { ok: true, message: null };
}

/**
 * Usernames: 3-30 chars, letters/digits/dot/underscore/hyphen, must start with a
 * letter. Deliberately excludes '@' so a username can never be confused with an
 * email address in a sign-in field that accepts either.
 */
export function isValidUsername(username: string): boolean {
  return /^[a-z][a-z0-9._-]{2,29}$/i.test(username.trim());
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

// ===========================================================================
//  LOGIN-CODE CRYPTOGRAPHY (Sections 2, 16)
// ===========================================================================
//
/**
 *  Three primitives, each with a reason it is the way it is.
 *
 *  1. A 6-digit code that is not trivially guessable.
 *     `randomInt` is a CSPRNG, so the code is uniform over 900,000 values -
 *     the specification's `123456` example is one of ~900,000, not a default.
 *     On top of that we re-roll codes with a human-visible pattern (all digits
 *     identical, or strictly ascending/descending). That costs nothing and
 *     honours the instruction "do NOT generate predictable codes" literally,
 *     so a screenshot of a code like 111111 cannot be a valid login.
 *
 *  2. A KEYED hash, not a bare digest.
 *     Six digits is a tiny search space. Anyone who can read the token file
 *     could brute-force a plain SHA-256 in milliseconds. HMAC-SHA256 under a
 *     server-side secret means the file alone is not enough to recover a code.
 *
 *  3. A constant-time comparison.
 *     A byte-by-byte string compare returns early on the first difference,
 *     which leaks how much of a guess was right. `timingSafeEqual` does not.
 *
 *  THE SECRET
 *  ----------
 *  `LOGIN_CODE_SECRET` is required in production. Without it we refuse to run
 *  rather than silently fall back to an unkeyed hash, because "it works" is
 *  exactly the wrong answer for the one primitive everything else rests on.
 */

import { createHmac, randomInt } from "node:crypto";
import { LOGIN_CODE_MAX, LOGIN_CODE_MIN } from "./types";

/**
 * Digits that look patterned to a human. Re-rolled rather than rejected, so a
 * user is never handed an error for the code we generated.
 */
function isVisuallyPredictable(code: string): boolean {
  if (/^(\d)\1{5}$/.test(code)) return true;                 // 111111, 000000
  if (code === "123456" || code === "654321") return true;   // the spec's examples
  const ascending = "0123456789".includes(code);
  const descending = "9876543210".includes(code);
  return ascending || descending;
}

/**
 * Section 2: a cryptographically secure 6-digit verification code.
 *
 * `randomInt` is rejection-sampled from the CSPRNG, so there is no modulo bias
 * toward the low end of the range.
 */
export function generateLoginCode(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomInt(LOGIN_CODE_MIN, LOGIN_CODE_MAX).toString();
    if (!isVisuallyPredictable(code)) return code;
  }
  // Unreachable in practice: 7 of 900,000 codes are excluded per roll.
  return randomInt(LOGIN_CODE_MIN, LOGIN_CODE_MAX).toString();
}

/** Session identifiers need far more entropy than a 6-digit code. */
export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function generateTokenId(): string {
  return `lt_${randomBytes(12).toString("hex")}`;
}

/**
 * The server-side secret.
 *
 * Throws in production when unset. Development gets a fixed, clearly-labelled
 * fallback so the flow is exercisable locally, and that fallback is
 * deliberately distinct so a production misconfiguration cannot silently
 * reuse it.
 */
export function loginCodeSecret(): string {
  const secret = process.env.LOGIN_CODE_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LOGIN_CODE_SECRET must be set (16+ characters) in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return "yene-development-only-secret-do-not-use-in-production";
}

/**
 * Hash a login code for storage.
 *
 * HMAC-SHA256(code, secret). The user id is mixed in as associated data, so a
 * code issued for one account can never be replayed against another even if
 * the two happen to collide.
 */
export function hashLoginCode(userId: string, code: string): string {
  return createHmac("sha256", loginCodeSecret())
    .update(`${userId}:${code}`)
    .digest("hex");
}

/** Section 5/9: compare a submitted code against a stored hash. */
export function verifyLoginCode(userId: string, code: string, storedHash: string): boolean {
  const candidate = hashLoginCode(userId, code);
  return safeEqual(candidate, storedHash);
}

/** Constant-time string comparison. Returns false rather than throwing. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; length is not secret here because
  // both sides are fixed-width hex digests.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Section 16: never log the plain code. This is the only place it exists. */
export function maskCodeForLog(code: string): string {
  return `${code.slice(0, 1)}****${code.slice(-1)}`;
}

/**
 * ============================================================================
 *  THE PUBLIC ORIGIN USED IN THE EMAIL LINK
 * ============================================================================
 *
 *  A reset link is only useful if it points at the site the recipient actually
 *  uses, so it is built from an operator-supplied origin rather than guessed
 *  from the request.
 *
 *  Guessing from the `Host` header would be a header-injection footgun: a link
 *  mailed to a real customer but built from a spoofed host sends them to an
 *  attacker's page with a valid token on it. So this reads configuration, and
 *  falls back to the port the server is listening on for local development.
 */
export function resetBaseUrl(): string {
  const configured = process.env.PASSWORD_RESET_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

/** The link a human clicks. The token is the only query parameter. */
export function buildResetUrl(token: string): string {
  return `${resetBaseUrl()}/#/reset-password?token=${encodeURIComponent(token)}`;
}

// ===========================================================================
//  PASSWORD RESET TOKENS
// ===========================================================================
//
// WHY A RANDOM TOKEN AND NOT A 6-DIGIT CODE
// ------------------------------------------
// A login code is typed by a human at a keyboard and is protected by attempt
// limits. A reset link travels through an inbox and is opened on whatever
// machine the reader happens to be at, so it gets a real 256-bit random value
// instead. 32 bytes from the CSPRNG is not guessable, which means the missing
// piece is not entropy but EXPIRY - hence the one-hour TTL and the single-use
// flag in passwordReset.ts.
//
// The same HMAC construction as the login code, for the same reason: a bare
// SHA-256 of a file's contents must not be enough to recover the secret. The
// userId is mixed in as associated data, so a token issued for one account can
// never be redeemed against another even if two collide.
// ===========================================================================

/**
 * 256 bits of CSPRNG output in URL-safe base64.
 *
 * `base64url` and not `base64`, because the token is carried in a query string
 * where `+`, `/` and `=` would be re-encoded or stripped by the mail client on
 * the way out.
 */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The `reset:` prefix domain-separates this hash from the login-code hash. */
export function hashResetToken(userId: string, token: string): string {
  return createHmac("sha256", loginCodeSecret())
    .update(`reset:${userId}:${token}`)
    .digest("hex");
}

/** Constant-time, and false rather than throwing for any malformed input. */
export function verifyResetToken(userId: string, token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;
  return safeEqual(hashResetToken(userId, token), storedHash);
}

/** Section 16 applies here too: the plaintext is never logged. */
export function maskResetTokenForLog(token: string): string {
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}