/**
 * ============================================================================
 *  COMMISSION - configurable, never hardcoded
 * ============================================================================
 *
 *  YENE-STORE's cut is a POLICY decision, so it lives in data an administrator
 *  can change, not in a constant in the code. The rates below are the shipped
 *  DEFAULTS and the starting point for the admin screen; a stored rate always
 *  wins over a default.
 *
 *  WHY BASIS POINTS
 *  ----------------
 *  A percentage is a fraction, and a fraction of an odd number of cents is not
 *  a whole number of cents. 20% of 10.01 ETB is 2.002 ETB. Rates are therefore
 *  integers in basis points (2000 = 20%) and the result is rounded half away
 *  from zero by `mulByBps`, so a credit and its matching debit always agree.
 *
 *  THE SPLIT IS EXACT OR IT IS NOT POSTED
 *  -------------------------------------
 *  The specification's worked example is 700 -> 560 freelancer / 140 YENE,
 *  which divides cleanly. Real amounts do not: 100.00 at 80/20 works, but
 *  10.01 three ways does not. `splitCommission` uses `allocate`, so the shares
 *  always sum to EXACTLY the gross. A leftover cent is a bug that silently
 *  becomes somebody's money, and this is where it is prevented.
 */

import { allocate, BPS_ONE_HUNDRED_PERCENT, mulByBps, type Minor } from "./money";

/** The marketplace categories that can carry a different commission rate. */
export type CommissionCategory =
  | "freelance-service"
  | "business-service"
  | "product"
  | "subscription"
  | "special-agreement";

export const COMMISSION_CATEGORIES: CommissionCategory[] = [
  "freelance-service",
  "business-service",
  "product",
  "subscription",
  "special-agreement",
];

/** A rate an administrator has set for one category. */
export interface CommissionRule {
  category: CommissionCategory;
  /** YENE's share, in basis points. 2000 = 20%. */
  bps: number;
  /** When this was set, and by whom. Audited like any other admin action. */
  updatedAt: string;
  updatedBy: string;
}

/**
 * The shipped defaults.
 *
 * A STARTING POINT, not a decision. Part 16 requires YENE's actual commercial
 * terms to be confirmed before any live transaction, and the admin screen
 * exists so they can be set in data rather than shipped in a release.
 */
export const DEFAULT_COMMISSION_RULES: CommissionRule[] = [
  { category: "freelance-service", bps: 2000, updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "system-default" },
  { category: "business-service", bps: 1500, updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "system-default" },
  { category: "product", bps: 1000, updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "system-default" },
  { category: "subscription", bps: 0, updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "system-default" },
  { category: "special-agreement", bps: 0, updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "system-default" },
];

/**
 * The largest rate an administrator may set.
 *
 * 100% would leave the payee nothing, so it is refused: a freelancer who
 * completed a job and earned nothing would have no way to notice a bad rate.
 */
export const MAX_COMMISSION_BPS = BPS_ONE_HUNDRED_PERCENT - 100;

/**
 * The rate for a category, preferring a stored rule and falling back to the
 * shipped default.
 *
 * A stored rule for an UNKNOWN category is ignored rather than applied: a typo
 * in an id must not silently apply some other category's rate to a transaction.
 */
export function commissionBps(category: CommissionCategory, storedRules: CommissionRule[]): number {
  if (!COMMISSION_CATEGORIES.includes(category)) {
    throw new Error(`Unknown commission category: ${category}`);
  }
  const stored = storedRules.find((rule) => rule.category === category);
  const fallback = DEFAULT_COMMISSION_RULES.find((rule) => rule.category === category);
  const bps = stored?.bps ?? fallback?.bps ?? 0;
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) {
    throw new Error(`Commission rate for ${category} is out of range: ${bps} bps.`);
  }
  return bps;
}

/** The outcome of splitting a gross amount. */
export interface CommissionSplit {
  gross: Minor;
  /** YENE's share. */
  platformFee: Minor;
  /** What the freelancer or seller receives. */
  payeeAmount: Minor;
  bps: number;
}

/**
 * Split a gross amount into YENE's share and the payee's share.
 *
 * The order matters and is deliberate: `allocate` is given the two COMPLEMENTARY
 * weights rather than computing one side and subtracting, because subtracting is
 * how a rounding cent disappears. The invariant guaranteed here is
 *
 *     platformFee + payeeAmount === gross      (always, as integers)
 *
 * asserted inside `allocate` before the result is returned, so a violation is
 * an exception rather than a posted imbalance.
 *
 * The specification's worked example:
 *   splitCommission(70000, "freelance-service", [])
 *     -> { gross: 70000, platformFee: 14000, payeeAmount: 56000, bps: 2000 }
 */
export function splitCommission(
  gross: Minor,
  category: CommissionCategory,
  storedRules: CommissionRule[],
): CommissionSplit {
  if (!Number.isInteger(gross) || gross < 0) {
    throw new Error("A commission split needs a non-negative whole amount of cents.");
  }
  const bps = commissionBps(category, storedRules);
  if (gross === 0) return { gross: 0, platformFee: 0, payeeAmount: 0, bps };

  // A 0% or 100%-ish rate is a legitimate configuration - "special agreement"
  // ships at zero - and it cannot go through `allocate`, which requires every
  // weight to be positive. Handling it here keeps that guarantee (a zero weight
  // is always a caller error) without forbidding a rate that means something.
  if (bps === 0) return { gross, platformFee: 0, payeeAmount: gross, bps };
  if (bps === BPS_ONE_HUNDRED_PERCENT) return { gross, platformFee: gross, payeeAmount: 0, bps };

  const [platformFee, payeeAmount] = allocate(gross, [bps, BPS_ONE_HUNDRED_PERCENT - bps]);
  return { gross, platformFee, payeeAmount, bps };
}

/** Commission on an already-derived amount - a percentage OF a percentage. */
export function commissionOn(amount: Minor, bps: number): Minor {
  return mulByBps(amount, bps);
}
