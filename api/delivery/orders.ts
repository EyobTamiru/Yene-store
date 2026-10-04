/**
 * ============================================================================
 *  DELIVERY INTEGRATION WITH THE EXISTING ORDER SYSTEM
 * ============================================================================
 *
 *  How a Yene-Store order becomes a delivery, without duplicating anything.
 *
 *  THE RULE: A DELIVERY REFERENCES AN ORDER, IT DOES NOT COPY IT
 *  -----------------------------------------------------------
 *  A `Delivery` stores `orderId`, `customerId` and `merchantId`. It does not
 *  create a second order, a second customer record or a second address book.
 *  There is therefore no way for the two to disagree about what was bought or
 *  who bought it.
 *
 *  THE EXCEPTION, AND WHY
 *  ---------------------
 *  The address TEXT is copied onto the delivery at request time. That is the one
 *  duplication, and it is deliberate: an order's address is edited freely after
 *  checkout, and a courier must be sent to where the parcel was ADDRESSED, not
 *  to wherever the record drifts later. `order.addressLat` / `addressLon` are
 *  optional pin coordinates - the platform order has no geocode today - and the
 *  customer supplies them at checkout.
 *
 *  NO TENANT FROM THE CLIENT
 *  -------------------------
 *  `merchantLocation` reads the business from the ORDER, which was itself created
 *  against a verified identity. Nothing in the delivery request body names a
 *  business, so a customer cannot request delivery from a shop they did not buy
 *  from, nor make that shop's courier pick up somebody else's parcel.
 */

import { haversineKm, estimateDurationSec, ROAD_DETOUR_FACTOR } from "../../src/delivery";
import { allBusinesses, allBusinessOrders } from "../platform/store";
import type { Business, BusinessOrder } from "../../src/platform/types";
import type { VehicleSpec } from "../../src/delivery/types";

/**
 * The `BusinessOrder` shape this module reads.
 *
 * Declared here rather than imported wholesale because the platform order has no
 * pin coordinates yet; `addressLat` / `addressLon` are OPTIONAL extensions read
 * when present. A future platform migration that adds them changes nothing here.
 */
export interface OrderForDelivery extends BusinessOrder {
  addressLat?: number | null;
  addressLon?: number | null;
}

/**
 * One of the caller's own orders, or null.
 *
 * Scoped by the verified customer id, so a caller cannot request delivery of
 * another customer's order by naming its id.
 */
export function orderForCustomer(orderId: string, customerId: string): OrderForDelivery | null {
  const order = allBusinessOrders().find((entry) => entry.id === orderId) as OrderForDelivery | undefined;
  if (!order) return null;
  return order.customerId === customerId ? order : null;
}

/** A merchant's pickup point, derived from its own record. */
export interface PickupLocation {
  /**
   * NULL when the merchant has not recorded coordinates.
   *
   * Deliberately NOT 0. A zero coordinate is a REAL place - Null Island, in the
   * Gulf of Guinea - so returning it as a placeholder means the routing provider
   * will dutifully compute a 5,600 km journey from the Atlantic and quote the
   * customer fifty thousand birr for a parcel going next door. Absence has to be
   * representable as absence, or it becomes a wrong answer rather than a gap.
   */
  latitude: number | null;
  longitude: number | null;
  address: string;
  name: string;
  phone: string;
  /** True when the coordinates are usable for routing. */
  hasCoordinates: boolean;
}

/**
 * Where a merchant's parcels are collected from.
 *
 * The platform's `Business` has a `location` string but no coordinates yet. So
 * this returns the location TEXT and NULL coordinates, and the caller falls back
 * to a documented nominal distance and TELLS THE CUSTOMER the figure is an
 * estimate.
 *
 * THE ALTERNATIVE, AND WHY IT IS WORSE: writing a placeholder coordinate and
 * routing from it. That is what produced a real bug during development - a 5,627
 * km quote for a 2 km delivery - and it is worse than having no number at all,
 * because it is a number the customer cannot tell is wrong.
 */
export function merchantLocation(businessId: string): PickupLocation {
  const business: Business | undefined = allBusinesses().find((entry) => entry.id === businessId);
  const address = business?.customization.contact.address || business?.location || "";

  // Read coordinates if a future migration adds them. Absent today, and the
  // optional chaining means that is a null rather than a crash.
  const raw = business as unknown as { deliveryLatitude?: unknown; deliveryLongitude?: unknown } | undefined;
  const latitude = Number(raw?.deliveryLatitude);
  const longitude = Number(raw?.deliveryLongitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

  return {
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    address,
    name: business?.name ?? "The merchant",
    phone: business?.customization.contact.phone ?? "",
    hasCoordinates,
  };
}

/**
 * The distance to assume when the pickup pin is unknown.
 *
 * A zero-distance delivery priced at the minimum fee is a FREE delivery, and
 * that is not something the pricing engine should be able to produce by
 * accident. 4 km is a short urban hop: it prices a parcel honestly rather than
 * free, and an operator overrides it with real coordinates as soon as the
 * merchant records them.
 */
export const NOMINAL_PICKUP_DISTANCE_KM = 4;

/**
 * A distance and duration to quote with when there is no route.
 *
 * Reported alongside `isEstimate` so the customer is told the figure is nominal
 * rather than measured.
 */
export function estimateDistanceAndDuration(
  vehicle: VehicleSpec,
  straightLineKm = 0,
): { distanceKm: number; durationSec: number } {
  const distanceKm =
    straightLineKm > 0 ? straightLineKm * ROAD_DETOUR_FACTOR : NOMINAL_PICKUP_DISTANCE_KM;
  return {
    distanceKm,
    durationSec: estimateDurationSec(distanceKm, vehicle.averageSpeedKph),
  };
}
/** Straight-line km between two known points, for a display-only figure. */
export function straightLineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const km = haversineKm(a, b);
  return Number.isFinite(km) ? Math.round(km * 100) / 100 : 0;
}
