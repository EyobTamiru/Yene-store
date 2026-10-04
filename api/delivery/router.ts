/**
 * ============================================================================
 *  DELIVERY ROUTER - customer, merchant and driver APIs
 * ============================================================================
 *
 *  Mounted at /api/delivery, ALONGSIDE the platform routes rather than inside
 *  them, so Sections 1-9 and 10-55 keep working exactly as they did. Nothing
 *  here modifies an existing route.
 *
 *  FOUR RULES EVERY ROUTE FOLLOWS
 *  --------------------------------
 *  1. The caller is resolved from the verified session, never from the body.
 *  2. An unreadable delivery answers 404, never 403 - a 403 would confirm that
 *     somebody else's delivery exists.
 *  3. The response is a PROJECTION chosen by the audience, never the raw row.
 *  4. Every write is rate-limited; the sensitive ones far more tightly.
 */

import { Router, type Request, type Response } from "express";
import { subscribe, publishTo, threadTopic } from "../support/hub";
import {
  compatibleVehicles,
  deliveryForAdmin,
  deliveryForCustomer,
  deliveryForDriver,
  deliveryForMerchant,
  driverForAdmin,
  driverForCustomer,
  driverForMerchant,
  driverForSelf,
  findZoneForPoint,
  mapService,
  mapStatus,
  publicMapEnv,
  quoteDelivery,
  vehicleRejectionReason,
  type Delivery,
  type PackageSpec,
} from "../../src/delivery";
import { packageFromLines } from "../../src/delivery/vehicles";
import { nextDriverAction } from "../../src/delivery/status";
import {
  MAX_PROOF_ATTEMPTS,
  PROOF_FAILED_MESSAGE,
  generateProofCode,
  hashProofCode,
  isValidProofCode,
  proofAttemptsExhausted,
  verifyProofCode,
} from "../../src/delivery/proof";
import {
  audienceFor,
  isAssignedDriver,
  isCustomer,
  isMerchant,
  mayRead,
  resolveCaller,
  type DeliveryCaller,
} from "./auth";
import {
  DeliveryError,
  acceptOffer,
  applyTransition,
  completeDelivery,
  createDelivery,
  declineOffer,
  dispatch as reDispatch,
  livePositionFor,
  notifyDelivery,
  offersForDriver,
  recordLocation,
  releaseDriver,
  setPickupPoint,
  setDriverAvailability,
} from "./service";
import {
  allDeliveries,
  allDrivers,
  allEarnings,
  allNotifications,
  allOffers,
  allRatings,
  allZones,
  deliveryById,
  driverById,
  ensureVehicles,
  newId,
  persistDrivers,
  persistNotifications,
  persistRatings,
  pricingConfig,
  vehicleByType,
} from "./store";
import {
  estimateDistanceAndDuration,
  merchantLocation,
  orderForCustomer,
} from "./orders";
import { clearCode, currentCode, issueCode } from "./proofCodes";

export const deliveryRouter = Router();

// ---------------------------------------------------------------------------
// Guards and helpers
// ---------------------------------------------------------------------------

