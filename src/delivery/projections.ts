/**
 * ============================================================================
 *  PROJECTIONS - what each participant is allowed to see
 * ============================================================================
 *
 *  THE CENTRAL PRIVACY RULE
 *  -----------------------
 *  A `Delivery` row holds everything: the customer's phone number, the driver's
 *  identity documents, the driver's exact position, the earnings split. NOBODY
 *  may receive that row. Every read path goes through one of the projections
 *  below, and each constructs its object FIELD BY FIELD rather than spreading
 *  the source and deleting the private parts.
 *
 *  Spreading and deleting is how a field added next year silently leaks: nobody
 *  remembers to add it to the delete list. A projection that must name every
 *  field it ALLOWS fails to compile the day a private field is added, which is
 *  when the leak is prevented rather than discovered.
 *
 *  THE FOUR AUDIENCES
 *  ------------------
 *    customer   their own delivery; the driver's name, photo and rating; the
 *               driver's live position WHILE the delivery is live.
 *    driver     the addresses and contacts they must act on, and the fee.
 *    merchant   their own deliveries, the customer address, the driver's
 *               position while active.
 *    admin      everything, because that is the job.
 */

import type { Delivery, DriverProfile } from "./types";

/** What a customer may know about the person carrying their parcel. */
export interface PublicDriverView {
  id: string;
  fullName: string;
  photoUrl: string | null;
  vehicleType: Delivery["vehicleType"];
  vehicleIcon: string | null;
  /** The plate is shown only once a driver is assigned. */
  vehiclePlate: string | null;
  /** 0 when unrated. */
  rating: number;
  ratingCount: number;
  /** Only ever sent to THIS delivery's customer. Never into a list. */
  phone: string | null;
  totalDeliveries: number;
}

/** A status that still holds a driver, i.e. the job is live. */
export function isLiveDelivery(status: Delivery["status"]): boolean {
  return status !== "DELIVERED" && status !== "CANCELLED" && status !== "FAILED" && status !== "RETURNED";
}

/**
 * Mask an id or licence number, so an administrator browsing a list does not put
 * a complete document number on a shared screen. Four visible characters is the
 * floor for "is this the one I remember?" without being the whole identifier.
 */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

/** A phone shown to another party: enough to ring, not enough to harvest. */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•".repeat(value.length);
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/** Average rating, to one decimal, or 0 when unrated. */
export function averageRating(driver: Pick<DriverProfile, "ratingSum" | "ratingCount">): number {
  if (driver.ratingCount <= 0) return 0;
  return Math.round((driver.ratingSum / driver.ratingCount) * 10) / 10;
}

// ---------------------------------------------------------------------------
// The driver's public face
// ---------------------------------------------------------------------------

/**
 * What a CUSTOMER sees of their driver.
 *
 * `phone` is included deliberately - the customer must be able to contact the
 * driver - but it is sent only to the customer of that specific delivery, never
 * into a list and never to another customer.
 */
export function driverForCustomer(
  driver: DriverProfile,
  deliveryStatus: Delivery["status"],
): PublicDriverView | null {
  // Before the job is assigned there is nobody to describe.
  if (deliveryStatus === "REQUESTED" || deliveryStatus === "SEARCHING_DRIVER") return null;
  return {
    id: driver.id,
    fullName: driver.fullName,
    photoUrl: driver.photoUrl,
    vehicleType: driver.vehicle.type,
    vehicleIcon: null,
    vehiclePlate: driver.vehicle.plateNumber,
    rating: averageRating(driver),
    ratingCount: driver.ratingCount,
    phone: driver.phone,
    totalDeliveries: driver.deliveriesCompleted,
  };
}

/**
 * What a MERCHANT sees of the driver on their own delivery.
 *
 * The full phone is withheld once the parcel has been collected: by then the
 * merchant's part is done, and the direct line between a customer and their
 * courier is not the merchant's business. The merchant still sees the name, the
 * vehicle and, while the job runs, the live position.
 */
export function driverForMerchant(
  driver: DriverProfile,
  deliveryStatus: Delivery["status"],
): (Omit<PublicDriverView, "phone"> & { phone: string | null }) | null {
  if (!driverForCustomer(driver, deliveryStatus)) return null;
  return {
    id: driver.id,
    fullName: driver.fullName,
    photoUrl: driver.photoUrl,
    vehicleType: driver.vehicle.type,
    vehicleIcon: null,
    vehiclePlate: driver.vehicle.plateNumber,
    rating: averageRating(driver),
    ratingCount: driver.ratingCount,
    phone: isLiveDelivery(deliveryStatus) ? driver.phone : null,
    totalDeliveries: driver.deliveriesCompleted,
  };
}

