/**
 * ============================================================================
 *  DELIVERY LABELS - the customer-facing wording
 * ============================================================================
 *
 *  Browser-safe re-export of the status vocabulary.
 *
 *  `src/delivery/status.ts` is PURE, but it is a server-side module and the
 *  frontend should not reach into it directly - the same reason the platform has
 *  its own client modules. This file exists so a UI can render a status label
 *  without importing the whole delivery domain.
 *
 *  WHY THE LABELS LIVE WITH THE STATE MACHINE
 *  -----------------------------------------
 *  A status with no human name is a status somebody has to remember the code
 *  for. The label and the edge that produces it are therefore defined together,
 *  so adding a status without a label is a compile error rather than a screen
 *  that shows "IN_TRANSIT" to a customer.
 */

export {
  CUSTOMER_PROGRESS_STEPS,
  DELIVERY_STATUS_LABELS,
  DELIVERY_TRANSITIONS,
  canTransition,
  isActive,
  isTerminal,
  label as deliveryStatusLabel,
  nextDriverAction,
  progressIndex,
} from "../delivery/status";

export { DELIVERY_STATUSES } from "../delivery/types";
export type { DeliveryStatus } from "../delivery/types";
export { VEHICLE_TYPES, isVehicleType } from "../delivery/types";
export type { VehicleType } from "../delivery/types";

/** A colour class per status, so every screen renders a status identically. */
export const DELIVERY_STATUS_TONE: Record<string, string> = {
  REQUESTED: "text-yene-faint",
  SEARCHING_DRIVER: "text-yene-info",
  DRIVER_ASSIGNED: "text-yene-info",
  DRIVER_GOING_TO_PICKUP: "text-yene-info",
  ARRIVED_AT_PICKUP: "text-yene-info",
  ORDER_PICKED_UP: "text-yene-info",
  IN_TRANSIT: "text-yene-info",
  ARRIVING: "text-yene-warn",
  DELIVERED: "text-yene-accent",
  CANCELLED: "text-yene-danger",
  FAILED: "text-yene-danger",
  RETURNED: "text-yene-danger",
};

/** Seconds to "13 min" / "1 h 20 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "in 44s" for an offer countdown. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
