/**
 * ============================================================================
 *  YENE DELIVERY - TYPES
 * ============================================================================
 *
 *  A MODULE THAT CAN LEAVE YENE-STORE
 * ------------------------------------
 *  Nothing in this file makes a `Delivery` depend on a Yene-Store order. A
 *  delivery stands on its own: a `source` (whoever raised it), a pickup, a
 *  destination and a package. A Yene-Store `BusinessOrder` is ONE caller of it,
 *  not its owner - a restaurant, a pharmacy or an external website raises the
 *  same record with a different source and nothing above changes.
 *
 *  That is the single decision that makes "Yene Delivery" later a product
 *  rather than a rewrite.
 *
 *  PURE MODULE. Imported by the Express server AND the browser, so it stays
 *  free of Node-only and browser-only APIs - exactly like src/constants.ts.
 */

/** The money unit. Whole ETB, matching the platform's existing order totals. */
export type Currency = "ETB";

/** A point on the earth. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A point plus the human label that goes with it. */
export interface LabelledPoint extends GeoPoint {
  address: string;
}

// ---------------------------------------------------------------------------
// 1. Vehicles
// ---------------------------------------------------------------------------

/**
 * The five vehicle types. The ORDER is the ladder a customer reads, cheapest
 * first, which is why it is a tuple rather than a set.
 */
export const VEHICLE_TYPES = ["bicycle", "motorcycle", "car", "van", "truck"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === "string" && (VEHICLE_TYPES as readonly string[]).includes(value);
}

/**
 * A configurable vehicle class.
 *
 * Every number an operator could want to change is a FIELD, not a constant:
 * nothing here reads a hard-coded price. The engine only ever reads the STORED
 * row, so changing a price in the admin screen changes every later quote.
 */
export interface VehicleSpec {
  id: string;
  type: VehicleType;
  name: string;
  /** A stable glyph so the UI needs no icon-font round trip. */
  icon: string;
  description: string;
  active: boolean;

  /** Package compatibility. A vehicle that cannot carry it is never offered. */
  maxWeightKg: number;
  /** Longest side of the largest box, in centimetres. */
  maxPackageSizeCm: number;
  /** How many discrete items it can reasonably carry. */
  maxItems: number;
  /** True when this class may carry a fragile consignment. */
  carriesFragile: boolean;

  /** Money. Whole ETB. */
  baseFee: number;
  pricePerKm: number;
  minFee: number;
  /** null means no ceiling. */
  maxFee: number | null;

  /** Multiplier applied during a peak window. 1 = off. */
  peakMultiplier: number;
  /** Used only for the ESTIMATE, before a real route is known. */
  averageSpeedKph: number;

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 2. Zones
// ---------------------------------------------------------------------------

export interface DeliveryZone {
  id: string;
  name: string;
  /** A short human description of the area this covers. */
  area: string;
  /**
   * The zone boundary as a ring of coordinates, or null for a zone defined by
   * name alone. No city is named anywhere in this module: a zone is whatever
   * an administrator draws, so no deployment inherits somebody else's city.
   */
  polygon: GeoPoint[] | null;
  /** Added on top of the vehicle price. Negative values discount. */
  zoneFee: number;
  /** Overrides the vehicle's price-per-km when set. null = use the vehicle. */
  pricePerKm: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 3. Packages
// ---------------------------------------------------------------------------

/**
 * What has to be moved, DERIVED from the order rather than retyped by hand.
 *
 * The merchant never re-enters this: `packageFromLines` builds it from the
 * products, and a merchant may only ADD handling flags on top.
 */
export interface PackageSpec {
  weightKg: number;
  itemCount: number;
  /** Longest side of the largest box, in centimetres. */
  longestSideCm: number;
  /** Sum of the two smaller sides of the largest box, in centimetres. */
  girthCm: number;
  fragile: boolean;
  /** e.g. "keep upright", "cold chain". Shown to the driver. */
  handlingNotes: string[];
  /** Human summary for the driver screen: "10 x perfume, 2.5 kg". */
  summary: string;
}

// ---------------------------------------------------------------------------
// 4. Driver
// ---------------------------------------------------------------------------

/**
 * Verification is ADMIN-CONTROLLED. There is no path to APPROVED from a client
 * request anywhere in this module: registration always produces PENDING.
 */
export const DRIVER_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "BLOCKED",
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/**
 * Availability is orthogonal to verification: an APPROVED driver who has not
 * toggled on is OFFLINE, and an OFFLINE driver is sent nothing.
 */
export const DRIVER_AVAILABILITY = ["OFFLINE", "ONLINE", "BUSY", "SUSPENDED"] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[number];

/** Identity documents. Stored as filenames, never returned as content. */
export interface DriverDocuments {
  /** Filename under data/uploads/drivers, served only to admin or the owner. */
  idDocument: string | null;
  licenseDocument: string | null;
  /** Vehicle registration, where one applies. */
  vehicleDocument: string | null;
}

export interface DriverProfile {
  id: string;
  /** The Yene-Store `User` this driver is bound to, when they have an account. */
  userId: string | null;

