import { canViewTicket, seesAllTickets, type SupportStaff } from "./roles";
import { allTickets } from "./ticketStore";
import { countActiveSessions } from "./tickets";
import type { SupportTicket, TicketPriority, TicketStatus } from "./types";

/**
 * ============================================================================
 *  DASHBOARD QUERIES
 * ============================================================================
 *
 *  Read-side logic for the support dashboard: the headline metrics, and the
 *  searchable / filterable / sortable / paginated ticket list.
 *
 *  Every query is scoped to the viewer FIRST. A support agent without
 *  `ticket.view.all` only ever sees tickets assigned to them, so a missing
 *  filter can never widen their view of the platform.
 */

const ACTIVE_CHAT_WINDOW_MS = 30 * 60 * 1000;

const OPEN_STATUSES: TicketStatus[] = [
  "Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team",
];

function isOpen(ticket: SupportTicket): boolean {
  return OPEN_STATUSES.includes(ticket.status);
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The tickets this staff member is permitted to see at all. */
export function visibleTickets(staff: SupportStaff): SupportTicket[] {
  const all = allTickets();
  if (seesAllTickets(staff.role)) return all;
  return all.filter((ticket) => canViewTicket(staff, ticket.assignedTo));
}

function averageMinutes(pairs: number[]): number | null {
  if (pairs.length === 0) return null;
  const total = pairs.reduce((sum, value) => sum + value, 0);
  return Math.round(total / pairs.length);
}

export interface DashboardMetrics {
  openTickets: number;
  activeChats: number;
  unassignedTickets: number;
  highPriorityTickets: number;
  waitingForCustomer: number;
  resolvedToday: number;
  /** Minutes from ticket creation to the first agent action. */
  averageResponseMinutes: number | null;
  /** Minutes from ticket creation to resolution. */
  averageResolutionMinutes: number | null;
  totalTickets: number;
  mineOpen: number;
}

export function computeMetrics(staff: SupportStaff): DashboardMetrics {
  const tickets = visibleTickets(staff);

  const responseTimes: number[] = [];
  const resolutionTimes: number[] = [];
  let resolvedToday = 0;
  const todayStart = startOfToday();

  for (const ticket of tickets) {
    if (ticket.firstResponseAt) {
      responseTimes.push(
        (new Date(ticket.firstResponseAt).getTime() - new Date(ticket.createdAt).getTime()) / 60000,
      );
    }
    if (ticket.resolvedAt) {
      resolutionTimes.push(
        (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / 60000,
      );
      if (new Date(ticket.resolvedAt).getTime() >= todayStart) resolvedToday += 1;
    }
  }

  return {
    openTickets: tickets.filter(isOpen).length,
    activeChats: countActiveSessions(ACTIVE_CHAT_WINDOW_MS),
    unassignedTickets: tickets.filter((t) => isOpen(t) && t.assignedTo === null).length,
    highPriorityTickets: tickets.filter(
      (t) => isOpen(t) && (t.priority === "high" || t.priority === "urgent"),
    ).length,
    waitingForCustomer: tickets.filter((t) => t.status === "Waiting for Customer").length,
    resolvedToday,
    averageResponseMinutes: averageMinutes(responseTimes),
    averageResolutionMinutes: averageMinutes(resolutionTimes),
    totalTickets: tickets.length,
    mineOpen: tickets.filter((t) => isOpen(t) && t.assignedTo === staff.id).length,
  };
}

// ---------------------------------------------------------------------------
// Ticket list: search, filter, sort, paginate
// ---------------------------------------------------------------------------

export type SortField =
  | "createdAt" | "updatedAt" | "priority" | "status" | "customerName" | "subject";

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};

export interface TicketQuery {
  search?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: string[];
  assignedTo?: string;   // staff id, or "unassigned"
  sort?: SortField;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface TicketListRow {
  ticketId: string;
  customerName: string;
  businessName: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedAgent: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when the row is high or urgent priority. */
  isHighPriority: boolean;
}

export interface TicketListResult {
  rows: TicketListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

function toRow(ticket: SupportTicket): TicketListRow {
  return {
    ticketId: ticket.ticketId,
    customerName: ticket.customerName,
    businessName: ticket.businessName,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    assignedAgent: ticket.assignedAgent,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    isHighPriority: ticket.priority === "high" || ticket.priority === "urgent",
  };
}

function matchesSearch(ticket: SupportTicket, needle: string): boolean {
  const haystack = [
    ticket.ticketId, ticket.customerName, ticket.businessName,
    ticket.subject, ticket.customerEmail ?? "", ticket.packageName,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function queryTickets(
  staff: SupportStaff,
  query: TicketQuery = {},
): TicketListResult {
  const {
    search, status, priority, category, assignedTo,
    sort = "createdAt", direction = "desc",
    page = 1, pageSize = 20,
  } = query;

  // Scope first, always.
  let tickets = visibleTickets(staff);

  if (search && search.trim()) {
    const needle = search.trim().toLowerCase();
    tickets = tickets.filter((ticket) => matchesSearch(ticket, needle));
  }
  if (status?.length) tickets = tickets.filter((t) => status.includes(t.status));
  if (priority?.length) tickets = tickets.filter((t) => priority.includes(t.priority));
  if (category?.length) tickets = tickets.filter((t) => category.includes(t.category));
  if (assignedTo === "unassigned") {
    tickets = tickets.filter((t) => t.assignedTo === null);
  } else if (assignedTo === "me") {
    tickets = tickets.filter((t) => t.assignedTo === staff.id);
  } else if (assignedTo) {
    tickets = tickets.filter((t) => t.assignedTo === assignedTo);
  }

  const sorted = [...tickets].sort((a, b) => {
    let comparison = 0;
    switch (sort) {
      case "priority":
        comparison = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      case "status":
        comparison = a.status.localeCompare(b.status);
        break;
      case "customerName":
        comparison = a.customerName.localeCompare(b.customerName);
        break;
      case "subject":
        comparison = a.subject.localeCompare(b.subject);
        break;
      case "updatedAt":
        comparison = a.updatedAt.localeCompare(b.updatedAt);
        break;
      default:
        comparison = a.createdAt.localeCompare(b.createdAt);
    }
    if (comparison === 0) comparison = a.ticketId.localeCompare(b.ticketId);
    return direction === "asc" ? comparison : -comparison;
  });

  const total = sorted.length;
  const safeSize = Math.min(Math.max(pageSize, 1), 100);
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * safeSize;

  return {
    rows: sorted.slice(start, start + safeSize).map(toRow),
    total,
    page: safePage,
    pageSize: safeSize,
    pageCount,
  };
}