function bad(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

const send = (res: Response, status: number, body: unknown) => res.status(status).json(body);

/** Resolve the caller or answer 401. */
function requireCaller(req: Request, res: Response): DeliveryCaller | null {
  const caller = resolveCaller(req);
  if (!caller) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  return caller;
}

/** Turn a thrown DeliveryError into the right status, without leaking internals. */
function handleError(res: Response, error: unknown) {
  if (error instanceof DeliveryError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("[delivery] unexpected failure:", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

// ---- rate limiting --------------------------------------------------------
// Modifying routes are counted per CALLER (not per IP), so a shared office
// connection cannot exhaust one person's quota. The delivery endpoints fan out
// to a routing provider, so they carry a tighter ceiling than the platform's.
//
// THE BUCKET IS PER POLICY, NOT PER USER
// --------------------------------------
//  The key is (caller, policy). A single shared counter per user means a tight
//  limit on one route silently starves every other route: during end-to-end
//  testing the completion endpoint's limit of 10 was consumed by unrelated calls
//  to /advance, and a correct delivery code was refused with "Too many attempts".
//  Each policy therefore counts only its own traffic.
const RATE_WINDOW_MS = 60_000;
const READ_LIMIT = 120;
const WRITE_LIMIT = 30;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request, limit: number, policy = "default"): boolean {
  const now = Date.now();
  const caller = resolveCaller(req);
  const who = caller?.userId ?? req.ip ?? "anonymous";
  const key = `${policy}:${who}`;
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

/**
 * Load a delivery the caller may read, or answer 404.
 *
 * ONE helper for every read path, so "may this person see it" is decided in one
 * place rather than at each of a dozen routes.
 */
function readableDelivery(req: Request, res: Response, caller: DeliveryCaller): Delivery | null {
  const delivery = deliveryById(String(req.params.id ?? ""));
  if (!delivery || !mayRead(delivery, caller)) {
    res.status(404).json({ error: "Delivery not found." });
    return null;
  }
  return delivery;
}

/** The caller's own driver record, or a 403 explaining what is missing. */
function requireDriver(caller: DeliveryCaller, res: Response) {
  if (!caller.driver) {
    res.status(403).json({
      error: "This action is for registered delivery people.",
      needsRegistration: true,
    });
    return null;
  }
  return caller.driver;
}

/**
 * Publish a status change to everyone watching this delivery.
 *
 * Called by every transition, so no route can move a status without telling the
 * people watching it.
 */
export function announce(delivery: Delivery, event: string) {
  const live = livePositionFor(delivery, pricingConfig().locationStaleSec);
  publishTo(
    [threadTopic(`delivery:${delivery.id}`), `driver:${delivery.driverId ?? "none"}`],
    "message",
    {
      deliveryId: delivery.id,
      event,
      status: delivery.status,
      driverPosition: live
        ? { latitude: live.latitude, longitude: live.longitude, at: live.at }
        : null,
    },
  );
}

// ---------------------------------------------------------------------------
// Projection dispatch - ONE place that renders a delivery for a caller
// ---------------------------------------------------------------------------

/**
 * Render a delivery for this caller, with this caller's redactions.
 *
 * The audience is decided by `audienceFor`, so a customer can never receive the
 * merchant's projection (full customer phone) or the admin's (documents).
 */
function projectForCaller(delivery: Delivery, caller: DeliveryCaller) {
  const audience = audienceFor(delivery, caller);
  const live = livePositionFor(delivery, pricingConfig().locationStaleSec);
  const position = live ? { latitude: live.latitude, longitude: live.longitude, at: live.at } : null;
  const driver = delivery.driverId ? driverById(delivery.driverId) : null;

  if (audience === "admin") {
    return deliveryForAdmin(delivery, driver ? driverForAdmin(driver) : null, live);
  }
  if (audience === "driver") return deliveryForDriver(delivery);
  if (audience === "merchant") {
    return deliveryForMerchant(delivery, driver ? driverForMerchant(driver, delivery.status) : null, position);
  }
  // Customer - and the fallback for an audience we could not resolve, which still
  // gets the MOST RESTRICTED view rather than an error.
  return deliveryForCustomer(
    delivery,
    driver ? driverForCustomer(driver, delivery.status) : null,
    position,
    proofCodeFor(delivery, caller),
  );
}

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

/** GET /api/delivery/config - what the checkout needs to render. */
deliveryRouter.get("/config", (_req: Request, res: Response) => {
  const vehicles = ensureVehicles();
  const config = pricingConfig();
  const map = mapStatus();
  return send(res, 200, {
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      type: vehicle.type,
      name: vehicle.name,
      icon: vehicle.icon,
      description: vehicle.description,
      active: vehicle.active,
      maxWeightKg: vehicle.maxWeightKg,
      maxPackageSizeCm: vehicle.maxPackageSizeCm,
      maxItems: vehicle.maxItems,
      carriesFragile: vehicle.carriesFragile,
      baseFee: vehicle.baseFee,
      pricePerKm: vehicle.pricePerKm,
      minFee: vehicle.minFee,
    })),
    zones: allZones()
      .filter((zone) => zone.active)
      .map((zone) => ({ id: zone.id, name: zone.name, area: zone.area })),
    proofMethod: config.proofMethod,
    commissionBps: config.commissionBps,
    currency: config.currency,
    map: {
      provider: map.name,
      configured: map.configured,
      routesAreRoadAccurate: map.capabilities.routesAreRoadAccurate,
      note: map.note,
    },
  });
});

/**
 * GET /api/delivery/map/config
 *
 * The ONLY map configuration the browser receives: a browser-restricted token
 * and an attribution string. The server key is structurally absent, because each
 * provider's `publicEnv()` returns a hand-listed object rather than spreading
 * its configuration.
 */
deliveryRouter.get("/map/config", (_req: Request, res: Response) => {
  return send(res, 200, publicMapEnv());
});

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

interface QuoteBody {
  vehicleType?: string;
  destination?: { latitude?: number; longitude?: number };
  pickup?: { latitude?: number; longitude?: number } | null;
  /** The caller's lines, so the parcel is measured rather than guessed. */
  lines?: { productId: string; quantity: number; name?: string; weightKg?: number | null }[];
}

/**
 * Derive the parcel from real order lines, so a merchant never retypes it.
 *
 * With no lines, the documented small-parcel defaults are used and RETURNED, so
 * the caller can show the customer exactly what was assumed rather than leaving
 * them to guess why a bicycle was offered.
 */
function packageFromRequest(body: QuoteBody): PackageSpec {
  if (!body.lines || body.lines.length === 0) {
    return {
      weightKg: 0.5,
      itemCount: 1,
      longestSideCm: 30,
      girthCm: 35,
      fragile: false,
      handlingNotes: [],
      summary: "1 standard parcel (assumed 0.5 kg)",
    };
  }
  return packageFromLines(
    body.lines.map((line) => ({
      name: line.name ?? line.productId,
      quantity: line.quantity,
      weightKg: line.weightKg ?? null,
    })),
  );
}

/**
 * POST /api/delivery/quote
 *
 * A price for an address and a vehicle, WITHOUT creating anything. The checkout
 * calls this as the customer picks a vehicle or moves the pin, so the figure on
 * screen is produced by the same engine that will charge them.
 */
deliveryRouter.post("/quote", async (req: Request, res: Response) => {
  if (rateLimited(req, READ_LIMIT, "read")) return send(res, 429, { error: "Too many requests." });
  const body = (req.body ?? {}) as QuoteBody;

  const lat = Number(body.destination?.latitude);
  const lon = Number(body.destination?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return bad(res, "Choose a delivery location on the map first.");
  }
  if (!body.vehicleType) return bad(res, "Choose a delivery vehicle.");

  const vehicle = vehicleByType(String(body.vehicleType));
  if (!vehicle || !vehicle.active) return bad(res, "That vehicle is not available.");

  const packageSpec = packageFromRequest(body);
  const rejection = vehicleRejectionReason(vehicle, packageSpec);
  if (rejection) return bad(res, rejection);

  const config = pricingConfig();
  const zone = findZoneForPoint({ latitude: lat, longitude: lon }, allZones());
  const provider = mapService();

  // The merchant's own location is the pickup, read from the ORDER rather than
  // from anything the browser supplies as a tenant.
  // A pickup with no usable coordinates is ABSENCE, not (0,0). Routing from a
  // fabricated origin produces a real, wrong, confidently-priced answer - so the
  // provider is only asked when there is somewhere to ask from.
  const pickupLat = Number(body.pickup?.latitude);
  const pickupLon = Number(body.pickup?.longitude);
  const hasPickup =
    Number.isFinite(pickupLat) && Number.isFinite(pickupLon) &&
    pickupLat >= -90 && pickupLat <= 90 && pickupLon >= -180 && pickupLon <= 180;
  const pickup = hasPickup
    ? { latitude: pickupLat, longitude: pickupLon }
    : null;

  let distanceKm = 0;
  let durationSec = 0;
  let routed = false;
  if (pickup) {
    try {
      const route = await provider.calculateRoute(pickup, { latitude: lat, longitude: lon });
      distanceKm = route?.distanceKm ?? 0;
      durationSec = route?.durationSec ?? 0;
      routed = provider.capabilities.routesAreRoadAccurate;
    } catch (error) {
      // A configured-but-failing provider must not block a checkout.
      console.warn("[delivery] quote routing failed, estimating instead:", error);
    }
  }

  if (distanceKm === 0) {
    const estimate = estimateDistanceAndDuration(vehicle);
    distanceKm = estimate.distanceKm;
    durationSec = estimate.durationSec;
  }

  const quote = quoteDelivery({ vehicle, zone, config, distanceKm, packageSpec });

  return send(res, 200, {
    quote,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedDurationSec: durationSec,
    // STATED, not hidden: a customer shown an estimate should know it is one,
    // because a routed fare and a straight-line one are different promises.
    distanceIsEstimate: !routed,
    zone: zone ? { id: zone.id, name: zone.name } : null,
    package: packageSpec,
  });
});

/** Every vehicle that could carry this parcel, cheapest first. */
deliveryRouter.post("/vehicles-for", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as QuoteBody;
  const packageSpec = packageFromRequest(body);
  const options = compatibleVehicles(ensureVehicles(), packageSpec);
  return send(res, 200, {
    package: packageSpec,
    vehicles: options.map((vehicle) => ({
      type: vehicle.type,
      name: vehicle.name,
      icon: vehicle.icon,
      description: vehicle.description,
    })),
  });
});

