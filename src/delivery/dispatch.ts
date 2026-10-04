/**
 * ============================================================================
 *  DISPATCH ENGINE - candidate selection and offer routing
 * ============================================================================
 *
 *  PURE. It decides WHO should be asked and in what ORDER; it performs no IO,
 *  writes nothing and knows nothing about HTTP. The server layer supplies the
 *  driver list and persists the offers this produces.
 *
 *  WHY RANKING IS LOCAL MATHS AND NOT A PROVIDER CALL
 *  ---------------------------------------------------
 *  Asking a routing provider for the distance to every candidate is how a
 *  dispatch loop becomes a request storm: one new delivery would fan out to
 *  dozens of upstream calls before a single driver was notified. Haversine is
 *  exact enough to RANK candidates, costs nothing and cannot fail. The provider
 *  is consulted once, for the route that will actually be driven.
 *
 *  THE FOUR FILTERS, IN ORDER
 *  --------------------------
 *  1. VERIFIED  - APPROVED. An unverified driver is never a candidate, and no
 *                 parameter can relax this.
 *  2. ONLINE    - availability ONLINE, not BUSY or OFFLINE.
 *  3. SUITABLE  - the vehicle matches and can carry the parcel.
 *  4. NEARBY    - within the radius, with a position recent enough to trust.
 *
 *  BUSY IS DERIVED, NOT STORED
 *  ---------------------------
 *  A driver with an unfinished delivery cannot be offered another one, and
 *  deriving that from the live delivery list is what makes it impossible for two
 *  records to disagree about whether somebody is free.
 */

import { haversineKm, isValidPoint } from "./geo";
import { vehicleFits } from "./pricing";
import type {
  Delivery,
  DeliveryOffer,
  DeliveryPricingConfig,
  DriverLocation,
  DriverProfile,
  PackageSpec,
  VehicleSpec,
} from "./types";

/** A position older than this is treated as absent. */
export const STALE_LOCATION_SEC = 120;

/** A driver as the engine sees them: the profile plus where they are. */
export interface DispatchCandidate {
  driver: DriverProfile;
  location: DriverLocation | null;
}

export interface DispatchRequest {
  pickup: { latitude: number; longitude: number };
  vehicleType: Delivery["vehicleType"];
  packageSpec: PackageSpec;
  /** How far from the pickup to look. */
  radiusKm: number;
  /** At most this many drivers are asked at once. */
  maxOffers: number;
  now?: number;
}

export type ExcludeReason =
  | "not-approved"
  | "not-online"
  | "already-busy"
  | "wrong-vehicle"
  | "cannot-carry-package"
  | "no-recent-location"
  | "too-far";

/** One ranked candidate, before an offer row exists. */
export interface RankedCandidate {
  driverId: string;
  /** Straight-line km to the PICKUP - what the driver travels next. */
  distanceKm: number;
  /** 1 = asked first. 0 = not offered. */
  rank: number;
  /** Why this driver was excluded, when they were. Never shown to a customer. */
  excluded: ExcludeReason | null;
}

/** Why a candidate was dropped. Lets the admin see supply instead of guessing. */
export function describeExclusion(reason: ExcludeReason): string {
  switch (reason) {
    case "not-approved":
      return "not approved by Yene Business Group";
    case "not-online":
      return "not online";
    case "already-busy":
      return "already carrying another delivery";
    case "wrong-vehicle":
      return "drives a different vehicle type";
    case "cannot-carry-package":
      return "vehicle cannot carry this parcel";
    case "no-recent-location":
      return "has not reported a position recently";
    case "too-far":
      return "further away than the search radius";
  }
}

/** A status that still holds a driver. Mirrors status.ts without importing it. */
function holdsDriver(status: Delivery["status"]): boolean {
  return status !== "DELIVERED" && status !== "CANCELLED" && status !== "FAILED" && status !== "RETURNED";
}

/**
 * Which drivers are committed right now, derived from the live deliveries.
 *
 * A driver who abandoned a job releases it, because FAILED and RETURNED are
 * terminal - so the next job needs no administrator intervention.
 */
export function activeDriverDeliveries(deliveries: Delivery[]): Map<string, Delivery> {
  const active = new Map<string, Delivery>();
  for (const delivery of deliveries) {
    if (delivery.driverId && holdsDriver(delivery.status)) active.set(delivery.driverId, delivery);
  }
  return active;
}

