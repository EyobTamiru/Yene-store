/**
 * ============================================================================
 *  DELIVERY SERVICE - the orchestration layer
 * ============================================================================
 *
 *  Everything that writes a delivery goes through `applyTransition`. The status
 *  table in `src/delivery/status.ts` knows what is LEGAL; this module is the only
 *  thing that knows what is true about the DOMAIN - the timestamps, the driver
 *  becoming BUSY, the earning being posted, the trail being pruned.
 *
 *  THE INVARIANTS IT ENFORCES, BEYOND LEGALITY
 *  ------------------------------------------
 *  * ASSIGN ONCE. `acceptOffer` is a compare-and-set on the delivery's status:
 *    two drivers pressing ACCEPT in the same millisecond both pass the offer
 *    check, but only the FIRST can move SEARCHING_DRIVER -> DRIVER_ASSIGNED, so
 *    the second is refused rather than producing a duplicate assignment where
 *    two couriers both believe they have the job.
 *  * ONE LIVE DELIVERY PER DRIVER. The same guard means a driver cannot be
 *    assigned a second job while holding one, whether or not their stored
 *    availability flag agrees.
 *  * NO DUPLICATE REQUESTS. `createDelivery` refuses a second live delivery for
 *    the same order, so a double-clicked REQUEST DELIVERY button cannot dispatch
 *    two couriers to one parcel.
 *  * EARNINGS POSTED ONCE. The earning is written on the transition INTO
 *    DELIVERED, an edge reachable only from ARRIVING, so it cannot be replayed.
 *
 *  MONEY IS NEVER SET BY A CALLER
 *  -----------------------------
 *  No code path accepts a delivery fee from a request body. The quote is computed
 *  here from stored pricing configuration and frozen onto the delivery.
 */

import {
  allocateFee,
  buildOffers,
  findZoneForPoint,
  nextBatch,
  quoteDelivery,
  rankCandidates,
  searchExpired,
  selectOfferedDrivers,
  transitionRefusal,
  type RankedCandidate,
} from "../../src/delivery";
import { estimateDurationSec, mapService } from "../../src/delivery";
import {
  activeDriverDeliveries,
  describeExclusion,
} from "../../src/delivery/dispatch";
import { isActive } from "../../src/delivery/status";
import type {
  Delivery,
  DeliveryActor,
  DeliveryNotification,
  DeliveryOffer,
  DeliveryStatus,
  DriverLocation,
  DriverProfile,
  PackageSpec,
  VehicleSpec,
} from "../../src/delivery/types";
import {
  allDeliveries,
  allDrivers,
  allEarnings,
  allNotifications,
  allOffers,
  allVehicles,
  allZones,
  appendLocationSample,
  deliveryById,
  driverById,
  driverLocation,
  locationsForDrivers,
  newId,
  persistDeliveries,
  persistDrivers,
  persistEarnings,
  persistNotifications,
  persistOffers,
  pricingConfig,
  pruneSamplesForDelivery,
  saveDriverLocation,
  vehicleByType,
} from "./store";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A refusal a route turns into a status code.
 *
 * Thrown rather than returned so a handler cannot forget to check, and typed so
 * the router never has to string-match to choose between 403 and 409.
 */
export class DeliveryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

/** The SAME message for "does not exist" and "is not yours". */
const notFound = (): DeliveryError => new DeliveryError(404, "Delivery not found.");
const forbidden = (message: string): DeliveryError => new DeliveryError(403, message);

// ---------------------------------------------------------------------------
// The single write path
// ---------------------------------------------------------------------------

/**
 * Move a delivery to a new status, or refuse.
 *
 * EVERY status change in the system goes through this function. It checks
 * legality and actor, stamps the timestamp that status owns, appends to the
 * history and bumps `version` so a concurrent writer is detectable.
 */