  fullName: string;
  phone: string;
  email: string | null;
  /** Filename under data/uploads/drivers. Never an absolute path or data URI. */
  photoUrl: string | null;

  /** National id number. Masked on every projection except the admin document view. */
  idNumber: string | null;
  documents: DriverDocuments;

  vehicle: {
    type: VehicleType;
    make: string;
    model: string;
    /** Plate number, where the vehicle type is registered. */
    plateNumber: string | null;
    year: number | null;
    colour: string | null;
  };

  license: {
    number: string | null;
    /** ISO date (YYYY-MM-DD). */
    expiresOn: string | null;
    classes: string[];
  };

  emergencyContact: { name: string; phone: string } | null;
  address: string;

  status: DriverStatus;
  availability: DriverAvailability;

  /** Why a REJECTED / SUSPENDED / BLOCKED driver was stopped. Never for APPROVED. */
  statusReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;

  registeredAt: string;
  approvedAt: string | null;
  updatedAt: string;

  /** Rolling aggregates, recomputed on write so a list read is a single pass. */
  ratingSum: number;
  ratingCount: number;
  deliveriesCompleted: number;
  earningsTotal: number;
}

/** Only APPROVED + ONLINE drivers are candidates. One predicate, used everywhere. */
export function isDispatchable(driver: Pick<DriverProfile, "status" | "availability">): boolean {
  return driver.status === "APPROVED" && driver.availability === "ONLINE";
}

/**
 * The last known position of a driver: ONE ROW PER DRIVER, overwritten.
 *
 * This is the privacy decision. A courier's whole day is never accumulated on
 * disk - see `DriverLocationSample` for the short-lived trace kept only while a
 * delivery is live.
 */
export interface DriverLocation {
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  /** Metres per second, as reported by the device. */
  speedMps: number | null;
  /** The delivery this ping belonged to, when it was on the clock. */
  deliveryId: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// 5. The delivery and its status machine's vocabulary
// ---------------------------------------------------------------------------

/**
 * The declared lifecycle.
 *
 * `REQUESTED` is an instant: the record exists before the dispatch engine has
 * chosen anybody. `SEARCHING_DRIVER` is the state it spends time in.
 */
export const DELIVERY_STATUSES = [
  "REQUESTED",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_GOING_TO_PICKUP",
  "ARRIVED_AT_PICKUP",
  "ORDER_PICKED_UP",
  "IN_TRANSIT",
  "ARRIVING",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
  "RETURNED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);
}

/** How a delivery may have been raised. Kept open for Yene Delivery. */
export const DELIVERY_SOURCES = ["yene-store", "external", "manual", "erp"] as const;
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];

/** How hand-over at the door is proven. Admin-configurable, not hard-coded. */
export const PROOF_METHODS = ["otp", "customer-confirmation", "code"] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];

export interface DeliveryStatusEvent {
  at: string;
  status: DeliveryStatus;
  /** Who moved it: a role, plus the id of whoever did it. */
  actor: DeliveryActor;
  note: string;
}

/** Identifies WHO made a change. Never trusted from a request body. */
export type DeliveryActor =
  | { kind: "customer"; id: string }
  | { kind: "driver"; id: string }
  | { kind: "merchant"; id: string }
  | { kind: "admin"; id: string }
  | { kind: "system"; id: "dispatch" };

/**
 * A single delivery.
 *
 * It REFERENCES a Yene-Store order rather than copying it: `orderId`,
 * `customerId` and `merchantId` are ids. Address text is copied at request
 * time on purpose - an order's address is edited freely after checkout, and a
 * courier must be sent to where the parcel was addressed, not to wherever the
 * record drifts later.
 */
export interface Delivery {
  id: string;
  source: DeliverySource;
  /** e.g. "BO-CO-x-green-coffee", or an external system's own reference. */
  sourceRef: string | null;

