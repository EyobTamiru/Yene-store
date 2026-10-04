import { BRAND, SUPPORT_CONTACT } from "../../src/constants";
import { escalationCategory, REASON_LABELS } from "./intents";
import { formatSummaryForTicket } from "./summary";
import { canAccessTicket, tenantTickets } from "./tenant";
import { getTicketById, insertTicket, STATUS_TRANSITIONS, updateTicket, allTickets, type CreateTicketInput } from "./ticketStore";
import type {
  ChatTurn,
  EscalationDecision,
  SupportAccountContext,
  SupportIdentity,
  SupportIntent,
  SupportTicket,
  TicketStatus,
} from "./types";

/**
 * ============================================================================
 *  CONVERSATION SESSIONS AND TICKET ACCESS
 * ============================================================================
 *
 *  Split of responsibilities:
 *   - Conversation SESSIONS live in memory. They are ephemeral chat state and
 *     are lost on restart, which is correct and expected.
 *   - TICKETS are durable and live in `ticketStore.ts`, so the Section 4
 *     dashboard survives restarts.
 *
 *  PRIVACY
 *  -------
 *  Two rules are enforced here rather than at call sites, so a new endpoint
 *  cannot forget them:
 *   1. A transcript is readable only by the identity that created the session.
 *   2. A customer-facing ticket NEVER contains internal notes, internal events
 *      or the customer phone number.
 *
 *  TODO(production): back the session map with your datastore if transcripts
 *  must survive a restart.
 */

const MAX_SESSIONS = 500;
const MAX_TURNS_PER_SESSION = 60;

interface StoredSession {
  turns: ChatTurn[];
  identity: SupportIdentity;
  account: SupportAccountContext;
  unresolvedStreak: number;
  updatedAt: number;
}

const sessions = new Map<string, StoredSession>();

function pruneSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const ordered = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of ordered.slice(0, sessions.size - MAX_SESSIONS)) {
    sessions.delete(key);
  }
}

/** Record a turn and keep the unresolved-streak counter up to date. */
export function recordTurn(
  sessionId: string,
  turn: ChatTurn,
  identity: SupportIdentity,
  options: { account?: SupportAccountContext; incrementUnresolved?: boolean } = {},
): number {
  const existing = sessions.get(sessionId);
  const turns = existing ? [...existing.turns, turn] : [turn];

  const streak =
    turn.role === "user" && options.incrementUnresolved
      ? (existing?.unresolvedStreak ?? 0) + 1
      : turn.role === "user"
        ? 0
        : (existing?.unresolvedStreak ?? 0);

  sessions.set(sessionId, {
    turns: turns.slice(-MAX_TURNS_PER_SESSION),
    identity: existing?.identity ?? identity,
    account: existing?.account ?? options.account ?? { facts: [] },
    unresolvedStreak: streak,
    updatedAt: Date.now(),
  });

  pruneSessions();
  return streak;
}

export function getUnresolvedStreak(sessionId: string): number {
  return sessions.get(sessionId)?.unresolvedStreak ?? 0;
}

export function getSession(
  sessionId: string,
  identity: SupportIdentity,
): { turns: ChatTurn[]; account: SupportAccountContext; unresolvedStreak: number } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.identity.userId !== identity.userId) {
    console.warn("[support] blocked cross-session read");
    return null;
  }

  return {
    turns: session.turns,
    account: session.account,
    unresolvedStreak: session.unresolvedStreak,
  };
}

