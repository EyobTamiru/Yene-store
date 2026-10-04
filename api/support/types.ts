import type { QuickActionCategory } from "../../src/constants";

/** Roles the support bot understands. Controls what account data is revealed. */
export type SupportRole = "owner" | "employee" | "customer" | "unknown";

/** Identity of the caller, derived from a verified token - never from the body. */
export interface SupportIdentity {
  userId: string;
  businessId: string | null;
  displayName: string | null;
  role: SupportRole;
  isAuthenticated: boolean;
}

/**
 * Account facts the bot is allowed to read.
 *
 * Every field is optional because the backing system decides what exists.
 * Anything absent is reported as "not available" - it is NEVER guessed.
 */
export interface SupportAccountContext {
  businessName?: string;
  packageName?: string;
  subscriptionStatus?: string;
  /** Only present when the account source provides one. */
  contactEmail?: string;
  /**
   * Withheld from anyone without the `customer.phone.view` capability, and
   * never included in a customer-facing response.
   */
  contactPhone?: string;
  /** Free-text summary lines the model may quote verbatim. */
  facts: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  message: string;
  history?: ChatTurn[];
  /** Optional client hint; never used for authorization. */
  page?: "widget" | "full-page";
}

/** Shape the model is required to return. Enforced server-side afterwards. */
export interface SupportDecision {
  reply: string;
  grounded: boolean;
  needsHuman: boolean;
  category: QuickActionCategory;
  sourceIds: string[];
  needsClarification: boolean;
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/**
 * The conditions under which the assistant must offer a human agent.
 *
 * These map 1:1 to the product rule, so the behaviour can be reviewed against
 * the specification rather than inferred from a prompt.
 */
export type EscalationReason =
  | "unknown-answer"
  | "customer-requested-human"
  | "account-security"
  | "payment-dispute"
  | "manual-account-change"
  | "technical-investigation"
  | "custom-development"
  | "complaint"
  | "quotation-request"
  | "unresolved"
  | "repeatedly-unresolved";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_STATUSES = [
  "Open",
  "In Progress",
  "Waiting for Customer",
  "Waiting for Internal Team",
  "Resolved",
  "Closed",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface EscalationDecision {
  shouldEscalate: boolean;
  reasons: EscalationReason[];
  /** Highest priority implied by the matched reasons. */
  priority: TicketPriority;
  /** Best guess at what the customer is trying to accomplish. */
  intent: SupportIntent;
  /**
   * When true the assistant must not attempt an automated answer at all -
   * used for account security, where handing over is the safe action.
   */
  suppressAutomatedAnswer: boolean;
}

/**
 * What the assistant is told when a customer returns to AI after a human
 * helped them.
 *
 * Deliberately minimal. It carries the ticket id and the fact that an agent
 * was involved, and NOTHING else - no internal notes, no AI summary, no
 * internal events. The thread never copies that material, so there is nothing
 * here to leak.
 */
export interface PriorSupportContext {
  ticketId: string;
  note: string;
}

export type SupportIntent =
  | "product-information"
  | "account-help"
  | "package-inquiry"
  | "pricing-quotation"
  | "order-issue"
  | "inventory-issue"
  | "promotion-setup"
  | "analytics-reporting"
  | "technical-problem"
  | "security-concern"
  | "payment-dispute"
  | "complaint"
  | "custom-development"
  | "human-request"
  | "unknown";

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * The factual handover brief attached to a ticket.
 *
 * Deliberately contains NO model reasoning, no confidence commentary and no
 * chain of thought - only what happened, what the customer wants, what was
 * already tried, and what an agent should look at next.
 */
export interface HandoffSummary {
  customerProblem: string;
  customerGoal: string;
  accountInformation: string[];
  alreadyTried: string[];
  relevantMessages: { role: "user" | "assistant"; content: string }[];
  suggestedNextSteps: string[];
}

/**
 * Anything recorded against a ticket.
 *
 * `internal: true` marks a staff-only note. Internal notes are filtered out of
 * every customer-facing read path, which is enforced in one place
 * (`ticketForCustomer`) so it cannot be forgotten at a call site.
 */
export type TicketEventType =
  | "created"
  | "customer-message"
  | "agent-reply"
  | "internal-note"
  | "status-change"
  | "assignment"
  | "priority-change"
  | "attachment"
  | "info-request"
  | "resolved"
  | "reopened";

export interface TicketEvent {
  id: string;
  at: string;
  type: TicketEventType;
  /** Display name of whoever caused it. */
  actor: string;
  actorRole?: string;
  body?: string;
  /** Staff-only. Never returned to a customer. */
  internal: boolean;
  meta?: Record<string, string>;
}

export interface TicketAttachment {
  name: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
  /**
   * Where the file actually lives (your object storage URL or key).
   * TODO(production): the platform stores metadata only - wire this to S3 or
   * equivalent so the file itself is retrievable from the dashboard.
   */
  storageKey: string;
}

export interface SupportTicket {
  ticketId: string;
  customerName: string;
  /** Present only when the account data source provided one. */
  customerEmail: string | null;
  /** Withheld from anyone without `customer.phone.view`. */
  customerPhone: string | null;
  businessName: string;
  /**
   * The tenant this ticket belongs to.
   *
   * This is the isolation key. `businessName` is a display label that a
   * business can change; `businessId` is the immutable identifier a tenant
   * check must use. See api/support/tenant.ts.
   */
  businessId: string | null;
  userId: string;
  packageName: string;
  subject: string;
  description: string;
  category: QuickActionCategory;
  priority: TicketPriority;
  status: TicketStatus;
  /** Staff display name, or null when unassigned. */
  assignedAgent: string | null;
  /** Staff id used for permission checks. */
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  conversationId: string;
  aiSummary: HandoffSummary;
  escalationReasons: EscalationReason[];
  isAuthenticated: boolean;
  /** The complete AI/customer conversation, oldest first. */
  conversation: ChatTurn[];
  /** Staff-only notes and actions. */
  events: TicketEvent[];
  attachments: TicketAttachment[];
  /** Set when an agent has asked the customer for more information. */
  requestInfo: string | null;
}

export interface ChatResponseBody {
  reply: string;
  category: QuickActionCategory;
  grounded: boolean;
  needsHuman: boolean;
  needsClarification: boolean;
  sources: { id: string; title: string }[];
  /** Echo of the authenticated context, for the UI to show "signed in as X". */
  viewer: { isAuthenticated: boolean; displayName: string | null; businessName: string | null };
  sessionId: string;
  /** Present when the turn was escalated, so the UI can surface the ticket CTA. */
  escalation?: { reasons: EscalationReason[]; priority: TicketPriority };
}

export interface HandoffRequestBody {
  sessionId: string;
  reason?: string;
  contactPreference?: "phone" | "email" | "either";
}

export interface HandoffResponseBody {
  ok: true;
  ticketId: string;
  status: TicketStatus;
  message: string;
}
