/**
 * Client for the support dashboard API.
 *
 * The staff token is kept in sessionStorage only - it is cleared when the tab
 * closes, and is never written to a URL or a log line.
 */

const STAFF_TOKEN_KEY = "yene-support-staff-token";

export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  capabilities: string[];
}

export interface DashboardMetrics {
  openTickets: number;
  activeChats: number;
  unassignedTickets: number;
  highPriorityTickets: number;
  waitingForCustomer: number;
  resolvedToday: number;
  averageResponseMinutes: number | null;
  averageResolutionMinutes: number | null;
  totalTickets: number;
  mineOpen: number;
}

export interface TicketRow {
  ticketId: string;
  customerName: string;
  businessName: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignedAgent: string | null;
  createdAt: string;
  updatedAt: string;
  isHighPriority: boolean;
}

export interface TicketDetail {
  ticketId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerPhoneWithheld?: boolean;
  businessName: string;
  packageName: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedAgent: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  conversation: { role: string; content: string }[];
  events: {
    id: string; at: string; type: string; actor: string;
    actorRole?: string; body?: string; internal: boolean; meta?: Record<string, string>;
  }[];
  internalNotesWithheld?: boolean;
  attachments: { name: string; size: number; uploadedBy: string; uploadedAt: string }[];
  requestInfo: string | null;
  aiSummary: {
    customerProblem: string;
    customerGoal: string;
    accountInformation: string[];
    alreadyTried: string[];
    relevantMessages: { role: string; content: string }[];
    suggestedNextSteps: string[];
  };
  escalationReasons: string[];
}

export interface TicketListResponse {
  rows: TicketRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface DashboardMeta {
  statuses: string[];
  priorities: string[];
  roles: { value: string; label: string }[];
  assignableStaff: { id: string; name: string; role: string }[];
  canAssign: boolean;
  canViewAll: boolean;
}

export class SupportAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SupportAdminError";
  }
}

export function getStaffToken(): string {
  try {
    return sessionStorage.getItem(STAFF_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStaffToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(STAFF_TOKEN_KEY, token);
    else sessionStorage.removeItem(STAFF_TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStaffToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as { error?: string } | null;
    throw new SupportAdminError(body?.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

export const fetchWhoami = () => request<{ ok: boolean; staff: StaffProfile }>("/api/support-admin/whoami");
export const fetchMeta = () => request<DashboardMeta>("/api/support-admin/meta");
export const fetchMetrics = () =>
  request<{ ok: boolean; metrics: DashboardMetrics }>("/api/support-admin/dashboard");

export const fetchTickets = (params: URLSearchParams) =>
  request<TicketListResponse>(`/api/support-admin/tickets?${params.toString()}`);

export const fetchTicket = (id: string) =>
  request<{ ok: boolean; ticket: TicketDetail }>(`/api/support-admin/tickets/${id}`);

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const replyToTicket = (id: string, body: string) => post(`/api/support-admin/tickets/${id}/reply`, { body });
export const addInternalNote = (id: string, body: string) => post(`/api/support-admin/tickets/${id}/note`, { body });
export const assignTicket = (id: string, staffId: string, staffName: string) =>
  post(`/api/support-admin/tickets/${id}/assign`, { staffId, staffName });
export const changePriority = (id: string, priority: string) =>
  patch(`/api/support-admin/tickets/${id}/priority`, { priority });
export const changeStatus = (id: string, status: string) =>
  patch(`/api/support-admin/tickets/${id}/status`, { status });
export const requestInfo = (id: string, body: string) =>
  post(`/api/support-admin/tickets/${id}/request-info`, { body });
export const attachFile = (id: string, meta: { name: string; size: number; contentType?: string }) =>
  post(`/api/support-admin/tickets/${id}/attachments`, meta);
export const resolveTicket = (id: string, body: string) => post(`/api/support-admin/tickets/${id}/resolve`, { body });
export const reopenTicket = (id: string, body: string) => post(`/api/support-admin/tickets/${id}/reopen`, { body });