/** Session ids with activity in the last `windowMs`. Used for "active chats". */
export function countActiveSessions(windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let count = 0;
  for (const session of sessions.values()) {
    if (session.updatedAt >= cutoff) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/** Short subject prefixes so a ticket list is scannable. */
const INTENT_SUBJECT: Record<SupportIntent, string> = {
  "product-information": "Product information request",
  "account-help": "Account help request",
  "package-inquiry": "Package enquiry",
  "pricing-quotation": "Quotation request",
  "order-issue": "Order issue",
  "inventory-issue": "Inventory issue",
  "promotion-setup": "Promotion setup",
  "analytics-reporting": "Reporting request",
  "technical-problem": "Technical investigation",
  "security-concern": "Account security",
  "payment-dispute": "Payment dispute",
  "complaint": "Customer complaint",
  "custom-development": "Custom development enquiry",
  "human-request": "Customer requested an agent",
  "unknown": "Support request",
};

function buildSubject(escalation: EscalationDecision): string {
  const primary = escalation.reasons.find(
    (reason) => reason !== "unknown-answer" && reason !== "unresolved",
  );
  if (primary) return REASON_LABELS[primary];
  return INTENT_SUBJECT[escalation.intent] ?? INTENT_SUBJECT.unknown;
}

export interface CreateTicketFromChatInput {
  sessionId: string;
  identity: SupportIdentity;
  account: SupportAccountContext;
  escalation: EscalationDecision;
  transcript: ChatTurn[];
  description: string;
  aiSummary: SupportTicket["aiSummary"];
}

/** Open a ticket for this conversation and return the full staff-side record. */
export function createTicketFromChat(input: CreateTicketFromChatInput): SupportTicket {
  const payload: CreateTicketInput = {
    customerName: input.identity.displayName ?? "Guest customer",
    customerEmail: input.account.contactEmail ?? null,
    customerPhone: input.account.contactPhone ?? null,
    businessName: input.account.businessName ?? input.identity.businessId ?? "Not signed in",
    // The isolation key comes from the VERIFIED identity, never from the body.
    businessId: input.identity.businessId,
    userId: input.identity.userId,
    packageName: input.account.packageName ?? "Not available",
    subject: buildSubject(input.escalation),
    description: input.description || input.aiSummary.customerProblem,
    category: escalationCategory(input.escalation.reasons),
    priority: input.escalation.priority,
    conversationId: input.sessionId,
    aiSummary: input.aiSummary,
    escalationReasons: input.escalation.reasons,
    isAuthenticated: input.identity.isAuthenticated,
    conversation: input.transcript,
  };
  return insertTicket(payload);
}

/**
 * Strip everything a customer must never see.
 *
 * Internal notes, internal events and the customer phone number are removed
 * here and only here, so no endpoint can leak them by forgetting to filter.
 */
export function ticketForCustomer(ticket: SupportTicket): Partial<SupportTicket> {
  return {
    ticketId: ticket.ticketId,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    conversation: ticket.conversation.filter((turn) => turn.role === "user"),
    // Only non-internal events, and never the AI summary or attachments.
    events: ticket.events.filter((event) => !event.internal),
  };
}

/**
 * Read a ticket as its owner.
 *
 * Now a TENANT check rather than a user check (Section 8): a ticket belongs
 * to a business, so any authenticated member of that business may read it.
 * Guests are still refused, because every guest shares one identity.
 */
export function getTicketForOwner(
  ticketId: string,
  identity: SupportIdentity,
): SupportTicket | null {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;
  const decision = canAccessTicket(identity, ticket);
  if (!decision.allowed) {
    // Log the reason server-side. The caller only ever sees not-found,
    // because confirming a ticket exists is itself a small leak.
    console.warn('[support] blocked ticket read: ' + decision.reason);
    return null;
  }
  return ticket;
}

/**
 * The caller's own support requests, newest first.
 *
 * THE MISSING PIECE
 * -----------------
 * A customer could open a ticket and read it back by id, but had no way to
 * *list* their requests. That breaks the journey the specification describes:
 * "Customer receives resolution" is only meaningful if the customer can come
 * back and see it, and it is the only way a customer can find a ticket id they
 * did not write down.
 *
 * SCOPING
 * -------
 * Delegated to `tenantTickets`, so this is the same business-scoped boundary
 * every other read path uses (see tenant.ts). There is deliberately no way to
 * widen it: no businessId parameter, no "all tickets" mode. A caller sees the
 * requests of the business they belong to, which is the guarantee the
 * specification asks for.
 */
export function listTicketsForCaller(
  identity: SupportIdentity,
): Partial<SupportTicket>[] {
  return tenantTickets(identity, allTickets())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(ticketForCustomer);
}

// ---------------------------------------------------------------------------
// Customer-facing status change. Refuses illegal transitions.
// ---------------------------------------------------------------------------
export function updateTicketStatusForOwner(
  ticketId: string,
  status: TicketStatus,
  identity: SupportIdentity,
): { ok: boolean; ticket?: SupportTicket; error?: string } {
  const ticket = getTicketForOwner(ticketId, identity);
  if (!ticket) return { ok: false, error: "Ticket not found." };

  if (ticket.status === status) return { ok: true, ticket };
  if (!STATUS_TRANSITIONS[ticket.status].includes(status)) {
    return {
      ok: false,
      error: `Cannot move a ticket from "${ticket.status}" to "${status}".`,
    };
  }

  if (status === "Closed") ticket.closedAt = new Date().toISOString();
  updateTicket(ticketId, (t) => {
    t.status = status;
  });
  return { ok: true, ticket };
}

/**
 * Notify the support team that a ticket exists.
 *
 * A failed notification must never fail the customer's request - the ticket is
 * already created, so we log and move on.
 */
export async function notifyTicketCreated(ticket: SupportTicket): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[support] ticket created without Telegram notification (not configured)");
    return false;
  }

  const icon = ticket.priority === "urgent" ? "[URGENT]" : ticket.priority === "high" ? "[HIGH]" : "";

  const text = [
    `New support ticket ${ticket.ticketId} ${icon}`.trim(),
    `Priority: ${ticket.priority} | Status: ${ticket.status}`,
    `Customer: ${ticket.customerName}${ticket.businessName !== "Not signed in" ? ` - ${ticket.businessName}` : ""}`,
    `Package: ${ticket.packageName}`,
    `Subject: ${ticket.subject}`,
    ``,
    formatSummaryForTicket(ticket.ticketId, ticket.aiSummary),
    ``,
    `Team: ${SUPPORT_CONTACT.phone} / ${SUPPORT_CONTACT.email}`,
  ].join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) {
      console.error("[support] Telegram rejected ticket:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[support] Telegram notification failed:", error);
    return false;
  }
}
