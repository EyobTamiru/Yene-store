/**
 * ============================================================================
 *  DELIVERY AUTHORIZATION
 * ============================================================================
 *
 *  Four roles touch a delivery - customer, driver, merchant, admin - and each
 *  may read a different projection of the same record. This file is the single
 *  place that decides WHO, because four routers each re-deriving "is this person
 *  the driver" is how one of them eventually forgets.
 *
 *  THE CENTRAL RULE, INHERITED FROM THE EXISTING PLATFORM
 *  -----------------------------------------------------
 *  `businessId` and `driverId` are RESOLVED FROM THE VERIFIED SESSION, never
 *  from a request body, a query string or a header. There is no endpoint in this
 *  module that accepts a tenant or a driver id as an input.
 *
 *  Every refusal path returns "Delivery not found." rather than a 403, because a
 *  403 would confirm that somebody ELSE's delivery exists. That is the same rule
 *  api/live/router.ts applies to a customer's chat thread.
 */

import type { Request } from "express";
import { resolveAuthContext } from "../auth/sessions";
import { SESSION_COOKIE } from "../auth/types";
import type { AuthContext } from "../auth/types";
import { driverForUser } from "./store";
import type { Delivery, DriverProfile } from "../../src/delivery/types";

/** The verified caller, resolved once per request. */
export interface DeliveryCaller {
  userId: string;
  email: string;
  name: string;
  businessId: string | null;
  isSuperAdmin: boolean;
  /** The driver's own record, when this user has registered as one. */
  driver: DriverProfile | null;
}

/**
 * Resolve the caller, or null.
 *
 * Returns null for every unusable credential rather than throwing, so a route
 * can answer 401 itself and keep its own wording.
 */
export function resolveCaller(req: Request): DeliveryCaller | null {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) return null;
  return fromContext(context);
}

/** Project an auth context onto the delivery caller shape. */
export function fromContext(context: AuthContext): DeliveryCaller {
  return {
    userId: context.userId,
    email: context.email,
    name: context.name,
    businessId: context.businessId,
    isSuperAdmin: context.isSuperAdmin,
    driver: driverForUser(context.userId),
  };
}

/** Is this caller acting as a Yene administrator? */
export function isAdmin(caller: DeliveryCaller): boolean {
  return caller.isSuperAdmin;
}

/** May this caller read this delivery? Mirrors `projections.mayReadDelivery`. */
export function mayRead(delivery: Delivery, caller: DeliveryCaller): boolean {
  if (caller.isSuperAdmin) return true;
  if (caller.userId === delivery.customerId) return true;
  if (caller.businessId && caller.businessId === delivery.merchantId) return true;
  return Boolean(caller.driver && caller.driver.id === delivery.driverId);
}

/**
 * Is this caller the ASSIGNED driver?
 *
 * Matched on the driver record resolved from their own session, never on a
 * client-supplied driverId - which is what stops a driver acting on somebody
 * else's job by passing a different id.
 */
export function isAssignedDriver(delivery: Delivery, caller: DeliveryCaller): boolean {
  return Boolean(caller.driver && caller.driver.id === delivery.driverId);
}

/** Is this caller the customer who placed it? */
export function isCustomer(delivery: Delivery, caller: DeliveryCaller): boolean {
  return caller.userId === delivery.customerId;
}

/** Is this caller the merchant whose business it belongs to? */
export function isMerchant(delivery: Delivery, caller: DeliveryCaller): boolean {
  return Boolean(caller.businessId && caller.businessId === delivery.merchantId);
}

/**
 * Which projection this caller should receive.
 *
 * Returned as a discriminant rather than decided inside the router, so the same
 * delivery cannot be rendered with the merchant's redactions for a customer.
 */
export type DeliveryAudience = "customer" | "driver" | "merchant" | "admin";

export function audienceFor(delivery: Delivery, caller: DeliveryCaller): DeliveryAudience | null {
  if (caller.isSuperAdmin) return "admin";
  if (caller.userId === delivery.customerId) return "customer";
  if (caller.businessId && caller.businessId === delivery.merchantId) return "merchant";
  if (caller.driver && caller.driver.id === delivery.driverId) return "driver";
  return null;
}

/** One helper so every route writes the same 401/403 body. */
export function refuse(status: number, message: string) {
  return { status, body: { error: message } };
}
