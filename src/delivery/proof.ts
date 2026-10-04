/**
 * ============================================================================
 *  DELIVERY PROOF - confirming a parcel actually arrived
 * ============================================================================
 *
 *  "Driver pressed DELIVERED" is not evidence that anything was delivered. A
 *  proof step turns the last transition in the machine into something the
 *  platform can stand behind, and WHICH proof is configuration rather than code.
 *
 *  WHY THE CODE IS STORED HASHED
 *  -----------------------------
 *  A 4-digit code has 10,000 possible values. Anyone who can read the data file
 *  could brute-force a stored plaintext code offline in under a second and
 *  complete somebody else's delivery. The hash is HMAC'd with a server secret
 *  and salted by the delivery id, so the value on disk cannot be reversed
 *  without that secret, and a code captured from one delivery cannot be replayed
 *  against another.
 *
 *  THE SAME PRINCIPLE AS THE LOGIN CODES
 *  -------------------------------------
 *  This project already HMACs its email login codes rather than hashing them
 *  bare, for exactly the same reason (see api/auth/types.ts, invariant 2). A
 *  delivery OTP is the same class of secret at a weaker entropy, so it gets the
 *  same treatment rather than a weaker one.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { ProofMethod } from "./types";

/** Four digits, as in the specification's worked example. */
export const PROOF_CODE_DIGITS = 4;
export const PROOF_CODE_MIN = 1000;
export const PROOF_CODE_MAX = 10_000;

/** How many wrong entries before the code is burned and the job re-offered. */
export const MAX_PROOF_ATTEMPTS = 5;

/**
 * The secret used to HMAC proof codes.
 *
 * Falls back to `LOGIN_CODE_SECRET` so a deployment already holding a strong
 * secret needs no new variable.
 *
 * THE EPHEMERAL FALLBACK IS MEMOISED, AND THAT IS THE WHOLE POINT
 * --------------------------------------------------------------
 *  An earlier version built it inline from `process.hrtime.bigint()`. That is a
 *  CLOCK, not a unique id: it returns a different value on every call, so the
 *  secret changed between issuing a code and verifying it and NO CODE COULD EVER
 *  BE VERIFIED. The delivery could therefore never be completed.
 *
 *  It is computed once per process and reused, which is what makes the fallback
 *  mean what it says: codes are verifiable for the life of the process, and a
 *  restart invalidates outstanding codes (they are re-issued, not reused).
 *
 *  In production the deployment is REQUIRED to supply a real secret - see
 *  `assertProofSecretConfigured` - because an ephemeral one cannot be shared
 *  across a horizontally scaled deployment.
 */
let ephemeralSecret: string | null = null;

function proofSecret(): string {
  const configured = process.env.DELIVERY_PROOF_SECRET || process.env.LOGIN_CODE_SECRET;
  if (configured && configured.trim().length > 0) return configured.trim();
  if (!ephemeralSecret) ephemeralSecret = `ephemeral-${process.pid}`;
  return ephemeralSecret;
}

/**
 * Is the secret safe for this environment?
 *
 * Called at boot rather than on every request, so a production deployment is
 * told once and plainly instead of silently running on a per-process secret that
 * two instances would not share.
 */
export function assertProofSecretConfigured(): string | null {
  if (proofSecretIsConfigured()) return null;
  return (
    "DELIVERY_PROOF_SECRET is not set - delivery confirmation codes will not verify across a " +
    "restart or across more than one server instance. Set it before accepting live deliveries."
  );
}

/** True when a real, shared secret is configured. */
export function proofSecretIsConfigured(): boolean {
  const configured = process.env.DELIVERY_PROOF_SECRET || process.env.LOGIN_CODE_SECRET;
  return Boolean(configured && configured.trim().length > 0);
}

/**
 * Generate a proof code.
 *
 * `randomInt` from node:crypto, not `Math.random`: this is the value that
 * authorises a delivery, and a predictable code is not a control at all.
 */
export function generateProofCode(): string {
  const span = PROOF_CODE_MAX - PROOF_CODE_MIN;
  return String(PROOF_CODE_MIN + randomInt(span));
}

/** HMAC a code against the delivery it belongs to. */
export function hashProofCode(deliveryId: string, code: string): string {
  return createHmac("sha256", proofSecret())
    .update(`${deliveryId}:${code}`)
    .digest("hex");
}

/**
 * Is this the right code for this delivery?
 *
 * `timingSafeEqual` rather than `===`. A four-digit code is small enough that a
 * timing side channel over HTTP is marginal, but the comparison is free and the
 * habit is worth forming here rather than in a place where it matters more.
 *
 * A wrong-LENGTH input is refused before the comparison rather than being
 * padded: `timingSafeEqual` throws on mismatched buffer lengths, and a throw
 * from a verification function is a crash, not a rejection.
 */
export function verifyProofCode(deliveryId: string, code: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidate = code.trim();
  if (!/^\d+$/.test(candidate)) return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashProofCode(deliveryId, candidate), "hex");
  if (expected.length !== actual.length || expected.length === 0) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Forget the memoised ephemeral secret.
 *
 * Test seam, and the reason the proof suite can exercise the no-secret path at
 * all: the fallback is cached for the life of the process, so a suite that wants
 * to test it has to be able to drop the cache.
 */
export function resetProofSecretCache(): void {
  ephemeralSecret = null;
}

/** Is this code shaped like one we issue? */
export function isValidProofCode(code: unknown): code is string {
  if (typeof code !== "string") return false;
  const trimmed = code.trim();
  if (!new RegExp(`^\\d{${PROOF_CODE_DIGITS}}$`).test(trimmed)) return false;
  const value = Number(trimmed);
  return value >= PROOF_CODE_MIN && value < PROOF_CODE_MAX;
}

/**
 * Which proof does this delivery need?
 *
 * Read from the stored configuration at REQUEST time rather than from the
 * vehicle, so switching an account from "customer taps confirm" to "driver types
 * the code" is an admin change with no redeploy - and so it applies to jobs
 * already in flight, which is what makes it safe to change.
 */
export type ProofRequirement =
  | { method: "otp"; description: string }
  | { method: "customer-confirmation"; description: string }
  | { method: "code"; description: string; code: string };

export function proofRequirement(
  method: ProofMethod,
  options: { customerPhone?: string | null } = {},
): ProofRequirement {
  switch (method) {
    case "otp":
      return {
        method: "otp",
        description:
          "We will send a 4-digit code to the customer. Give it to the driver at the door.",
      };
    case "customer-confirmation":
      return {
        method: "customer-confirmation",
        description: "The customer must confirm they received the parcel.",
      };
    case "code":
      return {
        method: "code",
        code: generateProofCode(),
        description: "Read this code to the customer and ask them to confirm it.",
      };
  }
}

/** Has the proof attempt budget been used up? */
export function proofAttemptsExhausted(attempts: number): boolean {
  return attempts >= MAX_PROOF_ATTEMPTS;
}

/**
 * The wording shown when a proof attempt fails.
 *
 * ONE message for every failure - wrong code, wrong delivery, already used - so
 * the endpoint cannot be used to discover whether a code exists.
 */
export const PROOF_FAILED_MESSAGE =
  "That delivery code is not correct. Check it with the customer and try again.";