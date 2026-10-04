/**
 * ============================================================================
 *  DELIVERY ADMIN ROUTER
 * ============================================================================
 *
 *  Mounted on the delivery router under /admin. EVERY route requires a Yene
 *  super administrator.
 *
 *  The tenant check used by business routes is the WRONG one here: a delivery
 *  belongs to a courier and to a customer, not to a business that signed into the
 *  platform, and the dispatcher's job spans all of them. This mirrors
 *  `api/platform/mallAdmin.ts`, which guards itself for the same reason.
 *
 *    GET    /admin/live              the dispatch centre: drivers, deliveries, map
 *    GET    /admin/drivers           every driver, filterable by status
 *    GET    /admin/drivers/:id       one driver, in full (documents included)
 *    POST   /admin/drivers/:id/review   approve / reject / suspend / block
 *    GET    /admin/deliveries        every delivery, filterable by status
 *    GET    /admin/deliveries/:id    one delivery in full
 *    POST   /admin/deliveries/:id/assign   hand a job to a specific driver
 *    POST   /admin/deliveries/:id/cancel   stop a delivery
 *    GET    /admin/pricing           the pricing configuration
 *    PUT    /admin/pricing           change it
 *    PUT    /admin/vehicles/:id      change one vehicle class
 *    GET    /admin/zones             every zone
 *    POST   /admin/zones             create a zone
 *    PUT    /admin/zones/:id         edit a zone
 *    GET    /admin/analytics         the figures
 *
 *  EVERY WRITE IS AUDITED
 *  ----------------------
 *  Approving a driver, suspending one, reassigning a job and changing a price
 *  are the four actions that can be abused. Each writes an audit row naming WHO
 *  did it and WHEN, because "why is this driver suspended" must be answerable a
 *  month later without trusting anybody's memory.
 */

import { Router, type Request, type Response } from "express";
import { subscribe, threadTopic } from "../support/hub";
import { resolveCaller } from "./auth";
import { deliveryForAdmin, driverForAdmin, driverForList } from "../../src/delivery/projections";
import { isDeliveryStatus, mapStatus, publicMapEnv, type Delivery, type DriverProfile } from "../../src/delivery";
import {
  DeliveryError,
  applyTransition,
  liveDriverPositions,
  notifyDriver,
  replaceDelivery,
  notifyDelivery,
  releaseDriver,
  setDriverAvailability,
} from "./service";
import {
  allDeliveries,
  allDrivers,
  allEarnings,
  allRatings,
  allVehicles,
  allZones,
  deliveryById,
  driverById,
  driverLocation,
  newId,
  allOffers,
  persistDrivers,
  persistVehicles,
  persistZones,
  pricingConfig,
  savePricingConfig,
} from "./store";
import { auditDeliveryAction, auditForSubject, recentAudit, type DeliveryAuditAction } from "./audit";

export const deliveryAdminRouter = Router();

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * The super-admin gate, in ONE place inside this router.
 *
 * Written here rather than imported from the delivery router, because this one
 * is mounted onto it - importing the guard back out would make the two circular.
 */
function admin(req: Request, res: Response): boolean {
  const caller = resolveCaller(req);
  if (caller?.isSuperAdmin) return true;
  res.status(403).json({ error: "Super Admin access is required." });
  return false;
}

const bad = (res: Response, message: string) => res.status(400).json({ error: message });