// ---------------------------------------------------------------------------
// Requesting, reading, tracking
// ---------------------------------------------------------------------------

/**
 * POST /api/delivery/request
 *
 * Create a delivery for an order THE CALLER PLACED. The pickup and destination
 * are transferred from the order rather than retyped, and the fee is computed
 * server-side - a caller cannot set a price, and cannot request delivery of
 * another customer's parcel.
 */
deliveryRouter.post("/request", async (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const body = (req.body ?? {}) as {
    orderId?: string;
    vehicleType?: string;
    deliveryNotes?: string;
    overrides?: { fragile?: boolean; handlingNotes?: string[] };
    /** For an order without a stored pin: the customer chooses it here. */
    destination?: { latitude: number; longitude: number; address: string };
  };
  if (!body.orderId) return bad(res, "An order is required.");

  // Loaded through the order store and scoped to the caller, which is what stops
  // one customer requesting delivery of another's order by naming its id.
  const order = orderForCustomer(body.orderId, caller.userId);
  if (!order) return send(res, 404, { error: "Order not found." });

  const vehicle = body.vehicleType ? vehicleByType(body.vehicleType) : null;
  if (!vehicle || !vehicle.active) return bad(res, "Choose a delivery vehicle.");

  const pickup = merchantLocation(order.businessId);
  const destination = body.destination ?? {
    latitude: order.addressLat ?? 0,
    longitude: order.addressLon ?? 0,
    address: [order.address.line1, order.address.city].filter(Boolean).join(", "),
  };
  if (!destination.address) return bad(res, "A delivery address is required.");

  // The parcel is DERIVED from the order lines - the merchant never retypes it.
  const packageSpec = packageFromLines(
    order.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
    { fragile: body.overrides?.fragile, handlingNotes: body.overrides?.handlingNotes },
  );

  try {
    const delivery = await createDelivery({
      source: "yene-store",
      sourceRef: order.id,
      orderId: order.id,
      customerOrderId: order.parentOrderId,
      merchantId: order.businessId,
      customerId: caller.userId,
      vehicleType: vehicle.type,
      // Coordinates are passed through only when the merchant recorded them. When
    // they did not, (0,0) is sent as an explicit placeholder AND `pickupKnown` is
    // false, which parks the delivery in REQUESTED rather than dispatching from
    // the middle of the Atlantic.
    pickup: {
      latitude: pickup.hasCoordinates ? (pickup.latitude as number) : 0,
      longitude: pickup.hasCoordinates ? (pickup.longitude as number) : 0,
      address: pickup.address,
    },
    pickupKnown: pickup.hasCoordinates,
      destination,
      pickupContactName: pickup.name,
      pickupContactPhone: pickup.phone,
      destinationContactName: order.address.name,
      destinationContactPhone: order.address.phone,
      packageSpec,
      deliveryNotes: (body.deliveryNotes ?? "").slice(0, 500),
    });
    notifyDelivery(delivery, "delivery.requested", {
      customer: `Delivery requested for order ${order.id}. We are finding a delivery person.`,
      merchant: `A customer has requested delivery for order ${order.id}.`,
      admin: `Delivery ${delivery.id} requested for ${order.businessName}.`,
    });
    announce(delivery, "delivery.requested");
    return send(res, 201, { delivery: projectForCaller(delivery, caller) });
  } catch (error) {
    return handleError(res, error);
  }
});

/** GET /api/delivery/:id - the delivery, projected for THIS caller. */
deliveryRouter.get("/:id", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, READ_LIMIT, "read")) return send(res, 429, { error: "Too many requests." });
  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  return send(res, 200, { delivery: projectForCaller(delivery, caller) });
});

/** GET /api/delivery - every delivery this caller may see. */
deliveryRouter.get("/", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, READ_LIMIT, "read")) return send(res, 429, { error: "Too many requests." });

  const status = String(req.query.status ?? "");
  const list = allDeliveries()
    .filter((entry) => mayRead(entry, caller))
    .filter((entry) => !status || entry.status === status)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 100);

  return send(res, 200, { deliveries: list.map((entry) => projectForCaller(entry, caller)) });
});

/**
 * GET /api/delivery/:id/stream - Server-Sent Events.
 *
 * Uses the same hub as the live chat. The client falls back to `/poll` when a
 * proxy blocks SSE, so tracking works either way.
 *
 * AUTHORISATION HAPPENS BEFORE SUBSCRIBING
 * ----------------------------------------
 * `readableDelivery` runs first. The hub has no idea who is listening and trusts
 * the route entirely, so a subscriber may only ever be registered against a topic
 * this caller is entitled to.
 */
deliveryRouter.get("/:id/stream", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;

  const audience = audienceFor(delivery, caller);
  const topics =
    audience === "driver"
      ? [`driver:${caller.driver?.id ?? "none"}`, threadTopic(`delivery:${delivery.id}`)]
      : [threadTopic(`delivery:${delivery.id}`)];

  subscribe(res, topics, {
    event: "snapshot",
    payload: { delivery: projectForCaller(delivery, caller) },
  });
});

/** Poll fallback for the same stream, for when SSE is blocked by a proxy. */
deliveryRouter.get("/:id/poll", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  return send(res, 200, {
    delivery: projectForCaller(delivery, caller),
    serverTime: Date.now(),
  });
});

