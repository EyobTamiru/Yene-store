import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection } from "../lib/jsonCollection";
import { recordAudit } from "./auditLog";
import type {
  ChatTurn,
  SupportTicket,
  TicketEvent,
  TicketEventType,
  TicketPriority,
  TicketStatus,
} from "./types";

/**
 * ============================================================================
 *  DURABLE TICKET STORE
 * ============================================================================
 *
 *  Section 4 needs a dashboard, and a dashboard over an in-memory map would be
 *  a toy: every restart would lose the ticket history, and a second instance
 *  would see a different set of tickets. So tickets are persisted to disk with
 *  atomic writes via the shared JSON collection.
 *
 *  TODO(production): replace with a real database before running multiple
 *  instances. The function names below are the seam - swap the bodies and no
 *  caller changes.
 */

/**
 * `YENE_DATA_DIR` is honoured so the verification suites - which redirect it
 * to a temporary directory - cannot read or write real ticket data. This
 * previously hardcoded ./data, which meant a test run could count real
 * tickets. Same pattern as analyticsStore.ts and auditLog.ts.
 */
const ticketDataDir = process.env.YENE_DATA_DIR
  ? path.resolve(process.env.YENE_DATA_DIR)
  : path.resolve(process.cwd(), "data");

const store = createJsonCollection<SupportTicket>(
  path.join(ticketDataDir, "support-tickets.json"),
  "ticket-store",
  5000,
);

const all = store.all;
const persist = store.touch;

function nowIso(): string {
  return new Date().toISOString();
}

function generateTicketId(): string {
  return `YENE-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function allTickets(): SupportTicket[] {
  return all();
}

export function getTicketById(ticketId: string): SupportTicket | null {
  return all().find((ticket) => ticket.ticketId === ticketId) ?? null;
}

export interface CreateTicketInput {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  businessName: string;
  /** The tenant this ticket belongs to. The isolation key. */
  businessId: string | null;
  userId: string;
  packageName: string;
  subject: string;
  description: string;
  category: SupportTicket["category"];
  priority: TicketPriority;
  conversationId: string;
  aiSummary: SupportTicket["aiSummary"];
  escalationReasons: SupportTicket["escalationReasons"];
  isAuthenticated: boolean;
  conversation: ChatTurn[];
}

export function insertTicket(input: CreateTicketInput): SupportTicket {
  const list = all();
  const created = nowIso();

  const ticket: SupportTicket = {
    ticketId: generateTicketId(),
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    businessName: input.businessName,
    businessId: input.businessId,
    userId: input.userId,
    packageName: input.packageName,
    subject: input.subject,
    description: input.description,
    category: input.category,
    priority: input.priority,
    status: "Open",
    assignedAgent: null,
    assignedTo: null,
    createdAt: created,
    updatedAt: created,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    conversationId: input.conversationId,
    aiSummary: input.aiSummary,
    escalationReasons: input.escalationReasons,
    isAuthenticated: input.isAuthenticated,
    conversation: input.conversation,
    events: [
      {
        id: randomBytes(6).toString("hex"),
        at: created,
        type: "created",
        actor: "Yene AI Support",
        internal: false,
        meta: { reason: input.escalationReasons.join(", ") },
      },
    ],
    attachments: [],
    requestInfo: null,
  };

  list.push(ticket);
  persist();
  persist();

  // Section 8: a ticket being created is one of the events the audit log
  // must record. Recorded here, in the store, rather than at each call site,
  // so a ticket cannot be created without leaving a trace.
  recordAudit({
    action: "ticket.created",
    actor: "Yene AI Support",
    actorKind: "system",
    target: ticket.ticketId,
    detail: ticket.subject,
    businessId: ticket.businessId,
  });

  return ticket;
}

export function updateTicket(
  ticketId: string,
  mutator: (ticket: SupportTicket) => void,
): SupportTicket | null {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;
  mutator(ticket);
  ticket.updatedAt = nowIso();
  persist();
  return ticket;
}

export function addEvent(
  ticket: SupportTicket,
  event: Omit<TicketEvent, "id" | "at" | "internal"> & { internal?: boolean },
): TicketEvent {
  const full: TicketEvent = {
    id: randomBytes(6).toString("hex"),
    at: nowIso(),
    internal: event.internal ?? true,
    ...event,
  };
  ticket.events.push(full);
  ticket.updatedAt = full.at;
  return full;
}

export const ticketStatuses: TicketStatus[] = [
  "Open", "In Progress", "Waiting for Customer",
  "Waiting for Internal Team", "Resolved", "Closed",
];

export const ticketPriorities: TicketPriority[] = ["low", "normal", "high", "urgent"];

export const ticketEventTypes: TicketEventType[] = [
  "created", "customer-message", "agent-reply", "internal-note",
  "status-change", "assignment", "priority-change", "attachment",
  "info-request", "resolved", "reopened",
];

/** Legal status transitions - a ticket cannot jump from Closed to In Progress. */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  Open: ["In Progress", "Waiting for Customer", "Closed"],
  "In Progress": ["Waiting for Customer", "Waiting for Internal Team", "Resolved", "Closed"],
  "Waiting for Customer": ["In Progress", "Closed"],
  "Waiting for Internal Team": ["In Progress", "Resolved", "Closed"],
  Resolved: ["Closed", "In Progress"],
  Closed: ["Open"],
};