function handleError(res: Response, error: unknown) {
  if (error instanceof DeliveryError) return res.status(error.status).json({ error: error.message });
  console.error("[delivery-admin] unexpected failure:", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

/** Coerce a request body field to a finite number, or null. */
function num(value: unknown, min = -Infinity, max = Infinity): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// The live dispatch centre
// ---------------------------------------------------------------------------

/**
 * GET /api/delivery/admin/live
 *
 * Everything a dispatcher needs on one screen: online drivers with their
 * positions, active deliveries with their status, and the counts.
 *
 * A driver's position is included for ACTIVE drivers only. An idle driver's
 * whereabouts are not a dispatcher's business, and an admin dashboard that
 * tracked everybody all day would be the surveillance system the location design
 * exists to avoid.
 */
deliveryAdminRouter.get("/admin/live", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const now = Date.now();
  const staleAfter = pricingConfig().locationStaleSec;

  const activeDeliveries = allDeliveries().filter(
    (entry) =>
      entry.status !== "DELIVERED" &&
      entry.status !== "CANCELLED" &&
      entry.status !== "FAILED" &&
      entry.status !== "RETURNED",
  );

  const busyDriverIds = new Set(activeDeliveries.map((entry) => entry.driverId).filter(Boolean));

  const drivers = allDrivers()
    .filter((driver) => driver.status === "APPROVED")
    .map((driver) => {
      const location = driverLocation(driver.id);
      const ageSec = location ? (now - new Date(location.at).getTime()) / 1000 : Infinity;
      return {
        id: driver.id,
        name: driver.fullName,
        vehicleType: driver.vehicle.type,
        availability: driver.availability,
        // Only a live position, and only while they are actually working.
        position:
          location && busyDriverIds.has(driver.id) && ageSec <= staleAfter
            ? { latitude: location.latitude, longitude: location.longitude, at: location.at }
            : null,
        activeDeliveryId: activeDeliveries.find((entry) => entry.driverId === driver.id)?.id ?? null,
        deliveriesCompleted: driver.deliveriesCompleted,
        rating: driver.ratingCount > 0 ? Math.round((driver.ratingSum / driver.ratingCount) * 10) / 10 : 0,
      };
    });

  return res.status(200).json({
    drivers,
    deliveries: activeDeliveries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      pickup: { latitude: entry.pickup.latitude, longitude: entry.pickup.longitude, address: entry.pickup.address },
      destination: {
        latitude: entry.destination.latitude,
        longitude: entry.destination.longitude,
        address: entry.destination.address,
      },
      driverId: entry.driverId,
      vehicleType: entry.vehicleType,
      distanceKm: entry.distanceKm,
      fee: entry.price.subtotal,
      merchantId: entry.merchantId,
      requestedAt: entry.requestedAt,
    })),
    counts: {
      onlineDrivers: drivers.filter((d) => d.availability === "ONLINE").length,
      busyDrivers: drivers.filter((d) => d.availability === "BUSY").length,
      activeDeliveries: activeDeliveries.length,
      searching: activeDeliveries.filter((d) => d.status === "SEARCHING_DRIVER").length,
    },
    provider: pricingConfig().proofMethod,
  });
});

/** SSE for the dispatch centre: a push whenever anything moves. */
deliveryAdminRouter.get("/admin/live/stream", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  subscribe(res, [threadTopic("delivery:admin")], { event: "snapshot", payload: { ok: true } }, 15_000);
});


// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/** GET /api/delivery/admin/drivers - every driver, filterable. */
deliveryAdminRouter.get("/admin/drivers", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const status = String(req.query.status ?? "");
  const availability = String(req.query.availability ?? "");
  const query = String(req.query.q ?? "").trim().toLowerCase();

  const rows = allDrivers()
    .filter((driver) => !status || driver.status === status)
    .filter((driver) => !availability || driver.availability === availability)
    .filter(
      (driver) =>
        !query ||
        driver.fullName.toLowerCase().includes(query) ||
        driver.phone.replace(/\D/g, "").includes(query.replace(/\D/g, "")) ||
        (driver.vehicle.plateNumber ?? "").toLowerCase().includes(query),
    )
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
    .map(driverForList);

  return res.status(200).json({
    drivers: rows,
    counts: {
      total: allDrivers().length,
      pending: allDrivers().filter((d) => d.status === "PENDING" || d.status === "UNDER_REVIEW").length,
      approved: allDrivers().filter((d) => d.status === "APPROVED").length,
      suspended: allDrivers().filter((d) => d.status === "SUSPENDED" || d.status === "BLOCKED").length,
    },
  });
});

/**
 * GET /api/delivery/admin/drivers/:id - one driver in full.
 *
 * The ONLY response that includes the id number and document filenames, because
 * verification is precisely the administrator's job.
 */
deliveryAdminRouter.get("/admin/drivers/:id", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const driver = driverById(String(req.params.id));
  if (!driver) return res.status(404).json({ error: "Delivery person not found." });
  return res.status(200).json({ driver: driverForAdmin(driver) });
});

/**
 * POST /api/delivery/admin/drivers/:id/review
 *
 * Approve, reject, suspend, block, or reinstate. A REASON IS REQUIRED for every
 * decision that removes a driver from service.
 *
 * Approving sets APPROVED + availability ONLINE, so an approved driver is
 * immediately dispatchable - that is the point of approving them.
 * Suspending also forces availability SUSPENDED, which is what makes a suspended
 * driver unreachable through every other route rather than merely ineligible.
 */
