/**
 * ============================================================================
 *  IDENTITY VERIFICATION (store rental)
 * ============================================================================
 *
 *  THE RULE THIS ENFORCES
 *  ----------------------
 *  Anyone may sign up and browse as a CUSTOMER. To RENT A STORE, the person
 *  must first complete an identity profile: a Fayda ID (with optional front and
 *  back document images) and a TIN number. That is what separates a shopper
 *  from a business, and it is why `storeRentalApproved` is never granted by a
 *  sign-up request - only by this flow, after review.
 *
 *  STATUS MEANINGS - AND ONE DELIBERATE RESTRICTION
 *  -------------------------------------------------
 *    not-started     nothing submitted
 *    pending-review  submitted, waiting for a human or an external check
 *    verified        an external verifier CONFIRMED it, or an admin approved it
 *    rejected        refused, with a reason
 *
 *  `pending-review` is the state this project sits in until a real external
 *  verifier is configured. The important rule: the code can move a record INTO
 *  `verified` only via an actual provider response or an explicit super-admin
 *  approval. There is no code path that reaches `verified` merely because a
 *  form was filled in. A marketplace that shows a green "verified seller" tick
 *  it did not actually check is worse than one that shows nothing.
 */

import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";

export const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

/** Where Fayda images land. Under the data dir, never in the web root. */
export const uploadsDir = path.join(dataDir, "uploads");

const verifications = createJsonCollection<VerificationRecord>(
  path.join(dataDir, "identity-verifications.json"),
  "identity-verifications",
  20_000,
);

export const allVerifications = verifications.all;
export const persistVerifications = verifications.touch;
export const flushVerifications = verifications.flush;

export type VerificationStatus = "not-started" | "pending-review" | "verified" | "rejected";

/** Which document images were supplied. Fayda front and back are OPTIONAL. */
export interface FaydaDocuments {
  front: string | null;
  back: string | null;
}

export interface VerificationRecord {
  id: string;
  userId: string;
  status: VerificationStatus;

  /** The Fayda ID number the person claims. */
  faydaId: string | null;
  /** Stored filenames under `uploads/`, served only to the owner or an admin. */
  documents: FaydaDocuments;
  /** Tax Identification Number. */
  tinNumber: string | null;

  /** Declared by the applicant. Cross-checked against the documents on review. */
  fullName: string | null;
  phone: string | null;

  /** Which external verifier answered: "etrade", "manual", or null. */
  provider: string | null;
  /** That provider's own reference, for an audit trail. */
  providerReference: string | null;
  /** Populated only when `status` is "rejected". */
  reason: string | null;

  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function verificationForUser(userId: string): VerificationRecord | null {
  return allVerifications().find((record) => record.userId === userId) ?? null;
}

/** True when this user may proceed to rent a store. */
export function isApprovedForRental(userId: string): boolean {
  const record = verificationForUser(userId);
  if (!record) return false;
  // A TIN is the one element with no "optional" in the requirement: it is what
  // makes a renter taxable-traceable, so it is required even though the Fayda
  // images are not.
  if (!record.tinNumber) return false;
  return record.status === "verified";
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

/**
 * Fayda IDs are 12 characters in the national format. Accepted loosely
 * (10-16 alphanumeric) because the exact layout has changed across revisions
 * and a hard reject here would lock out real citizens on a formatting detail.
 */
export function isValidFaydaId(value: string): boolean {
  return /^[A-Za-z0-9]{10,16}$/.test(value.trim());
}

/**
 * Ethiopian TINs are numeric, commonly 10 digits and sometimes written with a
 * `TIN` prefix. Normalised to bare digits before storage so `TIN0012345678` and
 * `0012345678` cannot both exist as separate records.
 */
export function normalizeTin(value: string): string | null {
  const digits = value.trim().replace(/^tin[\s-]*/i, "").replace(/[\s-]/g, "");
  return /^\d{9,11}$/.test(digits) ? digits : null;
}

export function isValidTin(value: string): boolean {
  return normalizeTin(value) !== null;
}

/**
 * The applicant-facing projection. Document FILENAMES are never included - the
 * images are fetched through an ownership-checked route instead of being
 * addressable.
 */
export function publicVerification(record: VerificationRecord | null) {
  if (!record) {
    return {
      status: "not-started" as VerificationStatus,
      faydaId: null,
      tinNumber: null,
      fullName: null,
      phone: null,
      hasFront: false,
      hasBack: false,
      provider: null,
      reason: null,
      submittedAt: null,
      reviewedAt: null,
      approvedForRental: false,
    };
  }
  return {
    status: record.status,
    faydaId: record.faydaId,
    tinNumber: record.tinNumber,
    fullName: record.fullName,
    phone: record.phone,
    hasFront: Boolean(record.documents.front),
    hasBack: Boolean(record.documents.back),
    provider: record.provider,
    reason: record.reason,
    submittedAt: record.submittedAt,
    reviewedAt: record.reviewedAt,
    approvedForRental: isApprovedForRental(record.userId),
  };
}