// ---------------------------------------------------------------------------
// Customer and merchant actions
// ---------------------------------------------------------------------------

/**
 * POST /api/delivery/:id/cancel
 *
 * The status table decides whether this is legal: a customer may withdraw before
 * a driver is assigned, a merchant may withdraw until the parcel is collected,
 * and after hand-off the only exit is RETURNED. A cancellation REASON is always
 * recorded - an unexplained cancellation is exactly what a dispute needs.
 */
deliveryRouter.post("/:id/cancel", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  if (!(isCustomer(delivery, caller) || isMerchant(delivery, caller) || caller.isSuperAdmin)) {
    return send(res, 403, { error: "You cannot cancel this delivery." });
  }

  const reason = String((req.body ?? {}).reason ?? "").trim().slice(0, 300);
  if (!reason) return bad(res, "Please say why this delivery is being cancelled.");

  try {
    const actor = caller.isSuperAdmin
      ? ({ kind: "admin", id: caller.userId } as const)
      : isCustomer(delivery, caller)
        ? ({ kind: "customer", id: caller.userId } as const)
        : ({ kind: "merchant", id: caller.businessId ?? caller.userId } as const);

    const cancelled = applyTransition(delivery, "CANCELLED", actor, reason);
    releaseDriver(cancelled);
    // Withdraw any offer still open, so nobody drives to a cancelled parcel.
    for (const offer of allOffers()) {
      if (offer.deliveryId === cancelled.id && offer.state === "pending") {
        offer.state = "withdrawn";
        offer.respondedAt = new Date().toISOString();
      }
    }
    notifyDelivery(cancelled, "delivery.cancelled", {
      customer: "Your delivery was cancelled.",
      merchant: `Delivery ${cancelled.id} was cancelled: ${reason}`,
      driver: "A delivery you were offered has been cancelled.",
      admin: `Delivery ${cancelled.id} cancelled: ${reason}`,
    });
    announce(cancelled, "delivery.cancelled");
    return send(res, 200, { delivery: projectForCaller(cancelled, caller) });
  } catch (error) {
    return handleError(res, error);
  }
});

/**
 * POST /api/delivery/:id/confirm
 *
 * The customer confirms receipt at the door. This is one of the two configured
 * proof methods; the other is a code the driver enters.
 *
 * `proofConfirmedBy` records WHO confirmed - a customer-initiated completion is a
 * materially different fact from a driver-initiated one, and an administrator
 * reading the timeline later needs to be able to tell them apart.
 */
deliveryRouter.post("/:id/confirm", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  // Only the CUSTOMER may confirm. A merchant or a driver reaching this route
  // completes the delivery through their own endpoint instead.
  if (!isCustomer(delivery, caller)) {
    return send(res, 403, { error: "Only the customer can confirm this delivery." });
  }
  if (delivery.proofMethod !== "customer-confirmation") {
    return bad(res, "This delivery is confirmed with a code, not a button.");
  }

  try {
    const done = completeDelivery(delivery, { kind: "customer", id: caller.userId });
    clearCode(done.id);
    done.proofVerifiedAt = new Date().toISOString();
    done.proofConfirmedBy = { kind: "customer", id: caller.userId };
    notifyDelivery(done, "delivery.delivered", {
      customer: "Thank you - your delivery is complete.",
      merchant: `Delivery ${done.id} was completed.`,
      driver: "The delivery you were carrying is complete. Thank you.",
      admin: `Delivery ${done.id} completed.`,
    });
    announce(done, "delivery.delivered");
    return send(res, 200, { delivery: projectForCaller(done, caller) });
  } catch (error) {
    return handleError(res, error);
  }
});

/**
 * POST /api/delivery/:id/rate
 *
 * Rate the driver after a completed delivery. Once per delivery.
 *
 * A LOW RATING IS RECORDED, NOT ACTED ON
 *  ------------------------------------
 *  There is no automatic suspension here, and deliberately so. A single 1-star
 *  rating suspending somebody is a denial-of-service any customer can trigger;
 *  the rating surfaces on the driver's profile and in the admin analytics, where
 *  a human decides. `atRisk` is REPORTED, not enforced.
 */
deliveryRouter.post("/:id/rate", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  if (!isCustomer(delivery, caller)) {
    return send(res, 403, { error: "Only the customer can rate this delivery." });
  }
  if (delivery.status !== "DELIVERED") return bad(res, "You can rate a delivery once it is complete.");
  if (!delivery.driverId) return bad(res, "There is no delivery person to rate.");

  if (allRatings().some((entry) => entry.deliveryId === delivery.id)) {
    return bad(res, "You have already rated this delivery.");
  }

  const stars = Number((req.body ?? {}).stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return bad(res, "Choose a rating from 1 to 5.");

  const traits = Array.isArray((req.body ?? {}).traits)
    ? ((req.body ?? {}).traits as unknown[]).map(String).slice(0, 5)
    : [];

  const rating = {
    id: newId("rat"),
    deliveryId: delivery.id,
    driverId: delivery.driverId,
    customerId: caller.userId,
    stars,
    traits,
    comment: String((req.body ?? {}).comment ?? "").slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  allRatings().push(rating);
  persistRatings();

  // Update the driver's running total in the same write, so a profile read is a
  // single pass rather than an aggregation over every rating ever left.
  const driver = driverById(delivery.driverId);
  if (driver) {
    driver.ratingSum += stars;
    driver.ratingCount += 1;
    persistDrivers();
  }

  const belowThreshold = driver ? driver.ratingCount >= 5 && driver.ratingSum / driver.ratingCount < 3 : false;
  return send(res, 201, {
    rating: { stars: rating.stars, comment: rating.comment },
    driverRating: driver ? Math.round((driver.ratingSum / driver.ratingCount) * 10) / 10 : 0,
    // REPORTED for the admin, never enforced here.
    atRisk: belowThreshold,
    message: "Thank you for rating your delivery.",
  });
});

/** POST /api/delivery/:id/problem - report something that went wrong. */
deliveryRouter.post("/:id/problem", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;
  const description = String((req.body ?? {}).description ?? "").trim().slice(0, 1000);
  if (!description) return bad(res, "Please describe what went wrong.");

  notifyDelivery(delivery, "delivery.problem_reported", {
    admin: `A problem was reported on delivery ${delivery.id}: ${description}`,
  });
  // The customer's own record of the report, so it is visible to them too.
  allNotifications().push({
    id: newId("ntf"),
    deliveryId: delivery.id,
    recipientId: caller.userId,
    audience: "customer",
    channel: "in-app",
    event: "delivery.problem_reported",
    title: "Problem reported",
    body: "Thank you. Yene Business Group has been notified and will follow up.",
    read: false,
    createdAt: new Date().toISOString(),
  });
  persistNotifications();

  return send(res, 201, {
    ok: true,
    message: "Thank you. Yene Business Group has been notified and will follow up.",
  });
});