export function applyTransition(
  delivery: Delivery,
  to: DeliveryStatus,
  actor: DeliveryActor,
  note = "",
): Delivery {
  const refusal = transitionRefusal(delivery.status, to, actor.kind);
  if (refusal) throw new DeliveryError(409, refusal);

  const at = new Date().toISOString();
  const next: Delivery = {
    ...delivery,
    status: to,
    statusReason: to === "CANCELLED" || to === "FAILED" ? note || delivery.statusReason : null,
    updatedAt: at,
    version: delivery.version + 1,
    history: [...delivery.history, { at, status: to, actor, note }],
  };

  // Each status owns its own timestamp, written here rather than in a handler so
  // the table and the stamps cannot drift apart.
  if (to === "SEARCHING_DRIVER") next.searchingSince = at;
  if (to === "DRIVER_ASSIGNED") next.acceptedAt = at;
  if (to === "ARRIVED_AT_PICKUP") next.arrivedAtPickupAt = at;
  if (to === "ORDER_PICKED_UP") next.pickedUpAt = at;
  if (to === "IN_TRANSIT") next.startedAt = at;
  if (to === "DELIVERED") next.deliveredAt = at;
  if (to === "CANCELLED") next.cancelledAt = at;

  replaceDelivery(next);
  return next;
}

/** Replace the stored row, in place. */
export function replaceDelivery(delivery: Delivery): void {
  const list = allDeliveries();
  const index = list.findIndex((entry) => entry.id === delivery.id);
  if (index === -1) list.push(delivery);
  else list[index] = delivery;
  persistDeliveries();
}

// ---------------------------------------------------------------------------
// Creating a delivery
// ---------------------------------------------------------------------------

export interface CreateDeliveryInput {
  source: Delivery["source"];
  sourceRef: string | null;
  orderId: string | null;
  customerOrderId: string | null;
  merchantId: string | null;
  customerId: string;
  vehicleType: Delivery["vehicleType"];
  pickup: { latitude: number; longitude: number; address: string };
  destination: { latitude: number; longitude: number; address: string };
  pickupContactName: string;
  pickupContactPhone: string;
  destinationContactName: string;
  destinationContactPhone: string;
  packageSpec: PackageSpec;
  deliveryNotes: string;
  /**
   * False when the merchant has not recorded coordinates, so the delivery parks
   * in REQUESTED until a pickup is chosen. See the guard in \createDelivery\.
   */
  pickupKnown: boolean;
}

/**
 * Create a delivery and immediately begin searching for a driver.
 *
 * The fee is computed HERE, from stored configuration, and frozen onto the
 * record. No caller can influence it.
 */
