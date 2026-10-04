/**
 * ============================================================================
 *  STORAGE QUOTAS - how much media a package includes
 * ============================================================================
 *
 *  WHAT A STORAGE LIMIT IS AND IS NOT
 *  ----------------------------------
 *  It is a limit on what a business can UPLOAD. It is not a wall around what it
 *  already has. A business that upgrades, fills up, then downgrades is left
 *  holding more than its new plan includes - and the correct response to that is
 *  to let them delete down to the limit, not to freeze their store and refuse to
 *  serve what is already there.
 *
 *  That distinction is why `StorageDecision` has three outcomes rather than two,
 *  and why `uploadAllowed` is true for a business that is already over: a file
 *  REPLACED by a smaller one is how they get back under, and refusing it would
 *  trap them permanently.
 *
 *  WHY THE NUMBERS ARE IN BYTES
 *  -----------------------------
 *  A "2 GB" written in one place and compared in another is a rounding bug
 *  waiting to happen - GB vs GiB, decimal vs binary. Everything here is an
 *  integer byte count, and the human label is derived from it rather than typed
 *  alongside it, so the two can never disagree.
 *
 *  PURE MODULE. No filesystem, no Express: the enforcement decision is testable.
 */

import type { PackageId } from "./types";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

/** The published allowances, in bytes. */
export const STORAGE_BYTES = {
  silver: 2 * GB,
  gold: 10 * GB,
  platinum: 50 * GB,
  /**
   * Super is a quotation (Section 40), so its storage is not a single number.
   * 250 GB is the FLOOR of the quoted band; `null` here means "at least this,
   * more on request" rather than "unlimited", because the specification says
   * 250 GB - 1 TB+.
   */
  super: 250 * GB,
} as const satisfies Record<PackageId, number>;

/** The top of the quoted Super band, for display only. 1 TB and up. */
export const SUPER_STORAGE_CEILING = TB;

export type StorageTier = keyof typeof STORAGE_BYTES;

/** The human label shown on a package card. Derived, never typed twice. */
export function storageLabel(id: PackageId): string {
  if (id === "super") return `${formatBytes(STORAGE_BYTES.super)} - 1 TB+`;
  return formatBytes(STORAGE_BYTES[id]);
}

/**
 * The single largest file a package may upload.
 *
 * Separate from the total allowance, because "you have 2 GB" and "you may send
 * a 3 GB file" would otherwise contradict each other in the customer's face.
 * A business can accumulate many files up to its total, but none may exceed this.
 */
export const MAX_FILE_BYTES = {
  silver: 25 * MB,
  gold: 50 * MB,
  platinum: 200 * MB,
  super: 1024 * MB,
} as const satisfies Record<PackageId, number>;

/** Video is chunkier than an image, so it carries its own ceiling. */
export const MAX_VIDEO_BYTES = {
  silver: 25 * MB,
  gold: 50 * MB,
  platinum: 200 * MB,
  super: 1024 * MB,
} as const satisfies Record<PackageId, number>;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "2 GB", "512 MB", "1.5 GB". Derived from the byte count, so it cannot drift. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes >= TB) return `${trim(bytes / TB)} TB`;
  if (bytes >= GB) return `${trim(bytes / GB)} GB`;
  if (bytes >= MB) return `${trim(bytes / MB)} MB`;
  if (bytes >= KB) return `${trim(bytes / KB)} KB`;
  return `${Math.round(bytes)} B`;
}

/** One decimal place, with a trailing ".0" removed. */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "1.2 GB of 10 GB used". */
export function storageSummary(usedBytes: number, limitBytes: number): string {
  return `${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used`;
}

/** A fraction from 0 to 1, clamped. Used for the usage bar. */
export function usageFraction(usedBytes: number, limitBytes: number): number {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return 0;
  return Math.min(1, Math.max(0, usedBytes / limitBytes));
}

/** At 90% a business should be told before it is refused. */
export const STORAGE_WARN_FRACTION = 0.9;

// ---------------------------------------------------------------------------
// The enforcement decision
// ---------------------------------------------------------------------------

export type StorageDecision =
  /** Room for this upload. */
  | { allowed: true; usedAfter: number; limit: number; headroom: number }
  /**
   * Refused: this upload would take the business past its allowance. `headroom`
   * is how much room IS left, so the message can say how much to delete.
   */
  | { allowed: false; reason: "over-quota"; used: number; limit: number; headroom: number; oversize: boolean };

export interface StorageContext {
  /** What the business already has on disk. */
  usedBytes: number;
  /** The package allowance. */
  limitBytes: number;
  /** The largest single file permitted, for this package and media kind. */
  maxFileBytes: number;
  /** The size of the file being offered. */
  incomingBytes: number;
}

/**
 * May this upload go through?
 *
 * THE ORDER MATTERS AND IT IS THE POINT
 *  - A file over the per-file ceiling is refused whatever the total usage. A
 *    business with 19 GB free still may not send a 40 MB video on Silver.
 *  - A file that fits the per-file ceiling but not the remaining headroom is
 *    refused with the remaining amount, so the message is actionable.
 *  - A business ALREADY over its limit may still upload a file SMALLER than what
 *    is currently over, because that is how they get back down. Refusing it
 *    would leave them permanently stuck with content they cannot reduce.
 */
export function evaluateUpload(context: StorageContext): StorageDecision {
  const { usedBytes, limitBytes, maxFileBytes, incomingBytes } = context;
  const headroom = Math.max(0, limitBytes - usedBytes);

  if (incomingBytes <= 0) {
    return { allowed: true, usedAfter: usedBytes, limit: limitBytes, headroom };
  }

  if (incomingBytes > maxFileBytes) {
    return { allowed: false, reason: "over-quota", used: usedBytes, limit: limitBytes, headroom, oversize: true };
  }

  // Over the allowance already, but moving in a smaller direction is allowed.
  if (usedBytes > limitBytes) {
    if (incomingBytes <= usedBytes - limitBytes) {
      return { allowed: true, usedAfter: usedBytes, limit: limitBytes, headroom };
    }
    return { allowed: false, reason: "over-quota", used: usedBytes, limit: limitBytes, headroom, oversize: false };
  }

  if (usedBytes + incomingBytes > limitBytes) {
    return { allowed: false, reason: "over-quota", used: usedBytes, limit: limitBytes, headroom, oversize: false };
  }

  return { allowed: true, usedAfter: usedBytes + incomingBytes, limit: limitBytes, headroom };
}

/**
 * The sentence a merchant reads when an upload is refused.
 *
 * Two different messages for the two different reasons, because "you are over
 * quota" is useless to somebody who has been told they have 1.9 GB free.
 */
export function uploadRefusalMessage(decision: Extract<StorageDecision, { allowed: false }>): string {
  if (decision.oversize) {
    return (
      `This file is larger than a single upload allows. ` +
      `Your package permits up to ${formatBytes(decision.limit)} in total.`
    );
  }
  return (
    `Uploading this would take you over your ${formatBytes(decision.limit)} storage allowance. ` +
    `You have ${formatBytes(decision.headroom)} free - delete an existing file, or upgrade your package.`
  );
}

/** Should the business be warned before it is actually refused? */
export function shouldWarn(usedBytes: number, limitBytes: number): boolean {
  return limitBytes > 0 && usageFraction(usedBytes, limitBytes) >= STORAGE_WARN_FRACTION;
}

/** The package's total allowance and single-file ceiling, in one lookup. */
export function storageLimitsFor(id: PackageId): { total: number; maxFile: number } {
  return { total: STORAGE_BYTES[id], maxFile: MAX_FILE_BYTES[id] };
}