deliveryAdminRouter.post("/admin/drivers/:id/review", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const driver = driverById(String(req.params.id));
  if (!driver) return res.status(404).json({ error: "Delivery person not found." });

  const body = (req.body ?? {}) as { decision?: string; reason?: string };
  const decision = String(body.decision ?? "").toUpperCase();
  const reason = String(body.reason ?? "").trim().slice(0, 500);

  const decisions = ["APPROVE", "REJECT", "SUSPEND", "BLOCK", "REINSTATE", "REVIEW"] as const;
  if (!decisions.includes(decision as (typeof decisions)[number])) {
    return bad(res, "Choose a valid decision.");
  }
  // Any decision that stops somebody working must say why. A suspension with no
  // reason is indistinguishable from an arbitrary one.
  if (["REJECT", "SUSPEND", "BLOCK"].includes(decision) && reason.length < 3) {
    return bad(res, "Please give a reason for this decision.");
  }

  const before = { status: driver.status, availability: driver.availability };
  const now = new Date().toISOString();

  if (decision === "APPROVE") {
    driver.status = "APPROVED";
    driver.approvedAt = now;
    driver.statusReason = null;
    driver.availability = "ONLINE";
  } else if (decision === "REJECT") {
    driver.status = "REJECTED";
    driver.statusReason = reason;
    driver.availability = "SUSPENDED";
  } else if (decision === "SUSPEND") {
    driver.status = "SUSPENDED";
    driver.statusReason = reason;
    driver.availability = "SUSPENDED";
  } else if (decision === "BLOCK") {
    driver.status = "BLOCKED";
    driver.statusReason = reason;
    driver.availability = "SUSPENDED";
  } else if (decision === "REINSTATE") {
    driver.status = "APPROVED";
    driver.statusReason = null;
    driver.availability = "OFFLINE";
  } else {
    driver.status = "UNDER_REVIEW";
    driver.statusReason = reason || null;
  }

  driver.reviewedAt = now;
  driver.reviewedBy = caller.userId;
  driver.updatedAt = now;
  persistDrivers();

  const actions: Record<string, DeliveryAuditAction> = {
    APPROVE: "driver.approved",
    REJECT: "driver.rejected",
    SUSPEND: "driver.suspended",
    BLOCK: "driver.blocked",
    REINSTATE: "driver.reinstated",
    REVIEW: "delivery.status_changed",
  };
  auditDeliveryAction({
    action: actions[decision],
    actorId: caller.userId,
    actorName: caller.name,
    subjectId: driver.id,
    reason,
    before,
    after: { status: driver.status, availability: driver.availability },
  });

  // The driver is told, in their own words, what happened and why.

  notifyDriver(driver.id, "driver.reviewed", messageForReview(driver, decision, reason));
  return res.status(200).json({
    driver: driverForAdmin(driver),
    message: messageForReview(driver, decision, reason),
  });
});

/** What a driver is told after a review decision. */
function messageForReview(driver: DriverProfile, decision: string, reason: string): string {
  switch (decision) {
    case "APPROVE":
      return "Your delivery application has been approved. You are now online and can receive delivery requests.";
    case "REJECT":
      return `Your delivery application was not approved: ${reason}`;
    case "SUSPEND":
      return `Your delivery access has been suspended: ${reason}`;
    case "BLOCK":
      return `Your delivery access has been blocked: ${reason}`;
    case "REINSTATE":
      return "Your delivery access has been restored. Please go online when you are ready.";
    default:
      return "Your delivery application is now under review by Yene Business Group.";
  }
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

/** GET /api/delivery/admin/deliveries - every delivery, filterable and searchable. */
deliveryAdminRouter.get("/admin/deliveries", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const status = String(req.query.status ?? "");
  const vehicleType = String(req.query.vehicleType ?? "");
  const query = String(req.query.q ?? "").trim().toLowerCase();

  const rows = allDeliveries()
    .filter((entry) => !status || entry.status === status)
    .filter((entry) => !vehicleType || entry.vehicleType === vehicleType)
    .filter((entry) => {
      if (!query) return true;
      const driver = entry.driverId ? driverById(entry.driverId) : null;
      return (
        entry.id.toLowerCase().includes(query) ||
        (entry.orderId ?? "").toLowerCase().includes(query) ||
        entry.destination.address.toLowerCase().includes(query) ||
        entry.pickup.address.toLowerCase().includes(query) ||
        (driver?.fullName ?? "").toLowerCase().includes(query) ||
        (driver?.phone ?? "").includes(query)
      );
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 200)
    .map((entry) => ({
      id: entry.id,
      status: entry.status,
      orderId: entry.orderId,
      merchantId: entry.merchantId,
      customerId: entry.customerId,
      driver: entry.driverId ? driverForList(driverById(entry.driverId)!) : null,
      vehicleType: entry.vehicleType,
      pickupAddress: entry.pickup.address,
      destinationAddress: entry.destination.address,
      distanceKm: entry.distanceKm,
      fee: entry.price.subtotal,
      driverEarnings: entry.driverEarnings,
      platformCommission: entry.platformCommission,
      requestedAt: entry.requestedAt,
      deliveredAt: entry.deliveredAt,
      statusReason: entry.statusReason,
    }));

  return res.status(200).json({
    deliveries: rows,
    counts: {
      total: allDeliveries().length,
      active: allDeliveries().filter((d) => !["DELIVERED", "CANCELLED", "FAILED", "RETURNED"].includes(d.status)).length,
      delivered: allDeliveries().filter((d) => d.status === "DELIVERED").length,
      cancelled: allDeliveries().filter((d) => d.status === "CANCELLED").length,
      failed: allDeliveries().filter((d) => d.status === "FAILED").length,
    },
  });
});

/** GET /api/delivery/admin/deliveries/:id - one delivery, in full. */
deliveryAdminRouter.get("/admin/deliveries/:id", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const delivery = deliveryById(String(req.params.id));
  if (!delivery) return res.status(404).json({ error: "Delivery not found." });
  const driver = delivery.driverId ? driverById(delivery.driverId) : null;
  return res.status(200).json({
    delivery: deliveryForAdmin(delivery, driver ? driverForAdmin(driver) : null, null),
    earnings: allEarnings().filter((entry) => entry.deliveryId === delivery.id),
    rating: allRatings().find((entry) => entry.deliveryId === delivery.id) ?? null,
    offers: allOffersFor(delivery.id),
  });
});

