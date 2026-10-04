/**
 * ============================================================================
 *  DELIVERY STATUS MACHINE
 * ============================================================================
 *
 *  WHY THIS IS A TABLE AND NOT AN `if`
 *  ----------------------------------
 *  "A delivery cannot be completed before pickup" is not a rule any single
 *  handler can be trusted to remember. There are nine write paths (accept,
 *  arrive, pick up, start, arrive-at-destination, complete, cancel, fail,
 *  admin reassign) and a tenth added later will be the one that forgets. So the
 *  legal moves live in ONE table, and `applyTransition` is the only way a
 *  status ever changes.
 *
 *  THREE THINGS ARE ENFORCED HERE, NOT BY THE CALLER
 *  --------------------------------------------------
 *  1. LEGALITY - `DRIVER_ASSIGNED -> IN_TRANSIT` is absent from the table, so no
 *     code path can skip the pickup.
 *  2. ACTOR   - each edge names the roles allowed to traverse it. A customer
 *     cannot move a delivery to ORDER_PICKED_UP with a valid session, because
 *     "customer" is absent from that edge's audience.
 *  3. ONCE    - a terminal status has an empty outgoing list, so a replayed
 *     request cannot resurrect it.
 */

import type { DeliveryActor, DeliveryStatus } from "./types";

/** Which participant kinds may perform an edge. */
export type ActorKind = DeliveryActor["kind"];

/**
 * The lifecycle, as legal transitions.
 *
 * ORDER_PICKED_UP -> RETURNED rather than CANCELLED is deliberate: once the
 * parcel has left the merchant, stopping is a RETURN of goods, not a cancelled
 * order, and the two are reported separately in analytics.
 */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  REQUESTED: ["SEARCHING_DRIVER", "CANCELLED", "FAILED"],
  SEARCHING_DRIVER: ["DRIVER_ASSIGNED", "CANCELLED", "FAILED"],
  DRIVER_ASSIGNED: ["DRIVER_GOING_TO_PICKUP", "CANCELLED", "FAILED"],
  DRIVER_GOING_TO_PICKUP: ["ARRIVED_AT_PICKUP", "CANCELLED", "FAILED"],
  ARRIVED_AT_PICKUP: ["ORDER_PICKED_UP", "CANCELLED", "FAILED"],
  ORDER_PICKED_UP: ["IN_TRANSIT", "RETURNED"],
  IN_TRANSIT: ["ARRIVING", "RETURNED"],
  ARRIVING: ["DELIVERED", "FAILED", "RETURNED"],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
  RETURNED: [],
};

export const TERMINAL_STATUSES: readonly DeliveryStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "FAILED",
  "RETURNED",
];

/**
 * Who may perform each edge.
 *
 * `admin` appears on every non-terminal edge because an administrator can
 * always intervene - but every such move is AUDITED with its reason, which is
 * what makes that acceptable rather than merely convenient.
 */
const EDGE_ACTORS: Record<string, ActorKind[]> = {
  // Starting a search is NOT a privileged act - it only begins dispatch, it does
  // not move the parcel or assign anybody. The customer and the merchant are
  // allowed to trigger it, because choosing the pickup point is what unblocks a
  // delivery parked in REQUESTED, and a delivery nobody else can restart is a
  // delivery that is stuck forever.
  "REQUESTED>SEARCHING_DRIVER": ["system", "admin", "customer", "merchant"],
  "REQUESTED>CANCELLED": ["customer", "merchant", "admin"],
  "REQUESTED>FAILED": ["system", "admin"],
  "SEARCHING_DRIVER>DRIVER_ASSIGNED": ["driver", "system", "admin"],
  "SEARCHING_DRIVER>CANCELLED": ["customer", "merchant", "admin"],
  "SEARCHING_DRIVER>FAILED": ["system", "admin"],
  "DRIVER_ASSIGNED>DRIVER_GOING_TO_PICKUP": ["driver", "admin"],
  "DRIVER_ASSIGNED>CANCELLED": ["customer", "merchant", "admin"],
  "DRIVER_ASSIGNED>FAILED": ["system", "admin"],
  "DRIVER_GOING_TO_PICKUP>ARRIVED_AT_PICKUP": ["driver", "admin"],
  "DRIVER_GOING_TO_PICKUP>CANCELLED": ["merchant", "admin"],
  "DRIVER_GOING_TO_PICKUP>FAILED": ["driver", "admin"],
  "ARRIVED_AT_PICKUP>ORDER_PICKED_UP": ["driver", "admin"],
  "ARRIVED_AT_PICKUP>CANCELLED": ["merchant", "admin"],
  "ARRIVED_AT_PICKUP>FAILED": ["driver", "admin"],
  "ORDER_PICKED_UP>IN_TRANSIT": ["driver", "admin"],
  "ORDER_PICKED_UP>RETURNED": ["driver", "admin"],
  "IN_TRANSIT>ARRIVING": ["driver", "admin"],
  "IN_TRANSIT>RETURNED": ["driver", "admin"],
  "ARRIVING>DELIVERED": ["driver", "customer", "admin"],
  "ARRIVING>FAILED": ["driver", "admin"],
  "ARRIVING>RETURNED": ["driver", "admin"],
};