/** A driver's OWN profile. The only projection that may reference documents. */
export function driverForSelf(driver: DriverProfile) {
  return {
    id: driver.id,
    fullName: driver.fullName,
    phone: driver.phone,
    email: driver.email,
    photoUrl: driver.photoUrl,
    status: driver.status,
    availability: driver.availability,
    statusReason: driver.statusReason,
    vehicle: driver.vehicle,
    license: {
      number: driver.license.number,
      expiresOn: driver.license.expiresOn,
      classes: driver.license.classes,
    },
    address: driver.address,
    emergencyContact: driver.emergencyContact,
    // Filenames, never content: the bytes are fetched through an
    // ownership-checked route rather than being addressable.
    hasIdDocument: Boolean(driver.documents.idDocument),
    hasLicenseDocument: Boolean(driver.documents.licenseDocument),
    hasVehicleDocument: Boolean(driver.documents.vehicleDocument),
    rating: averageRating(driver),
    ratingCount: driver.ratingCount,
    deliveriesCompleted: driver.deliveriesCompleted,
    earningsTotal: driver.earningsTotal,
    registeredAt: driver.registeredAt,
    approvedAt: driver.approvedAt,
  };
}

/**
 * An ADMIN's view of a driver.
 *
 * The full id and licence numbers appear here because verification is precisely
 * the administrator's job - in the one projection that requires a super-admin,
 * rather than sprinkled through the admin list where it would reach a screen
 * that does not need it.
 */
export function driverForAdmin(driver: DriverProfile) {
  return {
    ...driverForSelf(driver),
    userId: driver.userId,
    idNumber: driver.idNumber,
    documents: driver.documents,
    reviewedAt: driver.reviewedAt,
    reviewedBy: driver.reviewedBy,
    ratingSum: driver.ratingSum,
  };
}

/** A list row: enough to act on, with the sensitive numbers masked. */
export function driverForList(driver: DriverProfile) {
  return {
    id: driver.id,
    fullName: driver.fullName,
    phoneMasked: maskPhone(driver.phone) ?? "",
    photoUrl: driver.photoUrl,
    status: driver.status,
    availability: driver.availability,
    statusReason: driver.statusReason,
    vehicleType: driver.vehicle.type,
    vehiclePlate: driver.vehicle.plateNumber,
    idNumberMasked: maskIdentifier(driver.idNumber),
    rating: averageRating(driver),
    ratingCount: driver.ratingCount,
    deliveriesCompleted: driver.deliveriesCompleted,
    earningsTotal: driver.earningsTotal,
    registeredAt: driver.registeredAt,
    approvedAt: driver.approvedAt,
  };
}

// ---------------------------------------------------------------------------
// The delivery itself, per audience
// ---------------------------------------------------------------------------

/** Shared by every audience: the parcel's journey, with nothing private in it. */
function deliveryCore(delivery: Delivery) {
  return {
    id: delivery.id,
    status: delivery.status,
    reference: delivery.sourceRef,
    orderId: delivery.orderId,
    vehicleType: delivery.vehicleType,
    pickupAddress: delivery.pickup.address,
    destinationAddress: delivery.destination.address,
    distanceKm: delivery.distanceKm,
    estimatedDurationSec: delivery.estimatedDurationSec,
    /** The quote the customer agreed to. Frozen, so it cannot drift. */
    fee: {
      total: delivery.price.subtotal,
      currency: delivery.price.currency,
      breakdown: delivery.price.breakdown,
    },
    packageSummary: delivery.packageSpec.summary,
    fragile: delivery.packageSpec.fragile,
    handlingNotes: delivery.packageSpec.handlingNotes,
    deliveryNotes: delivery.deliveryNotes,
    proofMethod: delivery.proofMethod,
    requestedAt: delivery.requestedAt,
    acceptedAt: delivery.acceptedAt,
    deliveredAt: delivery.deliveredAt,
    cancelledAt: delivery.cancelledAt,
    statusReason: delivery.statusReason,
    history: delivery.history,
  };
}

/** Coordinates, so a map can draw the route. Never on its own an address. */
function geometry(delivery: Delivery) {
  return {
    pickup: { latitude: delivery.pickup.latitude, longitude: delivery.pickup.longitude },
    destination: {
      latitude: delivery.destination.latitude,
      longitude: delivery.destination.longitude,
    },
    route: delivery.routeGeometry,
  };
}

/** The PLAINTEXT code, never stored. Passed in by the caller that just made it. */
export type ProofCode = string | null;

/**
 * The CUSTOMER's view.
 *
 * Carries the driver's live position, but ONLY while the delivery is live - a
 * courier's whereabouts after they handed the parcel over is nobody's business.
 * Carries the delivery code only at the door and only while it is unused, because
 * a code sitting in an order list for an hour is a code read over a shoulder.
 */