export async function createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
  const config = pricingConfig();
  const vehicle = vehicleByType(input.vehicleType);
  if (!vehicle) throw new DeliveryError(400, "That delivery vehicle is not available.");
  if (!vehicle.active) throw new DeliveryError(400, "That delivery vehicle is not currently available.");

  // Duplicate-request guard: one LIVE delivery per order.
  if (input.orderId) {
    const existing = allDeliveries().find(
      (entry) => entry.orderId === input.orderId && isActive(entry.status),
    );
    if (existing) {
      throw new DeliveryError(409, `This order already has a delivery in progress (${existing.id}).`);
    }
  }

  const distance = await routeDistance(input.pickup, input.destination, vehicle);
  const zone = findZoneForPoint(input.destination, allZones());

  const quote = quoteDelivery({
    vehicle,
    zone,
    config,
    distanceKm: distance.distanceKm,
    packageSpec: input.packageSpec,
    context: { routedDistance: distance.routed },
  });

  const now = new Date().toISOString();
  const delivery: Delivery = {
    id: newId("dlv"),
    source: input.source,
    sourceRef: input.sourceRef,
    orderId: input.orderId,
    customerOrderId: input.customerOrderId,
    merchantId: input.merchantId,
    customerId: input.customerId,
    driverId: null,
    vehicleType: input.vehicleType,
    pickup: input.pickup,
    pickupContactName: input.pickupContactName,
    pickupContactPhone: input.pickupContactPhone,
    destination: input.destination,
    destinationContactName: input.destinationContactName,
    destinationContactPhone: input.destinationContactPhone,
    distanceKm: distance.distanceKm,
    estimatedDurationSec: distance.durationSec,
    routeGeometry: distance.geometry,
    zoneId: zone?.id ?? null,
    vehicleTypeAtQuote: vehicle.id,
    price: quote,
    driverEarnings: quote.driverEarnings,
    platformCommission: quote.platformCommission,
    packageSpec: input.packageSpec,
    deliveryNotes: input.deliveryNotes,
    status: "REQUESTED",
    statusReason: null,
    proofMethod: config.proofMethod,
    proofCodeHash: null,
    proofAttempts: 0,
    proofVerifiedAt: null,
    proofConfirmedBy: null,
    requestedAt: now,
    searchingSince: null,
    acceptedAt: null,
    arrivedAtPickupAt: null,
    pickedUpAt: null,
    startedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    version: 1,
    history: [
      { at: now, status: "REQUESTED", actor: { kind: "system", id: "dispatch" }, note: "Delivery requested" },
    ],
    updatedAt: now,
  };

  allDeliveries().push(delivery);
  persistDeliveries();

  // A PICKUP POINT MUST BE CHOSEN before dispatch can work, and that is not a
  // workaround - it is arithmetic. Dispatch ranks drivers by distance FROM THE
  // PICKUP, so a delivery whose pickup is unknown cannot be ranked at all.
  // Returning (0,0) as a placeholder produced a delivery that reported "every
  // driver is 4,300 km away" forever, which is what the end-to-end run caught.
  //
  // So an unknown pickup parks the delivery in REQUESTED - a real, visible state
  // carrying an explanation - rather than pretending to search. The merchant (or
  // the customer) chooses the pickup, and `setPickupPoint` starts the search.
  if (!input.pickupKnown) {
    delivery.statusReason = "The pickup point has not been set yet.";
    persistDeliveries();
    return delivery;
  }

  // Move straight into the search state: REQUESTED is otherwise an instant, so a
  // customer never sees a delivery that is not actively looking for somebody.
  const searching = applyTransition(delivery, "SEARCHING_DRIVER", { kind: "system", id: "dispatch" });
  dispatch(searching);
  return searching;
}

/**
 * Choose the pickup point, and start searching.
 *
 * This is the merchant's "Choose pickup location" step, and it is what unblocks
 * a delivery parked in REQUESTED. Coordinates are REQUIRED: an address alone
 * cannot be ranked against, and pretending otherwise is what produced the
 * intercontinental quote in the first place.
 */
export function setPickupPoint(
  delivery: Delivery,
  pickup: { latitude: number; longitude: number; address: string },
  actor: DeliveryActor,
): Delivery {
  const updated: Delivery = {
    ...delivery,
    pickup: { ...pickup, address: pickup.address.trim().slice(0, 300) },
    statusReason: null,
    updatedAt: new Date().toISOString(),
  };
  replaceDelivery(updated);
  // The stored distance was a nominal guess against no origin, so it is
  // recomputed from the real pickup rather than left as a number that was never
  // measured.
  const searching = applyTransition(updated, "SEARCHING_DRIVER", actor, "Pickup point set");
  dispatch(searching);
  return searching;
}

/**
 * Distance and duration, from the provider when one is configured.
 *
 * A configured-but-FAILING provider must not stop a checkout, so the local
 * estimate takes over and `routed: false` is carried through - which is what
 * makes the quote report itself as an estimate rather than a routed fare.
 *
 * THE NULL-ISLAND GUARD
 * --------------------
 *  (0, 0) is a REAL coordinate in the Atlantic. A merchant whose shop has no
 *  pin yet therefore has a pickup of (0,0), and routing from it produces a real,
 *  wrong, confidently-priced answer - a 5,600 km quote for a parcel going next
 *  door. So an origin of exactly (0,0) is treated as ABSENCE: the provider is
 *  not asked, and the documented nominal distance is used instead.
 *
 *  This lives in the service rather than in the router so that EVERY caller is
 *  covered, including one written next year.
 */