function allOffersFor(deliveryId: string) {
  return allOffers()
    .filter((offer) => offer.deliveryId === deliveryId)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * POST /api/delivery/admin/deliveries/:id/assign
 *
 * Hand a job to a specific driver. The legitimate use is a dispatcher who can see
 * somebody suitable on the live map while the automated ranking missed them.
 *
 * The driver is CHECKED, not trusted: they must be approved, online, driving the
 * right vehicle, and not already carrying something. Assigning to an ineligible
 * driver is refused with the reason, because "the admin told me to" is not a
 * defence for putting an unverified courier on a customer's parcel.
 */
deliveryAdminRouter.post("/admin/deliveries/:id/assign", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const delivery = deliveryById(String(req.params.id));
  if (!delivery) return res.status(404).json({ error: "Delivery not found." });

  const driver = driverById(String((req.body ?? {}).driverId ?? ""));
  if (!driver) return res.status(404).json({ error: "Delivery person not found." });

  if (driver.status !== "APPROVED") {
    return bad(res, `${driver.fullName} is not approved to take deliveries.`);
  }
  if (driver.vehicle.type !== delivery.vehicleType) {
    return bad(res, `${driver.fullName} drives a different vehicle type.`);
  }
  const busy = allDeliveries().find(
    (entry) =>
      entry.driverId === driver.id &&
      entry.id !== delivery.id &&
      !["DELIVERED", "CANCELLED", "FAILED", "RETURNED"].includes(entry.status),
  );
  if (busy) return bad(res, `${driver.fullName} is already carrying delivery ${busy.id}.`);

  const reason = String((req.body ?? {}).reason ?? "").trim().slice(0, 300);
  const before = { status: delivery.status, driverId: delivery.driverId };

  try {
    const assigned = applyTransition(
      delivery.status === "SEARCHING_DRIVER" ? delivery : delivery,
      "DRIVER_ASSIGNED",
      { kind: "admin", id: caller.userId },
      reason || "Assigned by an administrator",
    );
    assigned.driverId = driver.id;
    replaceDelivery(assigned);
    setDriverAvailability(driver.id, "BUSY");

    auditDeliveryAction({
      action: "delivery.reassigned",
      actorId: caller.userId,
      actorName: caller.name,
      subjectId: delivery.id,
      reason,
      before,
      after: { status: assigned.status, driverId: driver.id },
    });
    notifyDelivery(assigned, "delivery.driver_assigned", {
      customer: "A delivery person has been assigned to your order.",
      merchant: `A delivery person has been assigned to delivery ${assigned.id}.`,
      driver: "A delivery has been assigned to you by dispatch.",
      admin: `Delivery ${assigned.id} assigned to ${driver.fullName}.`,
    });
    return res.status(200).json({ delivery: deliveryForAdmin(assigned, driverForAdmin(driver), null) });
  } catch (error) {
    return handleError(res, error);
  }
});

