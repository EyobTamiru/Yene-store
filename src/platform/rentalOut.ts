/**
 * ============================================================================
 *  STORE RENTAL OUT - renting a storefront to somebody else
 * ============================================================================
 *
 *  THIS IS NOT MALL COUNTER RENTAL
 *  ------------------------------
 *  `api/rental/*` (Sections 10/41) is about renting a physical COUNTER in a mall
 *  from a landlord. This is the opposite direction: an existing Yene business
 *  offering ITS OWN storefront slot to another business, and taking a share in
 *  return. They are separate records, separate routes and separate admin queues,
 *  because conflating them would let somebody rent a shop they do not have.
 *
 *  WHAT IS HANDED OVER, AND WHAT IS NOT
 *  ------------------------------------
 *  A tenant gets the STOREFRONT - the public face, the subdomain, the products
 *  they list, and their own customers.
 *
 *  A tenant does NOT get:
 *    * the owner's account or login,
 *    * the owner's subscription or billing (the owner keeps paying Yene),
 *    * the owner's customers, staff, inventory or delivery records,
 *    * the ability to change the owner's package.
 *
 *  That list is the whole security model of this feature, so it is stated here
 *  and enforced in `applyRentalAgreement` rather than being left to each route.
 *
 *  THE OWNER'S SHARE IS WRITTEN DOWN
 *  ---------------------------------
 *  `ownerShareBps` is a basis-point percentage of the tenant's SUBSCRIPTION, not
 *  of their revenue. Revenue share would require a revenue ledger this platform
 *  does not have, and an approximate number is worse than a defined one.
 */

import type { PackageId } from "./types";

/** The lifecycle of a rental listing. */
export const RENTAL_OUT_STATUSES = [
  "draft",       // the owner has written it but not published it
  "open",        // visible to businesses looking to rent
  "occupied",    // taken by a tenant
  "ended",       // the tenancy has finished
] as const;
export type RentalOutStatus = (typeof RENTAL_OUT_STATUSES)[number];

/** One storefront offered for rent. */
export interface StoreRentalListing {
  id: string;
  /** The business offering the slot. This is the ONLY owner field. */
  ownerBusinessId: string;
  /** A stable name for the slot, e.g. "Bole counter, front". */
  title: string;
  description: string;
  /** Whole ETB per month. 0 means "free" and is explicitly allowed. */
  monthlyRentEtb: number;
  /**
   * The owner's share of the TENANT's subscription, in basis points.
   * 2000 = 20%. A business is advised to set this; nothing is assumed for them.
   */
  ownerShareBps: number;
  /** The tenant, once occupied. */
  tenantBusinessId: string | null;
  status: RentalOutStatus;
  /** The minimum package a business needs to take this slot. */
  minimumPackageId: PackageId;
  createdAt: string;
  updatedAt: string;
  occupiedAt: string | null;
  endedAt: string | null;
}

/**
 * Is this a usable share percentage?
 *
 * 100% would mean the owner takes the tenant's entire Yene subscription and the
 * tenant pays nothing to use the platform - which is not a rental, it is a gift
 * with extra steps. So the ceiling is 9000 (90%).
 */
export const MAX_OWNER_SHARE_BPS = 9_000;

export function isValidShareBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MAX_OWNER_SHARE_BPS;
}

/** "20%" from 2000. */
export function shareLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

/**
 * May this owner offer this slot?
 *
 * A business cannot rent a slot it does not own, and cannot offer a slot on a
 * store that is currently rented to somebody else.
 */
export function canOfferRental(
  business: { id: string; packageId: PackageId } | null,
  listing: StoreRentalListing | null,
): { ok: true } | { ok: false; reason: string } {
  if (!business) return { ok: false, reason: "You do not have a business on Yene." };
  if (listing && listing.ownerBusinessId !== business.id) {
    return { ok: false, reason: "This listing belongs to another business." };
  }
  if (listing && (listing.status === "occupied" || listing.status === "ended")) {
    return { ok: false, reason: "This slot has already been rented out." };
  }
  return { ok: true };
}

/**
 * May this business take this slot?
 *
 * The three refusals, each for a different reason:
 *  - its own slot (nobody rents from themselves),
 *  - one already taken,
 *  - a package below the slot's stated minimum.
 */
export function canRentSlot(
  tenant: { id: string; packageId: PackageId } | null,
  listing: StoreRentalListing,
  packageOrder: readonly PackageId[],
): { ok: true } | { ok: false; reason: string } {
  if (!tenant) return { ok: false, reason: "Sign in with the business that would take this slot." };
  if (tenant.id === listing.ownerBusinessId) {
    return { ok: false, reason: "You already own this slot." };
  }
  if (listing.status !== "open" || listing.tenantBusinessId) {
    return { ok: false, reason: "This slot has already been taken." };
  }
  const tenantTier = packageOrder.indexOf(tenant.packageId);
  const requiredTier = packageOrder.indexOf(listing.minimumPackageId);
  if (tenantTier !== -1 && requiredTier !== -1 && tenantTier < requiredTier) {
    return { ok: false, reason: `This slot requires at least a ${listing.minimumPackageId} package.` };
  }
  return { ok: true };
}

/**
 * What the OWNER earns each month from one occupied slot.
 *
 * Derived from the TENANT's package price, which is the only figure both sides
 * actually agree on. Returns 0 for an unoccupied slot rather than pretending.
 */
export function ownerMonthlyIncome(
  listing: StoreRentalListing,
  tenantPackageId: PackageId | null,
  packagePrice: (id: PackageId) => number,
): number {
  if (listing.status !== "occupied" || !listing.tenantBusinessId || !tenantPackageId) return 0;
  if (!isValidShareBps(listing.ownerShareBps)) return 0;
  const gross = packagePrice(tenantPackageId);
  return Math.round((gross * listing.ownerShareBps) / 10_000);
}

/** The owner-facing projection. Never includes the tenant's business details. */
export function listingForOwner(listing: StoreRentalListing) {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    monthlyRentEtb: listing.monthlyRentEtb,
    ownerShareBps: listing.ownerShareBps,
    status: listing.status,
    minimumPackageId: listing.minimumPackageId,
    createdAt: listing.createdAt,
    occupiedAt: listing.occupiedAt,
    endedAt: listing.endedAt,
    // Only whether it is taken, never WHO took it - the tenant relationship is
    // negotiated between the two businesses, not published.
    occupied: listing.status === "occupied",
  };
}

/** The public listing a prospective tenant may see. */
export function listingForRenters(listing: StoreRentalListing, ownerName: string) {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    monthlyRentEtb: listing.monthlyRentEtb,
    minimumPackageId: listing.minimumPackageId,
    owner: ownerName,
    createdAt: listing.createdAt,
  };
}