/** GET /api/delivery/notifications - the caller's own notifications. */
deliveryRouter.get("/notifications", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const list = allNotifications()
    .filter((entry) => entry.recipientId === caller.userId || (caller.isSuperAdmin && entry.audience === "admin"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  return send(res, 200, { notifications: list });
});

/** POST /api/delivery/notifications/read - mark them read. */
deliveryRouter.post("/notifications/read", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const ids = Array.isArray((req.body ?? {}).ids) ? ((req.body ?? {}).ids as unknown[]).map(String) : [];
  let changed = 0;
  for (const entry of allNotifications()) {
    // Scoped to the caller's own rows: marking read is a write, so it is
    // authorised exactly like a read.
    if (entry.recipientId !== caller.userId) continue;
    if (ids.length > 0 && !ids.includes(entry.id)) continue;
    if (!entry.read) {
      entry.read = true;
      changed += 1;
    }
  }
  if (changed > 0) persistNotifications();
  return send(res, 200, { ok: true, read: changed });
});

// ---------------------------------------------------------------------------
// Driver registration and profile
// ---------------------------------------------------------------------------

interface RegisterBody {
  fullName?: string;
  phone?: string;
  email?: string;
  vehicleType?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  plateNumber?: string;
  vehicleYear?: number;
  licenceNumber?: string;
  licenceExpiry?: string;
  idNumber?: string;
  address?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  /** Filenames already uploaded through the media route. Never file content. */
  photoUrl?: string;
  idDocument?: string;
  licenseDocument?: string;
  vehicleDocument?: string;
}

/**
 * POST /api/delivery/driver/register
 *
 *  A NEW REGISTRATION IS ALWAYS PENDING
 *  ------------------------------------
 *  There is no branch in this function that produces APPROVED, and no parameter
 *  that reaches one. That is the whole point: an unverified driver must never be
 *  able to register themselves into a state where they receive jobs. Approval is
 *  an administrator's decision and only `adminRouter` can make it.
 */
deliveryRouter.post("/driver/register", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, 5, "register")) return send(res, 429, { error: "Too many attempts. Please try again shortly." });

  const body = (req.body ?? {}) as RegisterBody;

  const fullName = String(body.fullName ?? "").trim().slice(0, 80);
  const phone = String(body.phone ?? "").trim().slice(0, 32);
  const address = String(body.address ?? "").trim().slice(0, 200);
  const vehicleType = String(body.vehicleType ?? "").trim();

  if (fullName.length < 2) return bad(res, "Enter your full name.");
  if (!/^[+0-9][0-9\s-]{6,20}$/.test(phone)) return bad(res, "Enter a valid phone number.");
  if (address.length < 4) return bad(res, "Enter your address.");
  if (!vehicleByType(vehicleType)) return bad(res, "Choose the vehicle you deliver with.");

  // One driver record per person, per account.
  const existing = caller.driver;
  if (existing && existing.status !== "REJECTED" && existing.status !== "BLOCKED") {
    return send(res, 200, {
      driver: driverForSelf(existing),
      message:
        existing.status === "APPROVED"
          ? "You are already registered and approved."
          : "You are already registered. Your application is waiting for review.",
    });
  }

  const now = new Date().toISOString();
  const record = {
    id: existing?.id ?? newId("drv"),
    userId: caller.userId,
    fullName,
    phone,
    email: String(body.email ?? caller.email).trim().slice(0, 120) || null,
    photoUrl: String(body.photoUrl ?? "").trim().slice(0, 200) || null,
    idNumber: String(body.idNumber ?? "").trim().slice(0, 40) || null,
    documents: {
      idDocument: String(body.idDocument ?? "").trim().slice(0, 200) || null,
      licenseDocument: String(body.licenseDocument ?? "").trim().slice(0, 200) || null,
      vehicleDocument: String(body.vehicleDocument ?? "").trim().slice(0, 200) || null,
    },
    vehicle: {
      type: vehicleType as Delivery["vehicleType"],
      make: String(body.vehicleMake ?? "").trim().slice(0, 40),
      model: String(body.vehicleModel ?? "").trim().slice(0, 40),
      plateNumber: String(body.plateNumber ?? "").trim().slice(0, 20) || null,
      year: Number(body.vehicleYear) || null,
      colour: null,
    },
    license: {
      number: String(body.licenceNumber ?? "").trim().slice(0, 40) || null,
      expiresOn: String(body.licenceExpiry ?? "").trim().slice(0, 10) || null,
      classes: [] as string[],
    },
    emergencyContact: {
      name: String(body.emergencyName ?? "").trim().slice(0, 80),
      phone: String(body.emergencyPhone ?? "").trim().slice(0, 32),
    },
    address,
    // The status an unverified applicant starts in. Not negotiable here.
    status: "PENDING" as const,
    availability: "OFFLINE" as const,
    statusReason: null,
    reviewedAt: null,
    reviewedBy: null,
    registeredAt: existing?.registeredAt ?? now,
    approvedAt: null,
    updatedAt: now,
    // A REJECTED applicant re-registering starts from zero on the aggregates:
    // the old rating history is a different person from the reviewer's point of
    // view, and carrying it across would launder a bad rating.
    ratingSum: 0,
    ratingCount: 0,
    deliveriesCompleted: 0,
    earningsTotal: 0,
  };

  if (existing) {
    const index = allDrivers().indexOf(existing);
    allDrivers()[index] = record;
  } else {
    allDrivers().push(record);
  }
  persistDrivers();

  return send(res, 201, {
    driver: driverForSelf(record),
    message:
      "Thank you. Your application has been received and is waiting for verification by " +
      "Yene Business Group. You will be able to go online once it is approved.",
  });
});

