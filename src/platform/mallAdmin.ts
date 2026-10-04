/**
 * ============================================================================
 *  MALL ADMINISTRATION (Sections 10 & 41)
 * ============================================================================
 *
 *  The rules behind "how full is this mall, how much rent is it collecting, and
 *  which rooms may be advertised". Pure, like every other domain module here, so
 *  the arithmetic behind the landlord's dashboard is testable without a server.
 *
 *  OCCUPANCY IS A RENT-ROLL FACT, NOT A COUNT
 *  -----------------------------------------
 *  "8 of 88 units let" is the number an administrator acts on, but it is only
 *  meaningful beside what those 8 are paying. `rentRoll` therefore always
 *  reports its figures beside the occupancy ones, and never a percentage alone,
 *  because 9% occupancy and 60% occupancy are equally useless without the rent
 *  behind them.
 *
 *  "HELD" IS NOT "UNAVAILABLE"
 *  ---------------------------
 *  A held unit is one a pending application has claimed. It is unavailable for a
 *  reason that may yet disappear, which is why it is reported separately from a
 *  unit the landlord has unlisted: the first is a decision waiting on an
 *  administrator, the second is a decision already taken.
 *
 *  RENT IS COUNTED FROM LEASES, NOT FROM ASKING PRICES
 *  ----------------------------------------------------
 *  `unit.monthlyRentEtb` is what a unit is ADVERTISED at. The rent roll sums
 *  `StoreLease.monthlyRentEtb`, because a lease is negotiated and the agreed
 *  figure is the one the landlord actually invoices. Summing asking prices would
 *  report revenue that was never contracted.
 */

import type { Mall, MallUnit, StoreLease } from "./types";

export interface Occupancy {
  total: number;
  leased: number;
  held: number;
  available: number;
  /** Free but deliberately withheld from applicants. */
  unlisted: number;
  /** 0-100. Null when the mall has no units, because 0% of nothing is a lie. */
  occupancyPercent: number | null;
}

export interface RentRoll {
  /** ETB per month that active leases commit the mall to. */
  contractedMonthlyEtb: number;
  /** ETB per month the leased units are ADVERTISED at. The gap is a discount. */
  listedMonthlyEtb: number;
  /** ETB per month still on the table from units a tenant could take. */
  potentialMonthlyEtb: number;
  depositsHeldEtb: number;
  leaseCount: number;
}

/**
 * Where every unit in a mall currently stands.
 *
 * The order of the checks matters and is deliberate:
 *   1. LEASED first, because a unit can be leased AND unlisted - an occupied
 *      shop is still occupied, and counting it as "available" would overstate
 *      what a mall can actually let.
 *   2. HELD next, because a pending application is a live claim on the unit
 *      even if the landlord has also taken it off the market.
 *   3. Then LISTABLE decides between available and unlisted.
 */
export function occupancy(units: readonly MallUnit[], mall: Mall | null): Occupancy {
  if (!mall) {
    return {
      total: 0,
      leased: 0,
      held: 0,
      available: 0,
      unlisted: 0,
      occupancyPercent: null,
    };
  }

  const mine = units.filter((unit) => unit.mallId === mall.id);
  let leased = 0;
  let held = 0;
  let available = 0;
  let unlisted = 0;

  for (const unit of mine) {
    if (unit.status === "leased" || unit.businessId) leased += 1;
    else if (unit.status === "held" || unit.applicationId) held += 1;
    else if (unit.listable === false) unlisted += 1;
    else available += 1;
  }

  return {
    total: mine.length,
    leased,
    held,
    available,
    unlisted,
    occupancyPercent: mine.length === 0 ? null : Math.round((leased / mine.length) * 100),
  };
}

/**
 * The money a mall is collecting, and the money it could still collect.
 *
 * `contractedMonthlyEtb` is the honest headline. `listedMonthlyEtb` sits beside
 * it so a landlord can see how much discount they have given away without
 * opening every lease.
 */
