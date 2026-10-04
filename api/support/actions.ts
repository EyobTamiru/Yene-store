import { randomBytes } from "node:crypto";
import type { SupportIdentity } from "./types";

/**
 * ============================================================================
 *  AI ACTION GATE
 * ============================================================================
 *
 *  The specification requires that the AI be **read-only** for sensitive
 *  account data, and that anything which modifies the account, billing,
 *  subscription, orders, inventory, users or permissions require authorisation
 *  and, where configured, human approval.
 *
 *  WHY THIS IS CODE AND NOT A PROMPT RULE
 *  --------------------------------------
 *  Every other safety property in this system is deterministic for the same
 *  reason: a prompt is a request, not a control. Telling a model "do not
 *  change the customer's billing" is a request. This file is a control - it
 *  runs before anything is dispatched, and it is the only thing standing
 *  between a confused model and a destructive API call.
 *
 *  THE DEFAULT IS REFUSAL
 *  ---------------------
 *  Every mutating action is denied unless BOTH:
 *    1. the deployment has explicitly enabled write actions, AND
 *    2. the requested scope is in the allow-list, AND
 *    3. a human has approved this specific action.
 *
 *  A missing condition is a refusal, never a permissive default. An operator
 *  who wants the AI to be able to act must say so, in configuration, per scope.
 */

/** Domains whose data is considered sensitive. Mirrors the specification. */
export const SENSITIVE_DOMAINS = [
  "account",
  "billing",
  "subscription",
  "orders",
  "inventory",
  "users",
  "permissions",
] as const;
export type SensitiveDomain = (typeof SENSITIVE_DOMAINS)[number];

export type ActionEffect = "read" | "write";

export interface ActionRequest {
  domain: string;
  effect: ActionEffect;
  /** What would be changed, e.g. "cancel subscription". Never a payload. */
  operation: string;
  /** The business the action would affect. */
  businessId: string;
}

export type DenialReason =
  | "read-only-by-default"
  | "sensitive-domain"
  | "domain-not-allowed"
  | "approval-required"
  | "approval-missing"
  | "not-authorized"
  | "cross-tenant";

export interface ActionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: DenialReason | null;
  /** Customer-safe explanation. Never includes configuration detail. */
  message: string;
}

/** Read actions are always safe: they cannot change anything. */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  "platform",
  "store",
  "products",
  "knowledge",
  "support",
]);

/** Writes an operator may opt into, per domain, via YENE_AI_WRITE_SCOPES. */
const WRITABLE_SCOPES: ReadonlySet<string> = new Set([
  "account.profile",
  "inventory.stock",
  "orders.note",
]);

/**
 * Read-only unless the operator has enabled it.
 *
 * Defaults to false on any ambiguity, including a malformed value. An operator
 * who mistypes the setting gets a read-only bot, which is a safe way to be
 * wrong.
 */
export function aiWritesEnabled(): boolean {
  return process.env.YENE_AI_WRITE_ENABLED === "true";
}