  /** The Yene-Store order, when this delivery came from one. */
  orderId: string | null;
  customerOrderId: string | null;
  merchantId: string | null;
  customerId: string;

  driverId: string | null;
  vehicleType: VehicleType;

  pickup: LabelledPoint;
  pickupContactName: string;
  pickupContactPhone: string;

  destination: LabelledPoint;
  destinationContactName: string;
  destinationContactPhone: string;

  /** Kilometres. Straight-line estimate until a real route is computed. */
  distanceKm: number;
  /** Seconds. */
  estimatedDurationSec: number;
  /** The realised route, when the provider returned a polyline. */
  routeGeometry: GeoPoint[] | null;

  zoneId: string | null;
  vehicleTypeAtQuote: VehicleSpec["id"];

  /** The quote the customer agreed to, frozen at request time. */
  price: DeliveryPriceQuote;
  driverEarnings: number;
  platformCommission: number;

  packageSpec: PackageSpec;
  deliveryNotes: string;

  status: DeliveryStatus;
  statusReason: string | null;

  proofMethod: ProofMethod;
  /** Hashed with the delivery id, so a stolen store file is not an OTP book. */
  proofCodeHash: string | null;
  proofAttempts: number;
  proofVerifiedAt: string | null;
  /** Who confirmed at the door. */
  proofConfirmedBy: DeliveryActor | null;

  requestedAt: string;
  /** When the dispatch engine started looking, for the search timeout. */
  searchingSince: string | null;
  acceptedAt: string | null;
  arrivedAtPickupAt: string | null;
  pickedUpAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;

