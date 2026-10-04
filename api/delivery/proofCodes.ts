/**
 * ============================================================================
 *  DELIVERY PROOF CODES - server memory only
 * ============================================================================
 *
 *  WHY THE PLAINTEXT LIVES IN MEMORY AND NOT ON DISK
 *  -------------------------------------------------
 *  The stored `proofCodeHash` is an HMAC, so it cannot be reversed. But the
 *  PLAINTEXT has to reach two people - the customer, who reads it out, and the
 *  assigned driver, who types it in - and neither of them can derive it from a
 *  hash. So it has to be held somewhere.
 *
 *  On disk it would be a book of live door codes: anyone who copied the data
 *  directory could complete somebody else's delivery. In memory it lives only as
 *  long as the process and only for a code that is currently outstanding, which
 *  is the smallest window in which the value has to exist at all.
 *
 *  THE CONSEQUENCES, STATED
 *  -----------------------
 *  * A server restart invalidates an outstanding code. The delivery is not
 *    lost; `issueCode` is simply called again, which issues a NEW code and
 *    invalidates the old one. This is the correct trade: a stale code that still
 *    worked would be worse than a code the driver has to re-read.
 *  * A completed delivery's code is DELETED, not left to expire, so there is
 *    never a live code for a parcel that has already arrived.
 *  * A code expires on its own too, so a phone left unattended cannot be used
 *    hours later.
 */

import { generateProofCode, hashProofCode } from "../../src/delivery/proof";
import type { Delivery } from "../../src/delivery/types";
import { persistDeliveries } from "./store";

/** How long an outstanding code stays readable. */
export const CODE_TTL_MS = 60 * 60 * 1000;

interface Held {
  code: string;
  issuedAt: number;
}

/** Keyed by delivery id. Deliberately a plain Map: this is process state. */
const held = new Map<string, Held>();

function prune(now = Date.now()): void {
  for (const [deliveryId, entry] of held) {
    if (now - entry.issuedAt > CODE_TTL_MS) held.delete(deliveryId);
  }
}

/**
 * Issue a code for a delivery, or return the one already outstanding.
 *
 * Idempotent on purpose: calling it twice does NOT issue two codes, because two
 * codes for one delivery would leave one of them valid and unknown.
 */
export function issueCode(delivery: Delivery): string {
  prune();
  const existing = held.get(delivery.id);
  if (existing && delivery.proofVerifiedAt === null) return existing.code;

  const code = generateProofCode();
  held.set(delivery.id, { code, issuedAt: Date.now() });

  delivery.proofCodeHash = hashProofCode(delivery.id, code);
  delivery.proofAttempts = 0;
  persistDeliveries();
  return code;
}

/**
 * The outstanding code for a delivery, or null.
 *
 * Only meaningful once the driver has ARRIVED - issuing a code earlier would put
 * it on the customer's screen for the whole journey, where it can be read over a
 * shoulder, so `isReadable` gates the moment it becomes available.
 */
export function currentCode(delivery: Delivery): string | null {
  prune();
  if (delivery.proofVerifiedAt !== null) return null;
  if (delivery.status !== "ARRIVING") return null;
  return held.get(delivery.id)?.code ?? null;
}

/** Forget a code. Called the instant a delivery closes, so none outlives it. */
export function clearCode(deliveryId: string): void {
  held.delete(deliveryId);
}

/** Test seam. */
export function clearAllCodes(): void {
  held.clear();
}
