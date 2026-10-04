/**
 * ============================================================================
 *  DELIVERY ROUTER MOUNT
 * ============================================================================
 *
 *  A single file that assembles the two delivery routers and mounts them, so
 *  `server.ts` gains ONE import and ONE line rather than a block of delivery
 *  wiring. That is what keeps the delivery module removable later: taking it out
 *  of Yene-Store means deleting this file and its one mount.
 *
 *  It also owns the SEARCH SWEEPER, because the interval belongs next to the
 *  routes that depend on it rather than in a global list in server.ts.
 */

import { Router, type Request, type Response } from "express";
import { deliveryAdminRouter } from "./adminRouter";
import { deliveryRouter } from "./router";
import { ensureVehicles, pricingConfig } from "./store";
import { sweepSearches } from "./service";

export { deliveryRouter as deliveryRoutes };

/** How often expired offers are re-dispatched. */
const SWEEP_INTERVAL_MS = 15_000;

/**
 * Assemble the delivery API.
 *
 * Returned as a Router so server.ts mounts it like any other module. The admin
 * routes are attached HERE rather than in the main router, which keeps
 * `deliveryAdminRouter` unable to be mounted anywhere else by accident.
 */
export function buildDeliveryApi(): Router {
  const api = Router();

  // Seeding happens here rather than at import time so the data directory is
  // created on first request rather than on module load, which keeps `npm run
  // lint` and the verification suites from writing to a real data directory.
  ensureVehicles();
  pricingConfig();

  api.use("/", deliveryRouter);
  api.use("/", deliveryAdminRouter);

  // The sweeper. Expired offers are re-dispatched on a timer, which is what
  // makes a request nobody accepts keep moving instead of stalling forever.
  //
  // `unref()` so the interval does not hold the process open on shutdown - the
  // same treatment the live hub's heartbeat gets.
  const timer = setInterval(() => {
    try {
      const result = sweepSearches();
      if (result.reDispatched > 0 || result.failed > 0) {
        console.log(
          `[delivery] search sweep: ${result.reDispatched} re-dispatched, ${result.failed} failed`,
        );
      }
    } catch (error) {
      // A sweep failure must never take the server down. The next tick retries.
      console.error("[delivery] search sweep failed:", error);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  return api;
}

/**
 * GET /api/delivery/health
 *
 * Reports what is actually configured, including the map provider - because a
 * deployment "working on estimates" is a different operational state from one
 * routing along real roads, and an operator should be able to see which.
 */
export function deliveryHealth(_req: Request, res: Response) {
  const config = pricingConfig();
  return res.status(200).json({
    ok: true,
    vehicles: ensureVehicles().length,
    proofMethod: config.proofMethod,
    commissionBps: config.commissionBps,
    currency: config.currency,
    note: "Delivery is running. See /api/delivery/admin/map for the map provider in use.",
  });
}