export function edgeKey(from: DeliveryStatus, to: DeliveryStatus): string {
  return `${from}>${to}`;
}

/** Is this move legal at all? Ignores who is asking. */
export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return (DELIVERY_TRANSITIONS[from] ?? []).includes(to);
}

/** Is this move legal for THIS participant? */
export function canActorTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: ActorKind,
): boolean {
  if (!canTransition(from, to)) return false;
  return (EDGE_ACTORS[edgeKey(from, to)] ?? []).includes(actor);
}

export function isTerminal(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A status a customer is still waiting on. Drives every "active" filter. */
export function isActive(status: DeliveryStatus): boolean {
  return !isTerminal(status);
}

/**
 * Why a move was refused, in words a human can act on.
 *
 * Returns null when the move IS allowed, so a caller cannot mistake "no
 * reason given" for permission.
 */
export function transitionRefusal(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: ActorKind,
): string | null {
  if (isTerminal(from)) {
    return `This delivery is already ${label(from).toLowerCase()} and cannot be changed.`;
  }
  if (!canTransition(from, to)) {
    const allowed = DELIVERY_TRANSITIONS[from] ?? [];
    const hint = allowed.length ? ` From here it can move to: ${allowed.map(label).join(", ").toLowerCase()}.` : "";
    return `A delivery cannot go from "${label(from)}" to "${label(to)}".${hint}`;
  }
  if (!(EDGE_ACTORS[edgeKey(from, to)] ?? []).includes(actor)) {
    return "You are not allowed to make that change to this delivery.";
  }
  return null;
}

/** Short human labels. Used in every UI and in every notification body. */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  REQUESTED: "Delivery requested",
  SEARCHING_DRIVER: "Finding a delivery person",
  DRIVER_ASSIGNED: "Driver assigned",
  DRIVER_GOING_TO_PICKUP: "Going to pickup",
  ARRIVED_AT_PICKUP: "Arrived at pickup",
  ORDER_PICKED_UP: "Order picked up",
  IN_TRANSIT: "On the way",
  ARRIVING: "Arriving",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  RETURNED: "Returned",
};

export function label(status: DeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status] ?? status;
}

/**
 * The customer-facing progress steps.
 *
 * Six, not twelve. A customer is not tracking an internal state machine, they
 * are watching a parcel move, and `ARRIVING` is included because "your driver
 * is nearly there" is the single most useful message in the whole flow.
 */
export const CUSTOMER_PROGRESS_STEPS: DeliveryStatus[] = [
  "REQUESTED",
  "DRIVER_ASSIGNED",
  "ORDER_PICKED_UP",
  "IN_TRANSIT",
  "ARRIVING",
  "DELIVERED",
];

/** Index of a status in the customer progress, or -1 when it is off the path. */
export function progressIndex(status: DeliveryStatus): number {
  return CUSTOMER_PROGRESS_STEPS.indexOf(status);
}

/**
 * The next status a DRIVER should be offered, given where the delivery is.
 *
 * Returning ONE option rather than a list is what keeps the driver screen from
 * becoming a menu of every legal move - and it means an illegal move has no
 * button to press in the first place.
 */
export function nextDriverAction(status: DeliveryStatus): {
  to: DeliveryStatus;
  label: string;
} | null {
  switch (status) {
    case "DRIVER_ASSIGNED":
      return { to: "DRIVER_GOING_TO_PICKUP", label: "Start travelling to pickup" };
    case "DRIVER_GOING_TO_PICKUP":
      return { to: "ARRIVED_AT_PICKUP", label: "I have arrived at pickup" };
    case "ARRIVED_AT_PICKUP":
      return { to: "ORDER_PICKED_UP", label: "Confirm pickup" };
    case "ORDER_PICKED_UP":
      return { to: "IN_TRANSIT", label: "Start delivery" };
    case "IN_TRANSIT":
      return { to: "ARRIVING", label: "I am arriving" };
    case "ARRIVING":
      return { to: "DELIVERED", label: "Complete delivery" };
    default:
      return null;
  }
}