export function deliveryForCustomer(
  delivery: Delivery,
  driver: PublicDriverView | null,
  livePosition: { latitude: number; longitude: number; at: string } | null,
  proofCode: ProofCode = null,
) {
  const live = isLiveDelivery(delivery.status);
  const showProof =
    proofCode !== null && delivery.status === "ARRIVING" && delivery.proofVerifiedAt === null;
  return {
    ...deliveryCore(delivery),
    ...geometry(delivery),
    merchantId: delivery.merchantId,
    driver,
    driverPosition: live ? livePosition : null,
    deliveryCode: showProof ? proofCode : null,
    /** Whether the customer may still confirm receipt themselves. */
    canConfirm: delivery.status === "ARRIVING",
    canRate: delivery.status === "DELIVERED" && delivery.proofVerifiedAt !== null,
    canCancel: delivery.status === "REQUESTED" || delivery.status === "SEARCHING_DRIVER",
    canReportProblem: delivery.status !== "REQUESTED" && delivery.status !== "SEARCHING_DRIVER",
  };
}

/**
 * The DRIVER's view of a job.
 *
 * The one projection carrying BOTH full contact numbers, because the driver is
 * the only person who must ring either end. It carries no platform breakdown and
 * no other driver's data.
 */
export function deliveryForDriver(delivery: Delivery) {
  return {
    ...deliveryCore(delivery),
    ...geometry(delivery),
    merchantId: delivery.merchantId,
    customerId: delivery.customerId,
    pickupContactName: delivery.pickupContactName,
    pickupContactPhone: delivery.pickupContactPhone,
    destinationContactName: delivery.destinationContactName,
    destinationContactPhone: delivery.destinationContactPhone,
    /** What this job pays. The platform's cut is NOT shown. */
    earnings: delivery.driverEarnings,
    commissionBps: delivery.price.commissionBps,
  };
}

/**
 * The MERCHANT's view of their own delivery.
 *
 * The customer's full phone number is withheld once the parcel has been
 * collected: from that point a direct customer-courier line is not the merchant's
 * business, and holding it invites the merchant to route around the dispatch
 * system entirely.
 */
export function deliveryForMerchant(
  delivery: Delivery,
  driver: (Omit<PublicDriverView, "phone"> & { phone: string | null }) | null,
  livePosition: { latitude: number; longitude: number; at: string } | null,
) {
  const live = isLiveDelivery(delivery.status);
  const handoffDone = delivery.pickedUpAt !== null;
  return {
    ...deliveryCore(delivery),
    ...geometry(delivery),
    customerName: delivery.destinationContactName,
    customerPhone: handoffDone
      ? maskPhone(delivery.destinationContactPhone)
      : delivery.destinationContactPhone,
    driver,
    driverPosition: live ? livePosition : null,
    /** A merchant may withdraw a job before it leaves the shop. */
    canCancel:
      delivery.status === "REQUESTED" ||
      delivery.status === "SEARCHING_DRIVER" ||
      delivery.status === "DRIVER_ASSIGNED" ||
      delivery.status === "DRIVER_GOING_TO_PICKUP" ||
      delivery.status === "ARRIVED_AT_PICKUP",
  };
}

/** The ADMIN's view: the whole record, plus the proof audit trail. */
export function deliveryForAdmin(
  delivery: Delivery,
  driver: ReturnType<typeof driverForAdmin> | null,
  livePosition: {
    latitude: number;
    longitude: number;
    heading: number | null;
    speedMps: number | null;
    at: string;
  } | null,
) {
  return {
    ...delivery,
    driver,
    driverPosition: livePosition,
    // The HASH is shown, never the code: an administrator can confirm a proof was
    // recorded without being able to invent one.
    proofCodeHash: delivery.proofCodeHash,
  };
}

/**
 * May this caller read this delivery AT ALL?
 *
 * THE FIRST CHECK, BEFORE ANY FIELD IS CHOSEN
 * --------------------------------------------
 * The caller resolves a driver id from their OWN session rather than accepting
 * one, which is what stops a driver reading another driver's job by passing a
 * different id in the query string.
 */
export function mayReadDelivery(
  delivery: Delivery,
  caller: { userId: string; businessId: string | null; isSuperAdmin: boolean; isAdmin?: boolean },
  driverIdForUser: (userId: string) => string | null,
): boolean {
  if (caller.isSuperAdmin || caller.isAdmin) return true;
  if (caller.userId === delivery.customerId) return true;
  if (caller.businessId && caller.businessId === delivery.merchantId) return true;
  const ownDriverId = driverIdForUser(caller.userId);
  return Boolean(ownDriverId && ownDriverId === delivery.driverId);
}

/** Is this caller the assigned driver for this delivery? */
export function isAssignedDriver(
  delivery: Delivery,
  callerUserId: string,
  driverIdForUser: (userId: string) => string | null,
): boolean {
  const ownDriverId = driverIdForUser(callerUserId);
  return Boolean(ownDriverId && ownDriverId === delivery.driverId);
}
