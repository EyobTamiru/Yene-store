import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createJsonCollection, type JsonCollection } from "../lib/jsonCollection";
import { redactCustomerText } from "./privacy";
import type { SupportRoleName } from "./roles";

/**
 * ============================================================================
 *  SUPPORT AUDIT LOG
 * ============================================================================
 *
 *  Section 8 requires a record of important support actions. Without one, "was
 *  this customer told something they should not have been told?" is unanswerable
 *  after the fact, which is the single question an audit log exists to answer.
 *
 *  WHAT IS RECORDED
 *  ----------------
 *  Exactly the actions the specification lists, and nothing else:
 *
 *    ticket.created        ticket.assigned       ticket.updated
 *    agent.response        ticket.resolved       ticket.reopened
 *    knowledge.changed     permission.changed
 *
 *  WHAT IS NEVER RECORDED
 *  ----------------------
 *  Request bodies, tokens, API keys, passwords, note text, conversation
 *  content, or any other value the log does not need to answer "who did what,
 *  when, and to what". A log that stored the payloads would become a second
 *  copy of the data it exists to protect. `summarise` is the only way to
 *  attach a description, and it is capped and redacted.
 *
 *  TAMPER EVIDENCE
 *  ---------------
 *  Each entry stores the SHA-256 of (previous entry's hash + this entry's
 *  fields). Editing or removing an entry therefore invalidates every hash after
 *  it, and `verifyChain()` reports exactly where the break is.
 *
 *  This is deliberately NOT presented as a security control against an attacker
 *  who already has write access to the data directory - such an attacker could
 *  recompute the whole chain. It is a control against the far more likely case:
 *  a well-meaning operator editing history by hand, or a bug corrupting a
 *  record. For tamper resistance against a host-level attacker you need an
 *  append-only external sink, which is noted as the production TODO.
 *
 *  IDENTITY IS LOGGED, CUSTOMER DATA IS NOT
 *  ---------------------------------------
 *  An audit log must name the staff member who did something - that is its
 *  whole purpose - so `actor` is recorded. Customer contact details are never
 *  needed to answer "who did what", so they are not.
 */

/** The action types the specification requires. */
export const AUDIT_ACTIONS = [
  "ticket.created",
  "ticket.assigned",
  "ticket.updated",
  "agent.response",
  "ticket.resolved",
  "ticket.reopened",
  "knowledge.changed",
  "permission.changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Human labels for the audit UI. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "ticket.created": "Ticket created",
  "ticket.assigned": "Ticket assigned",
  "ticket.updated": "Ticket updated",
  "agent.response": "Agent response",
  "ticket.resolved": "Ticket resolved",
  "ticket.reopened": "Ticket reopened",
  "knowledge.changed": "Knowledge article changed",
  "permission.changed": "Permission changed",
};

export type AuditOutcome = "allowed" | "denied";

export interface AuditEntry {
  id: string;
  at: string;
  action: AuditAction;
  /** Display name of whoever performed it. "system" for automated actions. */
  actor: string;
  /** Staff id, when the actor was authenticated support staff. */
  actorId: string | null;
  /** Staff role, so a role change can be audited in context. */
  actorRole: SupportRoleName | null;
  /** "customer", "ai", "system" or "staff". */
  actorKind: "customer" | "ai" | "system" | "staff";
  outcome: AuditOutcome;
  /** The object acted upon, e.g. a ticket id or article id. Never a secret. */
  target: string;
  /** Short, redacted description. Never a payload. */
  detail: string;
  /** The business the action touched, for tenant-scoped review. */
  businessId: string | null;
  /** Hash of the previous entry plus this one. See the file header. */
  hash: string;
}

/**
 * Where the log is written.
 *
 * `YENE_DATA_DIR` is honoured so the verification suites - which set it to a
 * temporary directory - never write into real reporting data. `YENE_AUDIT_FILE`
 * overrides it entirely for a test that wants to assert on the path itself.
 */
function auditFile(): string {
  if (process.env.YENE_AUDIT_FILE) return path.resolve(process.env.YENE_AUDIT_FILE);
  const dir = process.env.YENE_DATA_DIR
    ? path.resolve(process.env.YENE_DATA_DIR)
    : path.resolve(process.cwd(), "data");
  return path.join(dir, "support-audit.json");
}

// Resolved lazily rather than at import time, so a test that sets the variable
// before calling into the store is honoured even though the module was already
// loaded.
let store: JsonCollection<AuditEntry> | null = null;

function auditStore(): JsonCollection<AuditEntry> {
  store ??= createJsonCollection<AuditEntry>(auditFile(), "audit-log", 50_000);
  return store;
}

const persist = (): void => { auditStore().touch(); };

/** Longest description retained. The log answers "what", not "why at length". */
const MAX_DETAIL = 200;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The fields that are hashed, in a fixed order.
 *
 * `JSON.stringify` over an explicitly ordered object, so the hash cannot depend
 * on key insertion order.
 */