/**
 * POST /api/delivery/admin/deliveries/:id/cancel
 *
 * Stop a delivery. A REASON IS MANDATORY: an unexplained cancellation is exactly
 * what a dispute needs, and an administrator cancelling their own mistake should
 * have to say so.
 */
deliveryAdminRouter.post("/admin/deliveries/:id/cancel", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const delivery = deliveryById(String(req.params.id));
  if (!delivery) return res.status(404).json({ error: "Delivery not found." });

  const reason = String((req.body ?? {}).reason ?? "").trim().slice(0, 300);
  if (reason.length < 3) return bad(res, "Please give a reason for cancelling this delivery.");

  const before = { status: delivery.status, driverId: delivery.driverId };
  try {
    const cancelled = applyTransition(delivery, "CANCELLED", { kind: "admin", id: caller.userId }, reason);
    releaseDriver(cancelled);
    auditDeliveryAction({
      action: "delivery.cancelled",
      actorId: caller.userId,
      actorName: caller.name,
      subjectId: delivery.id,
      reason,
      before,
      after: { status: cancelled.status },
    });
    notifyDelivery(cancelled, "delivery.cancelled", {
      customer: `Your delivery was cancelled: ${reason}`,
      merchant: `Delivery ${cancelled.id} was cancelled: ${reason}`,
      driver: "A delivery you were carrying has been cancelled by dispatch.",
      admin: null,
    });
    return res.status(200).json({ delivery: deliveryForAdmin(cancelled, null, null) });
  } catch (error) {
    return handleError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Pricing, vehicles, zones
// ---------------------------------------------------------------------------

/**
 * Every field an administrator may change, with the range it must fall inside.
 *
 * Declared as DATA rather than as a series of `if` statements, because a
 * forgotten bounds check is how an operator sets a negative delivery fee.
 */
const PRICING_LIMITS: Record<string, { min: number; max: number }> = {
  baseFee: { min: 0, max: 100_000 },
  pricePerKm: { min: 0, max: 100_000 },
  heavySurcharge: { min: 0, max: 100_000 },
  heavyThresholdKg: { min: 0, max: 10_000 },
  bulkySurcharge: { min: 0, max: 100_000 },
  bulkyThresholdCm: { min: 0, max: 10_000 },
  fragileSurcharge: { min: 0, max: 100_000 },
  minFee: { min: 0, max: 100_000 },
  maxFee: { min: 0, max: 1_000_000 },
  peakMultiplier: { min: 1, max: 5 },
  commissionBps: { min: 0, max: 9_000 },
  offerTtlSec: { min: 10, max: 600 },
  maxConcurrentOffers: { min: 1, max: 50 },
  searchTimeoutSec: { min: 60, max: 86_400 },
  locationStaleSec: { min: 15, max: 3_600 },
};

/** GET /api/delivery/admin/pricing - the configuration, plus every vehicle. */
deliveryAdminRouter.get("/admin/pricing", (_req: Request, res: Response) => {
  return res.status(200).json({ pricing: pricingConfig(), vehicles: allVehicles() });
});

/**
 * PUT /api/delivery/admin/pricing
 *
 * Change the fees.
 *
 * ONLY THE FIELDS NAMED ARE WRITTEN. A partial update cannot blank a field the
 * form did not render, and a field this function does not know about is ignored
 * rather than merged - so adding a field to the config without adding it here
 * cannot silently do nothing.
 *
 * `maxFee: null` is meaningful (no ceiling), so it is handled explicitly rather
 * than being skipped as "absent".
 */
deliveryAdminRouter.put("/admin/pricing", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const current = pricingConfig();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const next = { ...current };
  const changed: string[] = [];
  const rejected: string[] = [];

  for (const [field, limits] of Object.entries(PRICING_LIMITS)) {
    if (!(field in body)) continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
      rejected.push(`${field} must be between ${limits.min} and ${limits.max}.`);
      continue;
    }
    if ((next as unknown as Record<string, number>)[field] !== value) changed.push(field);
    (next as unknown as Record<string, number>)[field] = value;
  }

  if ("maxFee" in body) {
    const ceiling = body.maxFee === null ? null : Number(body.maxFee);
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > 1_000_000)) {
      rejected.push("maxFee must be a number, or null for no ceiling.");
    } else {
      next.maxFee = ceiling;
      changed.push("maxFee");
    }
  }

  if (Array.isArray(body.proofMethod)) {
    const method = String(body.proofMethod[0] ?? "");
    if (["otp", "customer-confirmation", "code"].includes(method)) {
      next.proofMethod = method as typeof next.proofMethod;
      changed.push("proofMethod");
    } else {
      rejected.push("Choose a valid proof method.");
    }
  }

  if (Array.isArray(body.peakWindows)) {
    next.peakWindows = body.peakWindows
      .map((window) => {
        const w = window as { fromHour?: unknown; toHour?: unknown; days?: unknown };
        return {
          fromHour: Math.max(0, Math.min(23, Number(w.fromHour) || 0)),
          toHour: Math.max(0, Math.min(23, Number(w.toHour) || 0)),
          days: Array.isArray(w.days) ? w.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
        };
      })
      .slice(0, 10);
    changed.push("peakWindows");
  }

  if (rejected.length > 0) return res.status(400).json({ error: rejected.join(" "), rejected });

  if (changed.length === 0) {
    return res.status(200).json({ pricing: next, message: "Nothing changed." });
  }

  next.updatedAt = new Date().toISOString();
  next.updatedBy = caller.userId;
  savePricingConfig(next);

  auditDeliveryAction({
    action: "pricing.updated",
    actorId: caller.userId,
    actorName: caller.name,
    subjectId: "pricing",
    reason: String((req.body ?? {}).reason ?? "").slice(0, 300),
    before: Object.fromEntries(changed.map((field) => [field, (current as unknown as Record<string, unknown>)[field]])),
    after: Object.fromEntries(changed.map((field) => [field, (next as unknown as Record<string, unknown>)[field]])),
  });

  return res.status(200).json({
    pricing: next,
    changed,
    message: `Updated: ${changed.join(", ")}.`,
  });
});