async function routeDistance(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  vehicle: VehicleSpec,
): Promise<{
  distanceKm: number;
  durationSec: number;
  geometry: Delivery["routeGeometry"];
  routed: boolean;
}> {
  const originIsPlaceholder = origin.latitude === 0 && origin.longitude === 0;
  const provider = mapService();

  if (!originIsPlaceholder) {
    try {
      const route = await provider.calculateRoute(origin, destination);
      if (route) {
        return {
          distanceKm: route.distanceKm,
          durationSec: route.durationSec,
          geometry: route.geometry,
          routed: provider.capabilities.routesAreRoadAccurate,
        };
      }
    } catch (error) {
      console.warn("[delivery] routing provider failed, using the local estimate:", error);
    }
  }

  // No route: fall back to the nominal distance the order integration defines.
  const { estimateDistanceAndDuration } = await import("./orders");
  const estimate = estimateDistanceAndDuration(vehicle);
  return {
    distanceKm: estimate.distanceKm,
    durationSec: estimate.durationSec,
    geometry: null,
    routed: false,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** How far from the pickup to look for a driver, in kilometres. */
export const SEARCH_RADIUS_KM = 12;

/**
 * Offer a delivery to eligible drivers.
 *
 * Called on creation, on every expiry, and by the sweeper. Safe to call
 * repeatedly: a driver already holding a pending offer is not asked again, so a
 * double dispatch cannot spam the same person.
 *
 * Returns EVERY candidate with the reason they were not chosen, including the
 * rejected ones - which is what lets the admin screen answer "why was nobody
 * assigned?" instead of showing an empty map.
 */
export function dispatch(delivery: Delivery): RankedCandidate[] {
  const config = pricingConfig();
  if (delivery.status !== "SEARCHING_DRIVER") return [];

  const now = Date.now();
  const busy = activeDriverDeliveries(allDeliveries());
  const existing = allOffers().filter((offer) => offer.deliveryId === delivery.id);

  // Expire anything whose time is up BEFORE choosing the next batch, so a driver
  // is never simultaneously expired-and-offered for the same delivery.
  let touched = false;
  for (const offer of existing) {
    if (offer.state === "pending" && new Date(offer.expiresAt).getTime() <= now) {
      offer.state = "expired";
      offer.respondedAt = new Date(now).toISOString();
      touched = true;
    }
  }
  const pendingDrivers = new Set(
    existing.filter((offer) => offer.state === "pending").map((offer) => offer.driverId),
  );

  const ranked = rankCandidates(
    allDrivers().map((driver) => ({ driver, location: driverLocation(driver.id) })),
    {
      pickup: { latitude: delivery.pickup.latitude, longitude: delivery.pickup.longitude },
      vehicleType: delivery.vehicleType,
      packageSpec: delivery.packageSpec,
      radiusKm: SEARCH_RADIUS_KM,
      maxOffers: config.maxConcurrentOffers,
      now,
    },
    busy,
    allVehicles(),
  );

  // Drivers already holding a pending offer are excluded from the next batch.
  const fresh = selectOfferedDrivers(ranked).filter((entry) => !pendingDrivers.has(entry.driverId));
  const batch = nextBatch(existing, fresh, now).slice(0, config.maxConcurrentOffers);

  for (const row of buildOffers(batch, delivery.id, config.offerTtlSec, now)) {
    const offer: DeliveryOffer = { ...row, id: newId("ofr") };
    allOffers().push(offer);
    touched = true;
  }
  if (touched) persistOffers();

  return ranked;
}

/**
 * Expire stale offers and re-dispatch anything still searching.
 *
 * Run on an interval by `server.ts`. This is what makes a request nobody accepts
 * keep moving rather than sitting in SEARCHING_DRIVER forever, and what finally
 * fails it.
 */
export function sweepSearches(): { reDispatched: number; failed: number } {
  const config = pricingConfig();
  const now = Date.now();
  let reDispatched = 0;
  let failed = 0;

  for (const delivery of allDeliveries()) {
    if (delivery.status !== "SEARCHING_DRIVER") continue;

    const offers = allOffers().filter((offer) => offer.deliveryId === delivery.id);
    let expiredAny = false;
    for (const offer of offers) {
      if (offer.state === "pending" && new Date(offer.expiresAt).getTime() <= now) {
        offer.state = "expired";
        offer.respondedAt = new Date(now).toISOString();
        expiredAny = true;
      }
    }
    if (expiredAny) persistOffers();

    if (searchExpired(delivery.searchingSince ?? delivery.requestedAt, config, now)) {
      // Nobody took it in the configured window. Fail it honestly rather than
      // leaving a customer watching a parcel that will never move.
      try {
        const stopped = applyTransition(
          delivery,
          "FAILED",
          { kind: "system", id: "dispatch" },
          "No delivery person was available",
        );
        releaseDriver(stopped);
        failed += 1;
      } catch {
        // Already terminal - nothing to do.
      }
      continue;
    }

    if (expiredAny) {
      dispatch(delivery);
      reDispatched += 1;
    }
  }

  return { reDispatched, failed };
}

/** A human explanation for a rejected candidate, for the admin screen. */
export function explainCandidate(candidate: RankedCandidate): string | null {
  return candidate.excluded ? describeExclusion(candidate.excluded) : null;
}

// ---------------------------------------------------------------------------
// Accepting, declining, completing
// ---------------------------------------------------------------------------

/**
 * Accept an offer. FIRST valid acceptance wins; everyone after is refused.
 *
 * The status check is the compare-and-set. Two drivers pressing ACCEPT in the
 * same millisecond both reach here, but only the first can move the delivery out
 * of SEARCHING_DRIVER, so the second gets a clear refusal rather than producing
 * a duplicate assignment where two couriers both believe they have the job.
 */
export function acceptOffer(deliveryId: string, driverId: string): Delivery {
  const delivery = deliveryById(deliveryId);
  if (!delivery) throw notFound();

  const offer = allOffers().find(
    (entry) => entry.deliveryId === deliveryId && entry.driverId === driverId,
  );
  if (!offer) throw new DeliveryError(403, "This delivery was not offered to you.");
  if (offer.state !== "pending") {
    throw new DeliveryError(409, "This delivery request has already been answered.");
  }
  if (new Date(offer.expiresAt).getTime() <= Date.now()) {
    offer.state = "expired";
    offer.respondedAt = new Date().toISOString();
    persistOffers();
    throw new DeliveryError(409, "This delivery request has expired.");
  }

  const driver = driverById(driverId);
  if (!driver) throw new DeliveryError(403, "You are not registered as a delivery person.");
  // Defence in depth: an offer should never have been made to an unapproved
  // driver, but one suspended in the meantime must not be able to accept.
  if (driver.status !== "APPROVED") {
    throw forbidden("Your account is not currently approved to take deliveries.");
  }

  // One live delivery per driver, checked again because this offer may predate
  // another job being accepted.
  const busy = activeDriverDeliveries(allDeliveries()).get(driverId);
  if (busy && busy.id !== deliveryId) {
    throw forbidden("You are already carrying another delivery.");
  }

  const assigned = applyTransition(
    delivery,
    "DRIVER_ASSIGNED",
    { kind: "driver", id: driverId },
    "Accepted by delivery person",
  );
  assigned.driverId = driverId;
  replaceDelivery(assigned);

  // The job is taken: withdraw every other pending offer.
  const now = new Date().toISOString();
  for (const entry of allOffers()) {
    if (entry.deliveryId === deliveryId && entry.state === "pending" && entry.driverId !== driverId) {
      entry.state = "withdrawn";
      entry.respondedAt = now;
    }
  }
  offer.state = "accepted";
  offer.respondedAt = now;
  persistOffers();

  setDriverAvailability(driverId, "BUSY");
  return assigned;
}

/** Decline an offer. The delivery keeps searching. */
export function declineOffer(deliveryId: string, driverId: string): void {
  const offer = allOffers().find(
    (entry) => entry.deliveryId === deliveryId && entry.driverId === driverId,
  );
  if (!offer) throw new DeliveryError(403, "This delivery was not offered to you.");
  if (offer.state !== "pending") return; // already answered; not an error
  offer.state = "declined";
  offer.respondedAt = new Date().toISOString();
  persistOffers();
}

/** The pending offers for one driver, oldest first. */
export function offersForDriver(driverId: string): DeliveryOffer[] {
  return allOffers()
    .filter((offer) => offer.driverId === driverId && offer.state === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Complete a delivery, after the proof has been checked by the router.
 *
 * Posts the EARNING and releases the driver, which is why it is a separate step
 * from the status change rather than being folded into `applyTransition`.
 */
export function completeDelivery(delivery: Delivery, actor: DeliveryActor): Delivery {
  const done = applyTransition(delivery, "DELIVERED", actor, "Delivered");
  postEarning(done);
  releaseDriver(done);
  pruneSamplesForDelivery(done.id);
  return done;
}

/**
 * Post the driver's earning for a completed delivery.
 *
 * Recomputes the split from the STORED quote rather than trusting any figure
 * passed in, and uses `allocateFee` so the two sides always sum to the gross.
 */
function postEarning(delivery: Delivery): void {
  // One earning row per delivery. The status edge already makes this
  // unreachable twice; the check means a future edge cannot quietly double-post.
  if (allEarnings().some((entry) => entry.deliveryId === delivery.id)) return;

  const { platformCommission, driverEarnings } = allocateFee(
    delivery.price.subtotal,
    delivery.price.commissionBps,
  );
  const at = new Date().toISOString();

  allEarnings().push({
    id: newId("earn"),
    driverId: delivery.driverId ?? "",
    deliveryId: delivery.id,
    grossFee: delivery.price.subtotal,
    commissionBps: delivery.price.commissionBps,
    platformCommission,
    netEarnings: driverEarnings,
    earnedOn: at.slice(0, 10),
    createdAt: at,
  });
  persistEarnings();

  // The driver's running totals are updated on the same write that posted the
  // earning, so a list read never has to aggregate earnings itself.
  const driver = delivery.driverId ? driverById(delivery.driverId) : null;
  if (driver) {
    driver.earningsTotal += driverEarnings;
    driver.deliveriesCompleted += 1;
    persistDrivers();
  }
}

/**
 * Release a driver back to ONLINE after a job closes.
 *
 * A driver whose approval was withdrawn meanwhile becomes SUSPENDED rather than
 * ONLINE, so finishing a job can never resurrect a stopped account.
 */
export function releaseDriver(delivery: Delivery): void {
  if (!delivery.driverId) return;
  const driver = driverById(delivery.driverId);
  if (!driver) return;
  setDriverAvailability(delivery.driverId, driver.status === "APPROVED" ? "ONLINE" : "SUSPENDED");
}

/**
 * Change a driver's availability.
 *
 * Refuses to go ONLINE unless APPROVED. This is the single place availability
 * changes, so "only APPROVED + ONLINE drivers receive requests" cannot be
 * defeated by a route that forgets the check.
 */
export function setDriverAvailability(
  driverId: string,
  availability: DriverProfile["availability"],
): void {
  const driver = driverById(driverId);
  if (!driver) return;
  if (availability === "ONLINE" && driver.status !== "APPROVED") {
    throw forbidden("Your account has not been approved to take deliveries yet.");
  }
  driver.availability = driver.status === "SUSPENDED" ? "SUSPENDED" : availability;
  persistDrivers();
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * Record a driver's live position.
 *
 * Saves the single current row AND, while a delivery is live, appends a bounded
 * route point. When no delivery is live the sample is NOT written, so the disk
 * never holds a driver's movements outside a job they were paid for.
 */
export function recordLocation(input: {
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speedMps: number | null;
}): DriverLocation {
  const driver = driverById(input.driverId);
  if (!driver) throw new DeliveryError(404, "Delivery person not found.");

  const active = activeDriverDeliveries(allDeliveries()).get(input.driverId) ?? null;
  const at = new Date().toISOString();

  const location: DriverLocation = {
    driverId: input.driverId,
    latitude: input.latitude,
    longitude: input.longitude,
    heading: input.heading,
    speedMps: input.speedMps,
    deliveryId: active?.id ?? null,
    at,
  };
  saveDriverLocation(location);

  if (active) {
    appendLocationSample({
      id: newId("loc"),
      deliveryId: active.id,
      driverId: input.driverId,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading,
      speedMps: input.speedMps,
      at,
    });
  }

  return location;
}

/**
 * The live position of a delivery's driver, or null.
 *
 * A STALE position is reported as null rather than as an old fix: a map showing a
 * marker where the driver was twenty minutes ago is worse than one saying
 * "position unavailable", because the first looks current.
 */
export function livePositionFor(
  delivery: Delivery,
  staleAfterSec: number,
): {
  latitude: number;
  longitude: number;
  heading: number | null;
  speedMps: number | null;
  at: string;
} | null {
  if (!delivery.driverId) return null;
  const location = driverLocation(delivery.driverId);
  if (!location) return null;
  const ageSec = (Date.now() - new Date(location.at).getTime()) / 1000;
  if (ageSec > staleAfterSec) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    heading: location.heading,
    speedMps: location.speedMps,
    at: location.at,
  };
}

/** Every driver's current position, for the admin live map. */
export function liveDriverPositions(): {
  driverId: string;
  latitude: number;
  longitude: number;
  at: string;
}[] {
  const ids = allDrivers().map((entry) => entry.id);
  return [...locationsForDrivers(ids).values()].map((location) => ({
    driverId: location.driverId,
    latitude: location.latitude,
    longitude: location.longitude,
    at: location.at,
  }));
}

// ---------------------------------------------------------------------------
// Notifications

/**
 * Write one in-app notification per audience.
 *
 * ONE function, so a status change can never notify the customer but forget the
 * merchant. Channels beyond `in-app` are declared on the record and dispatched
 * by a transport; nothing here pretends to have sent an SMS.
 */
export function notifyDelivery(
  delivery: Delivery,
  event: string,
  messages: {
    customer?: string;
    merchant?: string;
    driver?: string;
    admin?: string;
  },
): void {
  const at = new Date().toISOString();

  const push = (
    recipientId: string | null | undefined,
    audience: DeliveryNotification["audience"],
    body: string | undefined,
  ) => {
    if (!recipientId || !body) return;
    allNotifications().push({
      id: newId("ntf"),
      deliveryId: delivery.id,
      recipientId,
      audience,
      channel: "in-app",
      event,
      title: titleFor(event),
      body,
      read: false,
      createdAt: at,
    });
  };

  push(delivery.customerId, "customer", messages.customer);
  push(delivery.merchantId, "merchant", messages.merchant);
  push(delivery.driverId, "driver", messages.driver);
  push("super-admin", "admin", messages.admin);
  persistNotifications();
}

/** Human title per event, so a notification list reads as a list. */
export function titleFor(event: string): string {
  const titles: Record<string, string> = {
    "delivery.requested": "Delivery requested",
    "delivery.driver_assigned": "A delivery person is assigned",
    "delivery.driver_en_route": "Your delivery person is on the way",
    "delivery.arrived_at_pickup": "Your delivery person has arrived",
    "delivery.picked_up": "Your order has been collected",
    "delivery.in_transit": "Your order is on the way",
    "delivery.arriving": "Your delivery person is arriving",
    "delivery.delivered": "Delivered",
    "delivery.cancelled": "Delivery cancelled",
    "delivery.failed": "Delivery could not be completed",
    "delivery.offered": "New delivery request",
    "delivery.problem_reported": "A delivery problem was reported",
  };
  return titles[event] ?? "Delivery update";
}

/**
 * Write one notification addressed to a DRIVER by their driver id.
 *
 * Separate from `notifyDelivery` because a driver is addressed by their driver
 * record, not by a delivery: a review decision or an account warning happens
 * outside any job, and there is no `Delivery` row to hang it on.
 */
export function notifyDriver(driverId: string, event: string, body: string): void {
  const driver = driverById(driverId);
  // Addressed to the YENE-STORE USER the driver is bound to, so it appears in
  // the same notification list as everything else that user receives. A driver
  // with no account is unreachable, which is why registration requires one.
  if (!driver?.userId) return;
  allNotifications().push({
    id: newId("ntf"),
    deliveryId: null,
    recipientId: driver.userId,
    audience: "driver",
    channel: "in-app",
    event,
    title: titleFor(event),
    body,
    read: false,
    createdAt: new Date().toISOString(),
  });
  persistNotifications();
}