function excluded(driverId: string, reason: ExcludeReason): RankedCandidate {
  return { driverId, distanceKm: Number.POSITIVE_INFINITY, rank: 0, excluded: reason };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank the candidates and choose who to ask.
 *
 * Returns EVERY candidate with a reason attached - including the rejected ones -
 * so the admin dispatch screen can answer "why was nobody assigned?" instead of
 * showing an empty map. Only `excluded === null` entries are offered, up to
 * `maxOffers` of them.
 */
export function rankCandidates(
  candidates: DispatchCandidate[],
  request: DispatchRequest,
  busyDrivers: Map<string, Delivery>,
  vehicles: VehicleSpec[],
): RankedCandidate[] {
  const now = request.now ?? Date.now();
  const vehicle = vehicles.find((entry) => entry.type === request.vehicleType) ?? null;

  const evaluated: RankedCandidate[] = candidates.map((candidate) => {
    const { driver, location } = candidate;

    // 1. Verified. Checked FIRST, so an unapproved driver's location is never
    //    even measured - there is no reason to learn where they are.
    if (driver.status !== "APPROVED") return excluded(driver.id, "not-approved");

    // 2. Available. A SUSPENDED driver stays visible to the admin but is offered
    //    nothing.
    if (driver.availability !== "ONLINE") {
      return excluded(driver.id, driver.availability === "BUSY" ? "already-busy" : "not-online");
    }

    // A driver committed to an unfinished job is BUSY even when their own flag
    // says otherwise. This is the reconciliation that keeps two records
    // consistent with each other.
    if (busyDrivers.has(driver.id)) return excluded(driver.id, "already-busy");

    // 3. Suitable.
    if (driver.vehicle.type !== request.vehicleType) return excluded(driver.id, "wrong-vehicle");
    if (vehicle && !vehicleFits(vehicle, request.packageSpec)) {
      // The PARCEL cannot travel by this class at all, so no driver of this type
      // can help. Worth surfacing rather than failing silently.
      return excluded(driver.id, "cannot-carry-package");
    }

    // 4. Nearby.
    if (!location || !isValidPoint(location)) return excluded(driver.id, "no-recent-location");
    // A position from an hour ago is not a location. Without this filter a driver
    // who went home still ranks first for their own neighbourhood.
    const ageSec = (now - new Date(location.at).getTime()) / 1000;
    if (!Number.isFinite(ageSec) || ageSec > STALE_LOCATION_SEC) {
      return excluded(driver.id, "no-recent-location");
    }

    const distanceKm = haversineKm(request.pickup, location);
    if (!Number.isFinite(distanceKm) || distanceKm > request.radiusKm) {
      return excluded(driver.id, "too-far");
    }

    return {
      driverId: driver.id,
      // Two decimals is finer than GPS resolution and stops the offer list
      // flickering between "2.41" and "2.42" on successive pings.
      distanceKm: Math.round(distanceKm * 100) / 100,
      rank: 0,
      excluded: null,
    };
  });

  // Nearest first, breaking ties on the id so two drivers at the same point give
  // a STABLE order. Without the tiebreak, a reshuffle between two pings could
  // skip the better-placed driver and re-offer the job to the same one.
  const eligible = evaluated
    .filter((entry) => entry.excluded === null)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.driverId.localeCompare(b.driverId))
    .slice(0, Math.max(0, request.maxOffers));

  const rankById = new Map(eligible.map((entry, index) => [entry.driverId, index + 1]));

  return evaluated
    .map((entry) => ({ ...entry, rank: rankById.get(entry.driverId) ?? 0 }))
    .sort((a, b) => {
      // Offered drivers first in rank order; excluded drivers after, grouped by
      // reason, so the admin list reads as "supply, then gaps".
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      if (a.excluded !== b.excluded) return String(a.excluded).localeCompare(String(b.excluded));
      return a.driverId.localeCompare(b.driverId);
    });
}

/** The offers the server should write, in rank order. */
export function selectOfferedDrivers(ranked: RankedCandidate[]): RankedCandidate[] {
  return ranked.filter((entry) => entry.excluded === null && entry.rank > 0);
}

/**
 * Which offers are still live, and who to ask next if the batch expires.
 *
 * When several offers expire together, the driver who was asked LONGEST ago is
 * offered the next batch first. Without that, a driver who ignored the last two
 * jobs keeps being pushed to the back and the job spins between the same two
 * people forever.
 */
export function nextBatch(
  offers: Pick<DeliveryOffer, "driverId" | "state" | "createdAt">[],
  eligible: RankedCandidate[],
  now = Date.now(),
): RankedCandidate[] {
  void now;
  const pending = new Set(offers.filter((offer) => offer.state === "pending").map((o) => o.driverId));

  // Least recently asked first.
  const askedOrder = new Map<string, string>();
  for (const offer of offers) {
    const previous = askedOrder.get(offer.driverId);
    if (!previous || offer.createdAt < previous) askedOrder.set(offer.driverId, offer.createdAt);
  }

  return [...eligible].sort((a, b) => {
    // Someone who has already ignored an offer goes FIRST on the next batch.
    const aAsked = askedOrder.has(a.driverId) ? 0 : 1;
    const bAsked = askedOrder.has(b.driverId) ? 0 : 1;
    if (aAsked !== bAsked) return aAsked - bAsked;
    if (pending.has(a.driverId) !== pending.has(b.driverId)) return pending.has(a.driverId) ? 1 : -1;
    return a.rank - b.rank;
  });
}

/** Has this delivery been searching too long to be worth continuing? */
export function searchExpired(requestedAt: string, config: DeliveryPricingConfig, now = Date.now()): boolean {
  const started = new Date(requestedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started > config.searchTimeoutSec * 1000;
}

/**
 * Turn candidates into offer rows.
 *
 * The `id` is a PLACEHOLDER the server replaces, so this stays pure and
 * testable: no clock, no randomness, no storage.
 */
export function buildOffers(
  offered: RankedCandidate[],
  deliveryId: string,
  offerTtlSec: number,
  now = Date.now(),
): Array<Omit<DeliveryOffer, "id">> {
  const expiresAt = new Date(now + offerTtlSec * 1000).toISOString();
  const createdAt = new Date(now).toISOString();
  return offered.map((candidate) => ({
    deliveryId,
    driverId: candidate.driverId,
    pickupDistanceKm: candidate.distanceKm,
    state: "pending" as const,
    expiresAt,
    createdAt,
    respondedAt: null,
    rank: candidate.rank,
  }));
}