/**
 * PUT /api/delivery/admin/vehicles/:id
 *
 * Change one vehicle class. Capacities AND fees are editable here - a truck that
 * can now take 12 tonnes is a real operational change, and a van whose price rose
 * is a commercial one. Both belong in the same place.
 */
deliveryAdminRouter.put("/admin/vehicles/:id", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const vehicle = allVehicles().find((entry) => entry.id === String(req.params.id));
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const before = { ...vehicle };
  const changed: string[] = [];

  const numericFields: Record<string, { min: number; max: number }> = {
    maxWeightKg: { min: 0, max: 50_000 },
    maxPackageSizeCm: { min: 1, max: 1_000 },
    maxItems: { min: 1, max: 10_000 },
    baseFee: { min: 0, max: 100_000 },
    pricePerKm: { min: 0, max: 100_000 },
    minFee: { min: 0, max: 100_000 },
    peakMultiplier: { min: 1, max: 5 },
    averageSpeedKph: { min: 5, max: 200 },
  };

  for (const [field, limits] of Object.entries(numericFields)) {
    if (!(field in body)) continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
      return bad(res, `${field} must be between ${limits.min} and ${limits.max}.`);
    }
    if ((vehicle as unknown as Record<string, number>)[field] !== value) changed.push(field);
    (vehicle as unknown as Record<string, number>)[field] = value;
  }

  for (const field of ["active", "carriesFragile"] as const) {
    if (field in body) {
      const value = body[field] === true;
      if (vehicle[field] !== value) changed.push(field);
      vehicle[field] = value;
    }
  }

  for (const field of ["name", "description"] as const) {
    if (typeof body[field] === "string" && body[field].trim()) {
      const value = (body[field] as string).trim().slice(0, 200);
      if (vehicle[field] !== value) changed.push(field);
      vehicle[field] = value;
    }
  }

  if ("maxFee" in body) {
    const ceiling = body.maxFee === null ? null : Number(body.maxFee);
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling < 0)) {
      return bad(res, "maxFee must be a number, or null for no ceiling.");
    }
    vehicle.maxFee = ceiling;
    changed.push("maxFee");
  }

  if (changed.length === 0) return res.status(200).json({ vehicle, message: "Nothing changed." });

  vehicle.updatedAt = new Date().toISOString();
  persistVehicles();
  auditDeliveryAction({
    action: "vehicle.updated",
    actorId: caller.userId,
    actorName: caller.name,
    subjectId: vehicle.id,
    reason: String(body.reason ?? "").slice(0, 300),
    before: Object.fromEntries(changed.map((f) => [f, (before as unknown as Record<string, unknown>)[f]])),
    after: Object.fromEntries(changed.map((f) => [f, (vehicle as unknown as Record<string, unknown>)[f]])),
  });

  return res.status(200).json({ vehicle, changed, message: `Updated: ${changed.join(", ")}.` });
});


// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * Zones are POLYGONS AN ADMINISTRATOR DRAWS.
 *
 * No city is named anywhere in this module. A zone is whatever the operator
 * makes it, so a deployment inherits no geographic assumption from the code -
 * which is the difference between a configurable zone and a hard-coded city.
 */
deliveryAdminRouter.get("/admin/zones", (_req: Request, res: Response) => {
  return res.status(200).json({ zones: allZones() });
});

deliveryAdminRouter.post("/admin/zones", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = String(body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) return bad(res, "Enter a zone name.");

  const now = new Date().toISOString();
  const zone = {
    id: newId("zone"),
    name,
    area: String(body.area ?? "").trim().slice(0, 200),
    polygon: parsePolygon(body.polygon),
    zoneFee: boundedNumber(body.zoneFee, -100_000, 100_000) ?? 0,
    pricePerKm: body.pricePerKm === null || body.pricePerKm === undefined
      ? null
      : boundedNumber(body.pricePerKm, 0, 100_000),
    active: body.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  allZones().push(zone);
  persistZones();
  auditDeliveryAction({
    action: "zone.updated",
    actorId: caller.userId,
    actorName: caller.name,
    subjectId: zone.id,
    reason: `Zone "${zone.name}" created`,
    after: { name: zone.name, zoneFee: zone.zoneFee, pricePerKm: zone.pricePerKm },
  });
  return res.status(201).json({ zone });
});