function digest(previousHash: string, entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(
      [
        previousHash,
        entry.id,
        entry.at,
        entry.action,
        entry.actor,
        entry.actorId ?? "",
        entry.actorRole ?? "",
        entry.actorKind,
        entry.outcome,
        entry.target,
        entry.detail,
        entry.businessId ?? "",
      ].join("|"),
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface AuditInput {
  action: AuditAction;
  actor: string;
  actorId?: string | null;
  actorRole?: SupportRoleName | null;
  actorKind?: AuditEntry["actorKind"];
  outcome?: AuditOutcome;
  /** Ticket id, article id, staff id... never a secret or a payload. */
  target: string;
  detail?: string;
  businessId?: string | null;
}

/**
 * Append one entry.
 *
 * Never throws. An audit failure must not be able to fail the action that was
 * being audited - a support agent must still be able to resolve a ticket
 * because the log had a bad day. The failure is printed loudly instead, because
 * a silently missing audit entry is worse than a loud one.
 */
export function recordAudit(input: AuditInput): AuditEntry | null {
  try {
    const list = auditStore().all();
    const previousHash = list.length ? list[list.length - 1].hash : "GENESIS";

    const base: Omit<AuditEntry, "hash"> = {
      id: randomBytes(8).toString("hex"),
      at: nowIso(),
      action: input.action,
      actor: (input.actor || "unknown").slice(0, 80),
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      actorKind: input.actorKind ?? "staff",
      outcome: input.outcome ?? "allowed",
      // Targets are ids, not free text, so they are bounded but not redacted.
      target: (input.target || "unknown").slice(0, 120),
      // Detail is human-written, so it goes through the same redaction as any
      // other customer-derived text before it is stored.
      detail: redactCustomerText(input.detail ?? "", MAX_DETAIL),
      businessId: input.businessId ?? null,
    };

    const entry: AuditEntry = { ...base, hash: digest(previousHash, base) };
    list.push(entry);
    persist();
    return entry;
  } catch (error) {
    console.error("[audit] could not record entry:", error);
    return null;
  }
}

/** Record a denied action. Denials matter as much as successes. */
export function recordDenied(input: Omit<AuditInput, "outcome">): AuditEntry | null {
  return recordAudit({ ...input, outcome: "denied" });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface AuditQuery {
  action?: AuditAction;
  actor?: string;
  target?: string;
  businessId?: string;
  /** ISO timestamp; only entries at or after this are returned. */
  since?: string;
  limit?: number;
  page?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Query the log, newest first.
 *
 * Deliberately returns whole entries and no aggregate: an audit view is a
 * record of specific events, and a summary would be a different product.
 */
export function queryAudit(query: AuditQuery = {}): AuditQueryResult {
  const { action, actor, target, businessId, since, limit = 50, page = 1 } = query;

  let entries = [...auditStore().all()].reverse();

  if (action) entries = entries.filter((entry) => entry.action === action);
  if (actor) {
    const needle = actor.toLowerCase();
    entries = entries.filter((entry) => entry.actor.toLowerCase().includes(needle));
  }
  if (target) {
    const needle = target.toLowerCase();
    entries = entries.filter((entry) => entry.target.toLowerCase().includes(needle));
  }
  if (businessId) entries = entries.filter((entry) => entry.businessId === businessId);
  if (since) {
    const cutoff = new Date(since).getTime();
    if (!Number.isNaN(cutoff)) {
      entries = entries.filter((entry) => new Date(entry.at).getTime() >= cutoff);
    }
  }

  const total = entries.length;
  const safeSize = Math.min(Math.max(limit, 1), 200);
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * safeSize;

  return {
    entries: entries.slice(start, start + safeSize),
    total,
    page: safePage,
    pageCount,
  };
}

export function allAuditEntries(): AuditEntry[] {
  return auditStore().all();
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

export interface ChainVerification {
  ok: boolean;
  entries: number;
  /** Index of the first entry that does not match, when not ok. */
  brokenAt: number | null;
  reason: string | null;
}

/**
 * Walk the chain and recompute every hash.
 *
 * Returns the index of the first entry that fails, so a break points at a
 * specific moment rather than merely reporting that the log is untrustworthy.
 */
export function verifyChain(): ChainVerification {
  const entries = auditStore().all();
  let previousHash = "GENESIS";

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const { hash, ...base } = entry;

    if (digest(previousHash, base) !== hash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: index,
        reason: `Entry ${index} (${entry.id}) does not match its recorded hash.`,
      };
    }
    previousHash = hash;
  }

  return { ok: true, entries: entries.length, brokenAt: null, reason: null };
}

/** Test support: empty the log. */
export function clearAudit(): void {
  auditStore().all().length = 0;
  store.flush();
}