  /** Monotonic, bumped on every accepted transition. Blocks duplicate writes. */
  version: number;
  history: DeliveryStatusEvent[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 6. Offers - one request pushed to one driver
// ---------------------------------------------------------------------------

export type OfferState = "pending" | "accepted" | "declined" | "expired" | "withdrawn";

export interface DeliveryOffer {
  id: string;
  deliveryId: string;
  driverId: string;
  /** Straight-line km from the driver to the PICKUP at the moment of the offer. */
  pickupDistanceKm: number;
  state: OfferState;
  /** When the driver must answer by, or the offer is withdrawn from them. */
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
  /** Rank when the offer was made. 1 = first asked. */
  rank: number;
}
/**
 * A route point, retained ONLY for the life of an active delivery and pruned
 * when it closes. Bounded by MAX_LOCATION_SAMPLES_PER_DELIVERY.
 */
export interface DriverLocationSample {
  id: string;
  deliveryId: string;
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speedMps: number | null;
  at: string;
}

// ---------------------------------------------------------------------------
// 7. Money
// ---------------------------------------------------------------------------

/**
 * The itemised price, returned to the customer BEFORE they commit.
 *
 * Stored on the delivery, not recomputed later. A fee that could change after
 * the order was accepted is a fee the customer cannot trust, so every figure
 * here is frozen at request time along with the rules that produced it.
 */
export interface DeliveryPriceQuote {
  currency: Currency;
  baseFee: number;
  distanceFee: number;
  vehicleFee: number;
  zoneFee: number;
  surcharge: number;
  /** base + distance + vehicle + zone + surcharge + peak, before clamping. */
  subtotal: number;
  peakMultiplier: number;
  peakFee: number;
  minFeeApplied: boolean;
  maxFeeApplied: boolean;
  /** Every rule that produced the figure, so the receipt can explain it. */
  breakdown: string[];
  /** The commission percentage in basis points that will be taken. */
  commissionBps: number;
  /** What the driver keeps if the delivery completes. */
  driverEarnings: number;
  platformCommission: number;
  quotedAt: string;
}

/**
 * The operator-controlled pricing rules.
 *
 * ONE row for the deployment. A stored row always wins over the shipped
 * defaults, so an administrator sets a rate without a code change, and a fresh
 * deployment still has a defensible starting point.
 */
export interface DeliveryPricingConfig {
  id: string;
  currency: Currency;

  /** Fallback base fee when a vehicle has none of its own. */
  baseFee: number;
  /** Fallback per-km rate when neither vehicle nor zone sets one. */
  pricePerKm: number;
  /** Charged for a heavy or bulky consignment, above these thresholds. */
  heavySurcharge: number;
  heavyThresholdKg: number;
  bulkySurcharge: number;
  bulkyThresholdCm: number;
  fragileSurcharge: number;

  /** A floor applied after everything else. */
  minFee: number;
  /** null = no ceiling. */
  maxFee: number | null;

  /** Peak windows as UTC hours. Empty means peak pricing is off. */
  peakWindows: { fromHour: number; toHour: number; days: number[] }[];
  /** Applied only while a peak window is active. */
  peakMultiplier: number;

  /** Platform share of the delivery fee, in basis points. 1500 = 15%. */
  commissionBps: number;

  /** How long one driver has to answer before the offer moves on. Seconds. */
  offerTtlSec: number;
  /** How many drivers are asked at once. */
  maxConcurrentOffers: number;
  /** How long a delivery may search before it is auto-failed. Seconds. */
  searchTimeoutSec: number;

  /** How the door hand-over is proven. */
  proofMethod: ProofMethod;
  /** Where a live driver position is considered stale. */
  locationStaleSec: number;

  updatedAt: string;
  updatedBy: string | null;
}

// ---------------------------------------------------------------------------
// 8. Ratings, earnings, notifications
// ---------------------------------------------------------------------------

export interface DeliveryRating {
  id: string;
  deliveryId: string;
  driverId: string;
  customerId: string;
  /** 1-5, enforced server-side. */
  stars: number;
  traits: string[];
  comment: string;
  createdAt: string;
}

export interface DriverEarning {
  id: string;
  driverId: string;
  deliveryId: string;
  grossFee: number;
  commissionBps: number;
  platformCommission: number;
  netEarnings: number;
  /** ISO date (YYYY-MM-DD) so a history groups without a date library. */
  earnedOn: string;
  createdAt: string;
}

export const DELIVERY_NOTIFICATION_AUDIENCES = ["customer", "merchant", "driver", "admin"] as const;
export type DeliveryNotificationAudience = (typeof DELIVERY_NOTIFICATION_AUDIENCES)[number];

/**
 * Channels are declared here so push or SMS is a new TRANSPORT, not a new
 * notification shape. `in-app` is always written; the others are dispatched by
 * a transport that may legitimately have no credentials.
 */
export const DELIVERY_NOTIFICATION_CHANNELS = ["in-app", "push", "sms", "email"] as const;
export type DeliveryNotificationChannel = (typeof DELIVERY_NOTIFICATION_CHANNELS)[number];

export interface DeliveryNotification {
  id: string;
  deliveryId: string | null;
  /** The user id this is addressed to. */
  recipientId: string;
  /** Which kind of participant that user is for THIS delivery. */
  audience: DeliveryNotificationAudience;
  channel: DeliveryNotificationChannel;
  /** The machine name of the event, e.g. "delivery.driver_assigned". */
  event: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 9. Analytics
// ---------------------------------------------------------------------------

export interface DeliveryAnalytics {
  total: number;
  active: number;
  delivered: number;
  cancelled: number;
  failed: number;
  /** Mean seconds from `requestedAt` to `deliveredAt`, over completed deliveries. */
  averageDeliverySec: number;
  averageDistanceKm: number;
  /** Fees collected on completed deliveries. */
  revenue: number;
  driverEarnings: number;
  platformCommission: number;
  mostActiveDrivers: { driverId: string; name: string; deliveries: number }[];
  demandByZone: { zoneId: string; name: string; deliveries: number }[];
  demandByVehicle: { vehicleType: VehicleType; deliveries: number }[];
}