export function rentRoll(
  units: readonly MallUnit[],
  leases: readonly StoreLease[],
  mall: Mall | null,
): RentRoll {
  const empty: RentRoll = {
    contractedMonthlyEtb: 0,
    listedMonthlyEtb: 0,
    potentialMonthlyEtb: 0,
    depositsHeldEtb: 0,
    leaseCount: 0,
  };
  if (!mall) return empty;

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const mine = units.filter((unit) => unit.mallId === mall.id);

  let contractedMonthlyEtb = 0;
  let listedMonthlyEtb = 0;
  let depositsHeldEtb = 0;
  let leaseCount = 0;

  for (const lease of leases) {
    if (lease.mallId !== mall.id || !lease.active) continue;
    contractedMonthlyEtb += lease.monthlyRentEtb;
    depositsHeldEtb += lease.depositEtb;
    leaseCount += 1;
    listedMonthlyEtb += unitById.get(lease.unitId)?.monthlyRentEtb ?? lease.monthlyRentEtb;
  }

  // What a new tenant could be charged for the counters still on offer. HELD
  // units are excluded: they are spoken for, and counting them as potential
  // revenue would promise income that depends on a pending approval.
  const potentialMonthlyEtb = mine
    .filter(
      (unit) =>
        unit.status === "available" &&
        !unit.businessId &&
        !unit.applicationId &&
        unit.listable !== false,
    )
    .reduce((sum, unit) => sum + unit.monthlyRentEtb, 0);

  return {
    contractedMonthlyEtb,
    listedMonthlyEtb,
    potentialMonthlyEtb,
    depositsHeldEtb,
    leaseCount,
  };
}

/**
 * What YENE-STORE owes the landlord each month under an agreement.
 *
 * Computed rather than stored, because a revenue share recalculated by hand is a
 * number that will be wrong. Rounded to the nearest birr, because a share
 * coming out as 41,666.67 is not a figure anybody could pay.
 */
export function landlordPayout(roll: RentRoll, revenueSharePercent: number): number {
  const share = Math.min(Math.max(revenueSharePercent, 0), 100);
  return Math.round((roll.contractedMonthlyEtb * share) / 100);
}

/**
 * Validate and normalise an administrator's edit to a unit.
 *
 * Returns the fields to apply rather than a boolean, so a caller cannot apply
 * half of a rejected change - which is how a unit ends up with a new price and
 * its old floor.
 *
 * A price of zero is accepted rather than refused: a landlord typing 0 wants
 * that counter let for nothing, and refusing the save would leave them stuck on
 * the old figure with no way to express it.
 */
export function normaliseUnitEdit(body: Record<string, unknown>): {
  patch: Partial<MallUnit>;
  error: string | null;
} {
  const patch: Partial<MallUnit> = {};

  if (body.floor !== undefined) {
    const floor = String(body.floor ?? "").trim().slice(0, 24);
    if (!floor) return { patch: {}, error: "A unit needs a floor." };
    patch.floor = floor;
  }

  if (body.number !== undefined) {
    const number = String(body.number ?? "").trim().toUpperCase().slice(0, 24);
    if (!number) return { patch: {}, error: "A unit needs a shop number." };
    patch.number = number;
  }

  if (body.monthlyRentEtb !== undefined) {
    const price = Number(body.monthlyRentEtb);
    if (!Number.isFinite(price) || price < 0) {
      return { patch: {}, error: "Monthly rent must be zero or more." };
    }
    patch.monthlyRentEtb = Math.round(price);
  }

  if (body.sizeSqm !== undefined) {
    const size = Number(body.sizeSqm);
    if (!Number.isFinite(size) || size <= 0) {
      return { patch: {}, error: "Size must be greater than zero." };
    }
    patch.sizeSqm = Math.round(size);
  }

  if (body.listable !== undefined) {
    patch.listable = body.listable !== false && body.listable !== "false";
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (status !== "available" && status !== "held" && status !== "leased") {
      return { patch: {}, error: "Unknown unit status." };
    }
    patch.status = status;
  }

  return { patch, error: null };
}

/**
 * Can this mall be deleted?
 *
 * Refuses while any store trades in it or any lease is live. That is not caution
 * for its own sake: deleting a mall with tenants would leave stores pointing at
 * a directory row that no longer exists - the exact invisible-data failure
 * Section 17's "do not delete products" rule exists to prevent one level up.
 */
export function canDeleteMall(
  mall: Mall,
  businesses: readonly { id: string; mall?: { mallId?: string | null } | null }[],
  leases: readonly StoreLease[],
): { allowed: boolean; storeCount: number; activeLeases: number; reason: string } {
  const storeCount = businesses.filter((business) => business.mall?.mallId === mall.id).length;
  const activeLeases = leases.filter((lease) => lease.mallId === mall.id && lease.active).length;

  if (storeCount > 0) {
    return {
      allowed: false,
      storeCount,
      activeLeases,
      reason:
        `${storeCount} store${storeCount === 1 ? "" : "s"} still trade in this mall. ` +
        `Move or close ${storeCount === 1 ? "it" : "them"} first.`,
    };
  }
  if (activeLeases > 0) {
    return {
      allowed: false,
      storeCount,
      activeLeases,
      reason:
        `${activeLeases} lease${activeLeases === 1 ? " is" : "s are"} still active. ` +
        `End ${activeLeases === 1 ? "it" : "them"} first.`,
    };
  }
  return {
    allowed: true,
    storeCount,
    activeLeases,
    reason: "Safe to delete. No stores trade here and no lease is active.",
  };
}