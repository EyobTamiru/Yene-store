/**
 * Client for the support analytics API (Section 7).
 *
 * Reuses the staff token from `supportAdminApi` rather than storing a second
 * copy: analytics and the ticket dashboard are the same population of people,
 * and two tokens in sessionStorage is one too many.
 */

import { getStaffToken } from "./supportAdminApi";

export type ResolutionAnswer = "yes" | "partially" | "no";

export interface NamedCount {
  key: string;
  label: string;
  count: number;
}

export interface QuestionSummary {
  fingerprint: string;
  question: string;
  occurrences: number;
  conversations: number;
  answered: number;
  escalated: number;
}

export interface ArticleUsage {
  id: string;
  title: string;
  category: string;
  known: boolean;
  timesUsed: number;
  conversations: number;
}

export interface AiMetrics {
  totalConversations: number;
  aiResolvedConversations: number;
  humanEscalations: number;
  /** Conversations where a human was offered, taken up or not. */
  humanOffered: number;
  unresolvedConversations: number;
  escalationRatePercent: number | null;
  averageConversationLength: number | null;
  totalTurns: number;
  groundedTurnRatePercent: number | null;
  commonProblems: NamedCount[];
  byCategory: NamedCount[];
  frequentQuestions: QuestionSummary[];
  articleUsage: ArticleUsage[];
  escalationReasons: NamedCount[];
}

export interface HumanMetrics {
  ticketsCreated: number;
  ticketsResolved: number;
  openTickets: number;
  ticketsClosed: number;
  reopenedTickets: number;
  reopenRatePercent: number | null;
  averageFirstResponseMinutes: number | null;
  averageResolutionMinutes: number | null;
  resolutionRatePercent: number | null;
  byCategory: NamedCount[];
  byPackage: NamedCount[];
  byBusiness: NamedCount[];
  byPriority: NamedCount[];
  byStatus: NamedCount[];
}

export interface SatisfactionMetrics {
  responses: number;
  yes: number;
  partially: number;
  no: number;
  resolutionRatePercent: number | null;
  fullOrPartialRatePercent: number | null;
  ratingsGiven: number;
  averageRating: number | null;
  ratingDistribution: { rating: number; count: number }[];
  comments: {
    id: string;
    ticketId: string | null;
    resolved: ResolutionAnswer;
    rating: number | null;
    comment: string | null;
    at: string;
  }[];
}

export type GapStatus = "open" | "planned" | "dismissed" | "published";

export interface KnowledgeGap {
  fingerprint: string;
  question: string;
  occurrences: number;
  conversations: number;
  category: string;
  intent: string;
  firstAskedAt: string;
  lastAskedAt: string;
  suggestedCategory: string;
  suggestedArticleId: string;
  relatedArticles: { id: string; title: string; status: string }[];
  status: GapStatus;
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AnalyticsReport {
  generatedAt: string;
  range: { days: number; since: string | null };
  ai: AiMetrics;
  human: HumanMetrics;
  satisfaction: SatisfactionMetrics;
  knowledgeGaps: KnowledgeGap[];
  privacy: { note: string; deliberateRefusals: number };
}

export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AnalyticsError";
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
    throw new AnalyticsError(
      body?.error ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return payload as T;
}

export const fetchAnalytics = (days: number) =>
  request<{ ok: boolean; report: AnalyticsReport }>(
    `/api/support-admin/analytics?days=${encodeURIComponent(String(days))}`,
  );

export const decideKnowledgeGap = (
  fingerprint: string,
  action: "planned" | "dismissed" | "published",
  note: string,
) =>
  request<{ ok: boolean }>("/api/support-admin/analytics/gaps", {
    method: "POST",
    body: JSON.stringify({ fingerprint, action, note }),
  });

// ---------------------------------------------------------------------------
// Section 8: the audit log
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actor: string;
  actorId: string | null;
  actorRole: string | null;
  actorKind: string;
  outcome: "allowed" | "denied";
  target: string;
  detail: string;
  businessId: string | null;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
}

export interface AuditIntegrity {
  ok: boolean;
  entries: number;
  brokenAt: number | null;
  reason: string | null;
}

/**
 * The audit log, for support managers and administrators.
 *
 * Gated on `audit.view` server-side. The UI is a convenience, not the control:
 * the API refuses a caller without the capability regardless of what the
 * browser renders.
 */
export const fetchAudit = (params: URLSearchParams) =>
  request<AuditListResponse>(`/api/support-admin/audit?${params.toString()}`);

/** Recompute the hash chain, to check the log has not been altered. */
export const fetchAuditIntegrity = () =>
  request<{ ok: boolean; integrity: AuditIntegrity }>("/api/support-admin/audit/integrity");

