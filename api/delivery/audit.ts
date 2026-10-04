/**
 * ============================================================================
 *  DELIVERY AUDIT LOG
 * ============================================================================
 *
 *  Four actions in this system can be abused and none of them leaves a trace in
 *  the data itself:
 *
 *    * approving a driver who should not have been approved
 *    * suspending or blocking one to get them out of the way
 *    * reassigning or cancelling somebody's job
 *    * changing a price after a customer was quoted it
 *
 *  So each of them writes a row naming WHO, WHEN, and WHAT changed. "Why is this
 *  driver suspended" has to be answerable a month later from a record rather
 *  than from somebody's memory.
 *
 *  IT IS A SEPARATE FILE
 *  ---------------------
 *  The audit is append-only and deliberately not part of any business collection,
 *  so it cannot be edited by the same code path that made the change it records.
 */

import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

/** The actions worth recording. Anything not listed is not audited. */
export type DeliveryAuditAction =
  | "driver.approved"
  | "driver.rejected"
  | "driver.suspended"
  | "driver.blocked"
  | "driver.reinstated"
  | "delivery.reassigned"
  | "delivery.cancelled"
  | "delivery.status_changed"
  | "pricing.updated"
  | "vehicle.updated"
  | "zone.updated";

export interface DeliveryAuditRow {
  id: string;
  at: string;
  action: DeliveryAuditAction;
  /** The administrator's user id. Never a name they typed. */
  actorId: string;
  actorName: string;
  /** What was acted on: a driver id, a delivery id, or "pricing". */
  subjectId: string;
  /** A sentence an administrator can read a month later. */
  reason: string;
  /** The before/after values, for a price or a status. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const audit = createJsonCollection<DeliveryAuditRow>(
  path.join(dataDir, "delivery-audit.json"),
  "delivery-audit",
  // A long tail: an audit log that silently drops its oldest entries is not an
  // audit log, and delivery disputes surface months after the event.
  100_000,
);

export const allDeliveryAuditRows = audit.all;
export const persistDeliveryAudit = audit.touch;
export const flushDeliveryAudit = audit.flush;

/**
 * Record one action.
 *
 * Returns the row so a caller can log its id. Never throws: an audit failure
 * must not roll back the administrative decision that was actually made - the
 * action stands and the gap is visible, which is the honest outcome.
 */
export function auditDeliveryAction(input: {
  action: DeliveryAuditAction;
  actorId: string;
  actorName: string;
  subjectId: string;
  reason: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): DeliveryAuditRow {
  const row: DeliveryAuditRow = {
    id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    action: input.action,
    actorId: input.actorId,
    actorName: input.actorName,
    subjectId: input.subjectId,
    reason: (input.reason ?? "").slice(0, 500),
    before: input.before ?? null,
    after: input.after ?? null,
  };
  try {
    audit.all().push(row);
    audit.touch();
  } catch (error) {
    console.error("[delivery-audit] could not record an action:", error);
  }
  return row;
}

/** Recent entries, newest first. */
export function recentAudit(limit = 100): DeliveryAuditRow[] {
  return audit
    .all()
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Every entry about one subject: a driver's whole history, or one delivery's. */
export function auditForSubject(subjectId: string): DeliveryAuditRow[] {
  return audit.all().filter((row) => row.subjectId === subjectId);
}