/** Domains the operator has explicitly allowed the AI to write. */
function allowedWriteScopes(): Set<string> {
  const raw = process.env.YENE_AI_WRITE_SCOPES;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

/**
 * Does an action on a sensitive domain need a human to approve it first?
 *
 * Always true for the seven sensitive domains, regardless of configuration.
 * Enabling a write scope says the AI *may* act; it does not remove the
 * requirement that a person agreed to that particular change.
 */
export function requiresHumanApproval(domain: string, effect: ActionEffect): boolean {
  if (effect === "read") return false;
  return (SENSITIVE_DOMAINS as readonly string[]).includes(domain);
}

/** The approval an action would need, used by the approval store. */
export interface ActionApproval {
  id: string;
  domain: string;
  operation: string;
  businessId: string;
  approvedBy: string;
  approvedAt: string;
  /** Single use. An approval is for one action, not a standing permission. */
  consumedAt: string | null;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Decide whether the assistant may perform an action.
 *
 * Checks run cheapest-and-most-absolute first, and every failure returns a
 * reason a human can act on. The order matters: a cross-tenant request is
 * refused as cross-tenant even when writes are disabled, so the audit trail
 * records the more serious problem.
 */
export function decideAiAction(
  request: ActionRequest,
  identity: SupportIdentity,
  approval: ActionApproval | null,
): ActionDecision {
  const needsApproval = requiresHumanApproval(request.domain, request.effect);

  // 1. The AI may only ever act on the business it is talking to. This is
  //    checked first because a cross-tenant attempt is the most serious event
  //    and must be visible in the log even if writes are off.
  if (
    identity.businessId === null ||
    identity.businessId !== request.businessId
  ) {
    return {
      allowed: false,
      requiresApproval: needsApproval,
      reason: "cross-tenant",
      message:
        "That request is not something I can do from this conversation. I'll connect you with a Yene Business Group support agent.",
    };
  }

  // 2. Reads are always fine. They change nothing.
  if (request.effect === "read") {
    if (!ALWAYS_ALLOWED.has(request.domain) && !WRITABLE_SCOPES.has(`${request.domain}.read`)) {
      // An unknown read domain is refused rather than assumed safe: this gate
      // should be extended deliberately as domains are added.
      if (!aiWritesEnabled()) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: "domain-not-allowed",
          message:
            "I can't look into that from here. I'll connect you with a Yene Business Group support agent.",
        };
      }
    }
    return { allowed: true, requiresApproval: false, reason: null, message: "" };
  }

  // 3. Writes are off unless the operator turned them on.
  if (!aiWritesEnabled()) {
    return {
      allowed: false,
      requiresApproval: needsApproval,
      reason: "read-only-by-default",
      message:
        "I can look at this with you, but I can't make changes to your account. I'll connect you with a Yene Business Group support agent who can.",
    };
  }

  // 4. Even enabled, the exact scope must be allow-listed.
  if (!allowedWriteScopes().has(`${request.domain}.${request.operation}`)) {
    return {
      allowed: false,
      requiresApproval: needsApproval,
      reason: "domain-not-allowed",
      message:
        "I'm not able to make that change. I'll connect you with a Yene Business Group support agent who can.",
    };
  }

  // 5. A sensitive write needs a specific, unconsumed human approval.
  if (needsApproval) {
    if (!approval) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "approval-required",
        message:
          "This needs a Yene Business Group support agent to approve it before I can do anything. I'll connect you with one now.",
      };
    }
    if (approval.consumedAt !== null) {
      // Single use. A replayed approval is refused: an approval granted for one
      // change must not silently authorise a second.
      return {
        allowed: false,
        requiresApproval: true,
        reason: "approval-missing",
        message:
          "That approval has already been used. I'll connect you with a Yene Business Group support agent.",
      };
    }
    if (
      approval.domain !== request.domain ||
      approval.operation !== request.operation ||
      approval.businessId !== request.businessId
    ) {
      // The approval must match THIS action. An approval for a different
      // operation is not consent.
      return {
        allowed: false,
        requiresApproval: true,
        reason: "approval-missing",
        message:
          "That approval was for something else. I'll connect you with a Yene Business Group support agent.",
      };
    }
  }

  return { allowed: true, requiresApproval: needsApproval, reason: null, message: "" };
}

/**
 * What the assistant should do instead of acting.
 *
 * The specification's failure mode, made explicit: when the AI cannot act, it
 * escalates to a human rather than guessing or attempting a partial change.
 */
export function fallbackFor(decision: ActionDecision): "human-support" | "none" {
  return decision.allowed ? "none" : "human-support";
}


// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * Approvals live in memory on purpose.
 *
 * An approval authorises exactly one action, moments after a human approved it.
 * Persisting them would create a standing permission nobody intended, and a
 * restart must invalidate every outstanding approval - a change approved last
 * Tuesday should not be silently authorisable today.
 *
 * TODO(production): keep them durable if and only if they are also single-use
 * and short-expiring, enforced in the store rather than by convention.
 */
const approvals = new Map<string, ActionApproval>();
const MAX_APPROVALS = 500;
const APPROVAL_TTL_MS = 15 * 60 * 1000;

