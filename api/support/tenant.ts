import type { LiveThread } from "./chatStore";
import type { SupportTicket } from "./types";
import type { SupportIdentity } from "./types";

/**
 * ============================================================================
 *  TENANT ISOLATION
 * ============================================================================
 *
 *  Yene-Store is multi-tenant, and the specification is explicit about what a
 *  business must never reach: another business's customers, orders, tickets,
 *  conversations or analytics.
 *
 *  WHAT EXISTED BEFORE THIS FILE
 *  ----------------------------
 *  Ownership checks compared `ticket.userId` and `thread.customerUserId` to
 *  `identity.userId`. That is a USER check, not a BUSINESS check, and it is
 *  not the same guarantee:
 *
 *    - an employee of business A and the owner of business A are different
 *      users, so a business could not see its own team's tickets;
 *    - nothing tied a record to a business at all, so "is this record mine?"
 *      could only ever be answered per-person.
 *
 *  A tenant boundary has to be answerable per BUSINESS, because the business is
 *  the unit the specification names. This module adds that, and states the
 *  rule once so a new endpoint cannot get it subtly wrong.
 *
 *  THE RULE
 *  --------
 *  A caller may reach a record when EITHER:
 *    (a) the record belongs to their own business, OR
 *    (b) they are the individual who created it (a shopper with no business).
 *
 *  Everything else is refused. There is no third case, and no "unless flagged"
 *  escape hatch - an isolation exception is how cross-tenant leaks happen.
 */

export type IsolationRefusal =
  | "not-authenticated"
  | "different-business"
  | "different-user";

export interface IsolationResult {
  allowed: boolean;
  reason: IsolationRefusal | null;
}

/** The business a record belongs to, or null when it is not tenant-scoped. */
function recordBusinessId(record: { businessId?: string | null }): string | null {
  return record.businessId ?? null;
}

/**
 * May this caller reach a record belonging to `businessId`?
 *
 * `businessId` of null means the record is not tied to a business (a guest
 * ticket, a shopper's thread), in which case the per-user rule applies.
 */
export function canAccessBusiness(
  identity: SupportIdentity,
  businessId: string | null,
): IsolationResult {
  if (!identity.isAuthenticated) {
    return { allowed: false, reason: "not-authenticated" };
  }

  if (businessId === null) {
    // Not tenant-scoped: only the individual may read it.
    return { allowed: true, reason: null };
  }

  if (identity.businessId === null) {
    // A shopper (no business) has no claim on a business's records.
    return { allowed: false, reason: "different-business" };
  }

  return identity.businessId === businessId
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "different-business" };
}

/** The caller's own business, for filtering list endpoints. */
export function callerBusinessId(identity: SupportIdentity): string | null {
  return identity.isAuthenticated ? identity.businessId : null;
}

/** May this caller open this ticket? */
export function canAccessTicket(
  identity: SupportIdentity,
  ticket: SupportTicket,
): IsolationResult {
  if (!identity.isAuthenticated) {
    return { allowed: false, reason: "not-authenticated" };
  }

  // Preferred check: same business.
  if (ticket.businessId !== undefined && ticket.businessId !== null) {
    return canAccessBusiness(identity, ticket.businessId);
  }

  // Legacy records written before businessId existed. Fall back to the user
  // check so old data is neither orphaned nor over-shared.
  return ticket.userId === identity.userId
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "different-user" };
}

/** May this caller read or post to this live thread? */
export function canAccessThread(
  identity: SupportIdentity,
  thread: LiveThread,
): IsolationResult {
  if (!identity.isAuthenticated) {
    return { allowed: false, reason: "not-authenticated" };
  }

  if (thread.businessId !== null) {
    return canAccessBusiness(identity, thread.businessId);
  }

  return thread.customerUserId === identity.userId
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "different-user" };
}

/**
 * Tickets belonging to the caller's business, for a list endpoint.
 *
 * A caller with no business (a shopper) sees only their own tickets, so a
 * list route that forgets to filter still cannot leak across tenants.
 */
export function tenantTickets(
  identity: SupportIdentity,
  tickets: SupportTicket[],
): SupportTicket[] {
  if (!identity.isAuthenticated) return [];
  return tickets.filter((ticket) => canAccessTicket(identity, ticket).allowed);
}

/** Threads belonging to the caller's business. */
export function tenantThreads(
  identity: SupportIdentity,
  threads: LiveThread[],
): LiveThread[] {
  if (!identity.isAuthenticated) return [];
  return threads.filter((thread) => canAccessThread(identity, thread).allowed);
}

/**
 * The wording a customer sees when a record is not theirs.
 *
 * Deliberately identical for "wrong business" and "wrong user". Telling a
 * caller that a ticket exists but belongs to someone else is itself a small
 * leak - it confirms the id is real - so every refusal reads the same.
 */
export const ISOLATION_NOT_FOUND_MESSAGE = "Not found.";

export { recordBusinessId };