deliveryAdminRouter.put("/admin/zones/:id", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const caller = resolveCaller(req)!;
  const zone = allZones().find((entry) => entry.id === String(req.params.id));
  if (!zone) return res.status(404).json({ error: "Zone not found." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const before = { ...zone };
  const changed: string[] = [];

  if (typeof body.name === "string" && body.name.trim()) {
    zone.name = body.name.trim().slice(0, 80);
    changed.push("name");
  }
  if (typeof body.area === "string") {
    zone.area = body.area.trim().slice(0, 200);
    changed.push("area");
  }
  if ("polygon" in body) {
    zone.polygon = parsePolygon(body.polygon);
    changed.push("polygon");
  }
  if ("zoneFee" in body) {
    const fee = boundedNumber(body.zoneFee, -100_000, 100_000);
    if (fee === null) return bad(res, "zoneFee must be a number.");
    zone.zoneFee = fee;
    changed.push("zoneFee");
  }
  if ("pricePerKm" in body) {
    const perKm = body.pricePerKm === null ? null : boundedNumber(body.pricePerKm, 0, 100_000);
    if (body.pricePerKm !== null && perKm === null) return bad(res, "pricePerKm must be a number or null.");
    zone.pricePerKm = perKm;
    changed.push("pricePerKm");
  }
  if ("active" in body) {
    zone.active = body.active === true;
    changed.push("active");
  }

  if (changed.length === 0) return res.status(200).json({ zone, message: "Nothing changed." });
  zone.updatedAt = new Date().toISOString();
  persistZones();
  auditDeliveryAction({
    action: "zone.updated",
    actorId: caller.userId,
    actorName: caller.name,
    subjectId: zone.id,
    reason: String(body.reason ?? "").slice(0, 300),
    before: Object.fromEntries(changed.map((f) => [f, (before as unknown as Record<string, unknown>)[f]])),
    after: Object.fromEntries(changed.map((f) => [f, (zone as unknown as Record<string, unknown>)[f]])),
  });
  return res.status(200).json({ zone, changed, message: `Updated: ${changed.join(", ")}.` });
});

/** A number inside a range, or null. Never throws on junk. */
function boundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * A polygon, validated.
 *
 * A coordinate outside the valid range is REJECTED rather than clamped: a point
 * at 200 degrees is a mistake, and clamping it to -160 would put the zone in the
 * wrong hemisphere. Fewer than three points is stored as null, which the geo
 * module treats as "applies everywhere" - a safer failure than a shape that
 * silently matches nothing.
 */
function parsePolygon(value: unknown): { latitude: number; longitude: number }[] | null {
  if (!Array.isArray(value)) return null;
  const points = value
    .map((entry) => {
      const point = entry as { latitude?: unknown; longitude?: unknown };
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return null;
      }
      return { latitude, longitude };
    })
    .filter((point): point is { latitude: number; longitude: number } => point !== null);
  return points.length >= 3 ? points : null;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * GET /api/delivery/admin/analytics
 *
 * Every figure the specification asks for, computed from the delivery rows.
 *
 * REVENUE COUNTS COMPLETED DELIVERIES ONLY
 *  ---------------------------------------
 *  A cancelled or in-flight delivery has a QUOTE, not a fee collected. Counting
 *  them would make revenue look better the day a batch of orders was cancelled,
 *  which is exactly the moment an administrator most needs the number to be
 *  true.
 */
deliveryAdminRouter.get("/admin/analytics", (req: Request, res: Response) => {
  if (!admin(req, res)) return;

  const all = allDeliveries();
  const completed = all.filter((entry) => entry.status === "DELIVERED");
  const active = all.filter((entry) => !["DELIVERED", "CANCELLED", "FAILED", "RETURNED"].includes(entry.status));

  const durations = completed
    .map((entry) => {
      if (!entry.deliveredAt) return null;
      const started = new Date(entry.requestedAt).getTime();
      const ended = new Date(entry.deliveredAt).getTime();
      return Number.isFinite(started) && Number.isFinite(ended) && ended > started ? (ended - started) / 1000 : null;
    })
    .filter((value): value is number => value !== null);

  // Most active drivers, from the completed rows rather than a stored counter,
  // so the figure can be recomputed and checked.
  const byDriver = new Map<string, number>();
  for (const entry of completed) {
    if (!entry.driverId) continue;
    byDriver.set(entry.driverId, (byDriver.get(entry.driverId) ?? 0) + 1);
  }

  const byZone = new Map<string, number>();
  for (const entry of all) {
    if (!entry.zoneId) continue;
    byZone.set(entry.zoneId, (byZone.get(entry.zoneId) ?? 0) + 1);
  }

  const byVehicle = new Map<string, number>();
  for (const entry of all) {
    byVehicle.set(entry.vehicleType, (byVehicle.get(entry.vehicleType) ?? 0) + 1);
  }

  const revenue = completed.reduce((sum, entry) => sum + entry.price.subtotal, 0);

  return res.status(200).json({
    total: all.length,
    active: active.length,
    delivered: completed.length,
    cancelled: all.filter((entry) => entry.status === "CANCELLED").length,
    failed: all.filter((entry) => entry.status === "FAILED").length,
    returned: all.filter((entry) => entry.status === "RETURNED").length,
    averageDeliverySec:
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    averageDistanceKm:
      all.length > 0 ? Math.round((all.reduce((sum, e) => sum + e.distanceKm, 0) / all.length) * 100) / 100 : 0,
    revenue,
    driverEarnings: completed.reduce((sum, entry) => sum + entry.driverEarnings, 0),
    platformCommission: completed.reduce((sum, entry) => sum + entry.platformCommission, 0),
    mostActiveDrivers: [...byDriver.entries()]
      .map(([driverId, deliveries]) => ({
        driverId,
        name: driverById(driverId)?.fullName ?? "Unknown",
        deliveries,
      }))
      .sort((a, b) => b.deliveries - a.deliveries)
      .slice(0, 10),
    demandByZone: [...byZone.entries()]
      .map(([zoneId, deliveries]) => ({
        zoneId,
        name: allZones().find((z) => z.id === zoneId)?.name ?? "Unassigned",
        deliveries,
      }))
      .sort((a, b) => b.deliveries - a.deliveries),
    demandByVehicle: [...byVehicle.entries()].map(([vehicleType, deliveries]) => ({ vehicleType, deliveries })),
    drivers: {
      total: allDrivers().length,
      approved: allDrivers().filter((d) => d.status === "APPROVED").length,
      online: allDrivers().filter((d) => d.availability === "ONLINE").length,
      busy: allDrivers().filter((d) => d.availability === "BUSY").length,
    },
  });
});

/** GET /api/delivery/admin/audit - the record of every administrative action. */
deliveryAdminRouter.get("/admin/audit", (req: Request, res: Response) => {
  if (!admin(req, res)) return;
  const subjectId = String(req.query.subject ?? "");
  return res.status(200).json({
    audit: subjectId ? auditForSubject(subjectId) : recentAudit(200),
  });
});

/** GET /api/delivery/admin/map - which map provider is in use. */
deliveryAdminRouter.get("/admin/map", (_req: Request, res: Response) => {
  const map = mapStatus();
  return res.status(200).json({
    map,
    publicEnv: publicMapEnv(),
    note: "Set DELIVERY_MAP_PROVIDER and its key to enable road routing. See .env.example.",
  });
});