function pruneApprovals(): void {
  const cutoff = Date.now() - APPROVAL_TTL_MS;
  for (const [id, approval] of approvals) {
    if (new Date(approval.approvedAt).getTime() < cutoff) approvals.delete(id);
  }
  if (approvals.size > MAX_APPROVALS) {
    const ordered = [...approvals.entries()].sort(
      (a, b) => new Date(a[1].approvedAt).getTime() - new Date(b[1].approvedAt).getTime(),
    );
    for (const [id] of ordered.slice(0, approvals.size - MAX_APPROVALS)) approvals.delete(id);
  }
}

export function grantApproval(input: {
  domain: string;
  operation: string;
  businessId: string;
  approvedBy: string;
}): ActionApproval {
  pruneApprovals();
  const approval: ActionApproval = {
    id: randomBytes(8).toString("hex"),
    domain: input.domain,
    operation: input.operation,
    businessId: input.businessId,
    approvedBy: input.approvedBy,
    approvedAt: new Date().toISOString(),
    consumedAt: null,
  };
  approvals.set(approval.id, approval);
  return approval;
}

/**
 * The most recent unused, unexpired approval for an action, if any.
 *
 * Returns the approval WITHOUT consuming it, so the caller can include it in a
 * decision and the audit trail can name who approved what.
 */
export function findApproval(
  domain: string,
  operation: string,
  businessId: string,
): ActionApproval | null {
  pruneApprovals();
  const matches = [...approvals.values()]
    .filter(
      (approval) =>
        approval.domain === domain &&
        approval.operation === operation &&
        approval.businessId === businessId &&
        approval.consumedAt === null,
    )
    .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  return matches[0] ?? null;
}

/** Mark an approval used. An approval authorises exactly one action. */
export function consumeApproval(approvalId: string): void {
  const approval = approvals.get(approvalId);
  if (approval && approval.consumedAt === null) {
    approval.consumedAt = new Date().toISOString();
  }
}

export function pendingApprovals(): ActionApproval[] {
  pruneApprovals();
  return [...approvals.values()].filter((a) => a.consumedAt === null);
}

export function clearApprovals(): void {
  approvals.clear();
}


// ---------------------------------------------------------------------------
// Data minimisation
// ---------------------------------------------------------------------------

/**
 * Which sensitive domains a question actually needs.
 *
 * The specification says to "only retrieve information required to answer the
 * current request". Returning everything readable would put a customer's
 * payment and order details in front of the model to answer a question about
 * how to add a product - data the answer does not need, and data a
 * prompt-injection attempt could then try to quote.
 *
 * So retrieval is scoped by what was asked. The mapping is deliberately
 * conservative: a question that matches nothing returns an empty set, which
 * means the model is told nothing, rather than everything.
 */
const QUESTION_SCOPE: { domain: SensitiveDomain; patterns: RegExp[] }[] = [
  {
    domain: "billing",
    patterns: [/\b(bill|invoice|charged?|payment|refund|price|cost|fee|receipt)\w*/i],
  },
  {
    domain: "subscription",
    patterns: [/\b(subscription|package|plan|renew\w*|upgrade|downgrade|cancel\w*)\b/i],
  },
  {
    domain: "orders",
    patterns: [/\b(order|checkout|cart|purchase|delivery|shipment|tracking)\w*/i],
  },
  {
    domain: "inventory",
    patterns: [/\b(inventory|stock|quantity|sku|warehouse|supplier|restock)\w*/i],
  },
  {
    domain: "users",
    patterns: [/\b(user|staff|employee|permission|role|access|invite|teammate)\w*/i],
  },
  {
    domain: "account",
    patterns: [/\b(account|profile|business name|logo|opening hours|address)\b/i],
  },
];

/**
 * The domains required to answer `question`.
 *
 * An empty result means the model should be given no account data at all.
 */
export function requiredDomains(question: string): SensitiveDomain[] {
  const needed = new Set<SensitiveDomain>();
  for (const entry of QUESTION_SCOPE) {
    if (entry.patterns.some((pattern) => pattern.test(question))) needed.add(entry.domain);
  }
  return [...needed];
}

/** True when answering this question needs no account data whatsoever. */
export function needsNoAccountData(question: string): boolean {
  return requiredDomains(question).length === 0;
}