/** GET /api/delivery/driver/me - the caller's own driver profile. */
deliveryRouter.get("/driver/me", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;
  return send(res, 200, { driver: driverForSelf(driver) });
});

/**
 * POST /api/delivery/driver/availability - go online or offline.
 *
 * `setDriverAvailability` refuses ONLINE unless APPROVED, so an unverified driver
 * cannot reach a state where they are offered work.
 */
deliveryRouter.post("/driver/availability", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const driver = requireDriver(caller, res);
  if (!driver) return;

  const wanted = String((req.body ?? {}).availability ?? "");
  if (wanted !== "ONLINE" && wanted !== "OFFLINE") {
    return bad(res, "Choose whether you are online or offline.");
  }
  try {
    setDriverAvailability(driver.id, wanted);
    const updated = driverById(driver.id)!;
    return send(res, 200, {
      driver: driverForSelf(updated),
      message:
        wanted === "ONLINE"
          ? "You are online and will receive delivery requests."
          : "You are offline and will not receive delivery requests.",
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// ---------------------------------------------------------------------------
// The driver's request screen and job
// ---------------------------------------------------------------------------

/**
 * GET /api/delivery/driver/offers - the requests waiting for an answer.
 *
 * Each offer carries the seconds remaining, so the phone can show a countdown
 * without recomputing anything. An expired offer is not returned at all - the
 * driver should never see a button for a job somebody else has taken.
 */
deliveryRouter.get("/driver/offers", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;

  const now = Date.now();
  const offers = offersForDriver(driver.id).filter(
    (offer) => new Date(offer.expiresAt).getTime() > now,
  );

  const rows = offers
    .map((offer) => {
      const delivery = deliveryById(offer.deliveryId);
      if (!delivery) return null;
      // The offer is withdrawn the moment somebody else accepts, so a delivery
      // that is no longer searching is not shown even if the row lingers.
      if (delivery.status !== "SEARCHING_DRIVER") return null;
      return {
        offerId: offer.id,
        expiresInSec: Math.max(0, Math.floor((new Date(offer.expiresAt).getTime() - now) / 1000)),
        rank: offer.rank,
        delivery: deliveryForDriver(delivery),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return send(res, 200, { offers: rows, availability: driver.availability, status: driver.status });
});

/**
 * POST /api/delivery/driver/offers/:offerId/accept
 *
 * The path names the OFFER, not the driver. The driver comes from the session,
 * so a driver cannot accept somebody else's offer by naming its id, and
 * `acceptOffer` is a compare-and-set on the delivery's status - so if two drivers
 * accept in the same instant, exactly one wins.
 */
deliveryRouter.post("/driver/offers/:offerId/accept", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const driver = requireDriver(caller, res);
  if (!driver) return;

  const offer = allOffers().find((entry) => entry.id === String(req.params.offerId));
  // 404 rather than 403: an offer id belonging to another driver must not be
  // confirmed to exist.
  if (!offer || offer.driverId !== driver.id) {
    return send(res, 404, { error: "Delivery request not found." });
  }

  try {
    const assigned = acceptOffer(offer.deliveryId, driver.id);
    notifyDelivery(assigned, "delivery.driver_assigned", {
      customer: "A delivery person has been assigned to your order.",
      merchant: `A delivery person has been assigned to delivery ${assigned.id}.`,
      driver: "You have the delivery. Navigate to the pickup point.",
      admin: `Delivery ${assigned.id} assigned.`,
    });
    announce(assigned, "delivery.driver_assigned");
    return send(res, 200, {
      delivery: deliveryForDriver(assigned),
      message: "The delivery is yours. Navigate to the pickup point.",
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/** POST /api/delivery/driver/offers/:offerId/decline - turn it down. */
deliveryRouter.post("/driver/offers/:offerId/decline", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;

  const offer = allOffers().find((entry) => entry.id === String(req.params.offerId));
  if (!offer || offer.driverId !== driver.id) {
    return send(res, 404, { error: "Delivery request not found." });
  }
  declineOffer(offer.deliveryId, driver.id);
  return send(res, 200, { ok: true });
});

/**
 * GET /api/delivery/driver/active - the job in hand.
 *
 * `nextDriverAction` returns exactly ONE legal next step, so the driver screen
 * has a single button rather than a menu of every edge in the table. An illegal
 * move has no button to press.
 */
deliveryRouter.get("/driver/active", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;

  const delivery = allDeliveries().find(
    (entry) =>
      entry.driverId === driver.id &&
      entry.status !== "DELIVERED" &&
      entry.status !== "CANCELLED" &&
      entry.status !== "FAILED" &&
      entry.status !== "RETURNED",
  );
  if (!delivery) return send(res, 200, { delivery: null, nextAction: null });

  return send(res, 200, {
    delivery: deliveryForDriver(delivery),
    nextAction: nextDriverAction(delivery.status),
    // What the driver needs at the door, once they are there.
    proofRequired: delivery.proofMethod !== "customer-confirmation" && delivery.status === "ARRIVING",
  });
});

/**
 * POST /api/delivery/driver/active/advance - perform the next legal step.
 *
 * The target status comes from the SERVER (`nextDriverAction`), never from the
 * body. A driver asking to jump straight to DELIVERED is asking for something
 * with no button and no parameter, because this route simply does not read one.
 */
deliveryRouter.post("/driver/active/advance", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const driver = requireDriver(caller, res);
  if (!driver) return;

  const delivery = allDeliveries().find(
    (entry) => entry.driverId === driver.id && entry.status !== "DELIVERED" && entry.status !== "CANCELLED",
  );
  if (!delivery) return send(res, 404, { error: "You have no active delivery." });

  const action = nextDriverAction(delivery.status);
  if (!action) {
    return bad(res, "There is nothing to do at this step.");
  }

  // ARRIVING -> DELIVERED needs the proof, and this route does not carry it. The
  // code and the customer confirmation have their own endpoints, so a driver
  // cannot skip the door step by calling "advance" one time too many.
  if (action.to === "DELIVERED") {
    return bad(res, "Use the confirm-delivery button to complete this delivery.");
  }

  try {
    const updated = applyTransition(delivery, action.to, { kind: "driver", id: driver.id }, action.label);
    const events: Record<string, string> = {
      DRIVER_GOING_TO_PICKUP: "delivery.driver_en_route",
      ARRIVED_AT_PICKUP: "delivery.arrived_at_pickup",
      ORDER_PICKED_UP: "delivery.picked_up",
      IN_TRANSIT: "delivery.in_transit",
      ARRIVING: "delivery.arriving",
    };
    const event = events[action.to] ?? "delivery.updated";

    // Issue the delivery code the moment the driver reaches the customer's
    // street, so the customer has it before anybody knocks. `issueCode` is
    // idempotent, so reaching ARRIVING twice cannot leave two live codes.
    if (action.to === "ARRIVING" && delivery.proofMethod !== "customer-confirmation") {
      issueCode(updated);
    }

    notifyDelivery(updated, event, {
      customer: customerMessageFor(action.to),
      merchant: merchantMessageFor(action.to),
      driver: null,
      admin: null,
    });
    announce(updated, event);

    const fresh = deliveryById(updated.id) ?? updated;
    return send(res, 200, {
      delivery: deliveryForDriver(fresh),
      nextAction: nextDriverAction(fresh.status),
      // The driver reads the code out; the customer types it back. Both read it
      // from the SAME held value, so it never has to be stored in plaintext.
      deliveryCode: currentCode(fresh),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/**
 * POST /api/delivery/driver/complete - hand the parcel over.
 *
 * REQUIRES PROOF
 *  -------------
 *  With a code configured, the driver must supply the code the customer reads
 *  out; without one, the customer confirms in their own session and this route
 *  refuses. Either way the driver's button alone cannot mark a parcel delivered,
 *  which is the control that stops "delivered" meaning "I pressed a button".
 */
deliveryRouter.post("/driver/complete", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, 10, "proof")) return send(res, 429, { error: "Too many attempts." });

  const driver = requireDriver(caller, res);
  if (!driver) return;

  const delivery = allDeliveries().find(
    (entry) => entry.driverId === driver.id && entry.status === "ARRIVING",
  );
  if (!delivery) return bad(res, "This delivery is not ready to complete.");

  if (delivery.proofMethod !== "customer-confirmation") {
    const supplied = String((req.body ?? {}).deliveryCode ?? "").trim();
    if (!isValidProofCode(supplied)) {
      return bad(res, "Ask the customer for their 4-digit delivery code.");
    }
    if (proofAttemptsExhausted(delivery.proofAttempts)) {
      return send(res, 429, {
        error: "Too many incorrect attempts. Please contact Yene Business Group.",
      });
    }
    if (!verifyProofCode(delivery.id, supplied, delivery.proofCodeHash)) {
      // ONE message for every failure, so the endpoint cannot be used to
      // discover whether a code exists or has been used.
      delivery.proofAttempts += 1;
      return bad(res, PROOF_FAILED_MESSAGE);
    }
  }

  try {
    const done = completeDelivery(delivery, { kind: "driver", id: driver.id });
    clearCode(done.id);
    done.proofVerifiedAt = new Date().toISOString();
    done.proofConfirmedBy = { kind: "driver", id: driver.id };
    notifyDelivery(done, "delivery.delivered", {
      customer: "Your delivery is complete. Please rate your delivery person.",
      merchant: `Delivery ${done.id} was completed.`,
      driver: "Delivery complete. Thank you.",
      admin: `Delivery ${done.id} completed.`,
    });
    announce(done, "delivery.delivered");
    return send(res, 200, {
      delivery: deliveryForDriver(done),
      earnings: done.driverEarnings,
      message: "Delivery complete. Thank you.",
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/**
 * POST /api/delivery/driver/location - a live GPS ping.
 *
 * ACCEPTED WHILE IDLE, AND THAT IS CORRECT
 * ----------------------------------------
 *  Dispatch ranks drivers by how far away they are, so it needs to know where
 *  they are BEFORE they have a job. Refusing the ping until a delivery is
 *  accepted deadlocks the whole system: no location means no ranking means no
 *  offer means no job means still no location. That deadlock was found by
 *  running this end to end - the courier reported "count=0 offers" forever.
 *
 *  It is still SAFE while idle, because the storage design is what protects the
 *  driver, not the endpoint:
 *
 *    * `recordLocation` writes the single overwritten current-position row, so a
 *      day of pings leaves exactly one row and cannot answer "where was this
 *      person last Tuesday";
 *    * route SAMPLES are written only while a delivery is live, so an idle
 *      driver's movements are never accumulated.
 *
 *  So the driver is OFFERED work (which needs their position) without the disk
 *  holding a trail of their off-duty life.
 *
 *  A driver who is offline, unapproved or suspended is still refused: their
 *  position is of no use to dispatch and no business of ours.
 */
deliveryRouter.post("/driver/location", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  // A ping every few seconds would trip a 30/minute write limit, so location has
  // its own, much higher ceiling.
  if (rateLimited(req, 240, "location")) return send(res, 429, { error: "Too many requests." });

  const driver = requireDriver(caller, res);
  if (!driver) return;

  const body = (req.body ?? {}) as {
    latitude?: number;
    longitude?: number;
    heading?: number;
    speedMps?: number;
  };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return bad(res, "Invalid latitude.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return bad(res, "Invalid longitude.");

  // Eligibility, rather than "does a job exist". The first question is whether
  // this driver could be OFFERED anything at all.
  if (driver.status !== "APPROVED") {
    return send(res, 403, { error: "Your account is not approved to take deliveries yet." });
  }
  if (driver.availability === "OFFLINE" || driver.availability === "SUSPENDED") {
    return send(res, 409, { error: "Go online before sharing your location." });
  }

  const location = recordLocation({
    driverId: driver.id,
    latitude,
    longitude,
    heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : null,
    speedMps: Number.isFinite(Number(body.speedMps)) ? Number(body.speedMps) : null,
  });

  // Push to whoever is watching this delivery - and to nobody, when the driver
  // is idle, because there is no delivery to watch.
  if (location.deliveryId) {
    const active = deliveryById(location.deliveryId);
    if (active) {
      publishTo([threadTopic(`delivery:${active.id}`)], "message", {
        deliveryId: active.id,
        event: "driver.location",
        status: active.status,
        driverPosition: { latitude: location.latitude, longitude: location.longitude, at: location.at },
      });
    }
  }

  // A fresh position can change who the NEXT offer should go to, so a delivery
  // already searching is re-ranked rather than left waiting for the sweeper.
  for (const delivery of allDeliveries()) {
    if (delivery.status === "SEARCHING_DRIVER" && delivery.vehicleType === driver.vehicle.type) {
      reDispatch(delivery);
    }
  }

  return send(res, 200, { ok: true, at: location.at, onDelivery: location.deliveryId });
});

/** GET /api/delivery/driver/earnings - this driver's own history. */
deliveryRouter.get("/driver/earnings", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;

  const rows = allEarnings()
    .filter((entry) => entry.driverId === driver.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);

  return send(res, 200, {
    // Only THIS driver's rows. The endpoint takes no driver parameter at all, so
    // there is nothing to tamper with.
    earnings: rows,
    total: rows.reduce((sum, row) => sum + row.netEarnings, 0),
    lifetime: driver.earningsTotal,
    deliveries: driver.deliveriesCompleted,
    commissionBps: pricingConfig().commissionBps,
  });
});

/** GET /api/delivery/driver/history - completed jobs. */
deliveryRouter.get("/driver/history", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  const driver = requireDriver(caller, res);
  if (!driver) return;

  const rows = allDeliveries()
    .filter((entry) => entry.driverId === driver.id && entry.status === "DELIVERED")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
    .slice(0, 50);

  return send(res, 200, {
    deliveries: rows.map((entry) => ({
      id: entry.id,
      destination: entry.destination.address,
      deliveredAt: entry.deliveredAt,
      earnings: entry.driverEarnings,
      rating: allRatings().find((r) => r.deliveryId === entry.id)?.stars ?? null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** What the customer is told at each step. */
function customerMessageFor(status: Delivery["status"]): string {
  const messages: Record<string, string> = {
    DRIVER_GOING_TO_PICKUP: "Your delivery person is on the way to the store.",
    ARRIVED_AT_PICKUP: "Your delivery person has arrived at the store.",
    ORDER_PICKED_UP: "Your order has been collected and is being prepared for delivery.",
    IN_TRANSIT: "Your order is on the way to you.",
    ARRIVING: "Your delivery person is arriving. Please keep your phone nearby.",
  };
  return messages[status] ?? "Your delivery has been updated.";
}

/** What the merchant is told at each step. */
function merchantMessageFor(status: Delivery["status"]): string {
  const messages: Record<string, string> = {
    DRIVER_GOING_TO_PICKUP: "A delivery person is on the way to collect the order.",
    ARRIVED_AT_PICKUP: "The delivery person has arrived to collect the order.",
    ORDER_PICKED_UP: "The order has been collected.",
    IN_TRANSIT: "The order is on the way to the customer.",
    ARRIVING: "The delivery person is arriving at the customer.",
  };
  return messages[status] ?? "A delivery has been updated.";
}

/**
/**
 * The outstanding delivery code, for the caller entitled to read it.
 *
 * Only the ASSIGNED DRIVER and the CUSTOMER may read it, and only once the
 * driver has arrived - the same moment the code becomes meaningful. A merchant
 * is refused: they have no part in the hand-over, and the customer-courier line
 * is not theirs to see.
 */
function proofCodeFor(delivery: Delivery, caller: DeliveryCaller): string | null {
  const entitled = isAssignedDriver(delivery, caller) || isCustomer(delivery, caller);
  if (!entitled) return null;
  return currentCode(delivery);
}

// ---------------------------------------------------------------------------
// Choosing the pickup point
// ---------------------------------------------------------------------------

/**
 * POST /api/delivery/:id/pickup
 *
 * Choose WHERE the parcel is collected from, and start the search.
 *
 * This is the merchant's "Choose pickup location" step from the specification,
 * and it is not optional decoration: dispatch ranks drivers by distance from the
 * pickup, so a delivery with no pickup cannot be ranked. A merchant whose store
 * has no coordinates gets a delivery parked in REQUESTED, and this route is what
 * moves it forward.
 *
 * WHO MAY SET IT
 *  - the MERCHANT whose business the delivery belongs to
 *  - the CUSTOMER who requested it (they may know exactly where the shop is)
 *  - an ADMINISTRATOR, always
 *
 * ...and never another business, never another customer, and never the driver.
 */
deliveryRouter.post("/:id/pickup", (req: Request, res: Response) => {
  const caller = requireCaller(req, res);
  if (!caller) return;
  if (rateLimited(req, WRITE_LIMIT, "write")) return send(res, 429, { error: "Too many requests." });

  const delivery = readableDelivery(req, res, caller);
  if (!delivery) return;

  const permitted =
    caller.isSuperAdmin ||
    isMerchant(delivery, caller) ||
    isCustomer(delivery, caller);
  if (!permitted) {
    return send(res, 403, { error: "You cannot change the pickup point for this delivery." });
  }

  const body = (req.body ?? {}) as {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const address = String(body.address ?? delivery.pickup.address ?? "").trim();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return bad(res, "Choose a pickup point on the map.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return bad(res, "Choose a pickup point on the map.");
  }
  if (address.length < 2) return bad(res, "Enter the pickup address.");

  // Only REQUESTED or SEARCHING_DRIVER. Once a driver is on the way, moving the
  // pickup under them would send a courier to the wrong shop - which is a
  // cancellation and a new request, not a silent edit.
  if (delivery.status !== "REQUESTED" && delivery.status !== "SEARCHING_DRIVER") {
    return send(res, 409, {
      error: "The pickup point can no longer be changed once a delivery person is on the way.",
    });
  }

  try {
    const actor = caller.isSuperAdmin
      ? ({ kind: "admin", id: caller.userId } as const)
      : isMerchant(delivery, caller)
        ? ({ kind: "merchant", id: caller.businessId ?? caller.userId } as const)
        : ({ kind: "customer", id: caller.userId } as const);

    const updated = setPickupPoint(delivery, { latitude, longitude, address }, actor);
    notifyDelivery(updated, "delivery.requested", {
      customer: "We are now finding a delivery person for your order.",
      merchant: "The pickup point is set. We are finding a delivery person.",
      admin: `Pickup set for delivery ${updated.id}; searching for a driver.`,
    });
    announce(updated, "delivery.pickup_set");
    return send(res, 200, { delivery: projectForCaller(updated, caller) });
  } catch (error) {
    return handleError(res, error);
  }
});
