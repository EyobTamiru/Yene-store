import type {
  KnowledgeArticle,
  KnowledgeCategory,
  ValidationIssue,
} from "../knowledge/types";

/**
 * Client for the knowledge base admin API.
 *
 * The admin token is held in sessionStorage only - it is cleared when the tab
 * closes, and is never written to a URL or a log line.
 */

const TOKEN_KEY = "yene-kb-admin-token";

export interface AdminStats {
  total: number;
  published: number;
  draft: number;
  archived: number;
  byCategory: Partial<Record<KnowledgeCategory, number>>;
  errors: number;
  warnings: number;
}

export interface ArticleVersion {
  version: number;
  title: string;
  status: string;
  language: string;
  changedBy: string;
  changedAt: string;
  changeNote?: string;
  isCurrent: boolean;
  bodyLength: number;
}

export type CoverageLevel = "ready" | "review" | "not-covered";

/** A source shown in the admin test console, with its priority tier. */
export interface TestSource {
  id: string;
  title: string;
  status: string;
  version: number;
  category: string;
  categoryLabel: string;
  tier: string;
  score: number | null;
}

export interface TestResult {
  ok: boolean;
  question: string;
  answer: string;
  grounded: boolean;
  /** False when the AI backend is down, so no live answer was generated. */
  answerProduced: boolean;
  /** Sources the model actually cited. */
  sources: TestSource[];
  /** Sources retrieval found, cited or not. */
  matchedSources: TestSource[];
  coverage: {
    level: CoverageLevel;
    publishedSourcesMatched: number;
    citedSources: number;
    unpublishedMatches: { id: string; title: string; status: string }[];
    willRefuse: boolean;
    note: string | null;
  };
  sourcePriority: { tier: number; id: string; label: string; description: string }[];
}

export interface SchemaResponse {
  categories: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
  audiences: string[];
  sourcePriority: { tier: number; id: string; label: string; description: string }[];
  issues: ValidationIssue[];
}

export interface ArticleSummary {
  id: string;
  title: string;
  category: KnowledgeCategory;
  categoryLabel: string;
  status: "draft" | "published" | "archived";
  statusLabel: string;
  audience: string;
  language: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  lastReviewed: string;
  reviewedBy: string;
  keywords: string[];
  requiresAccountData: boolean;
  related: string[];
  bodyLength: number;
}

export interface KnowledgeListResponse {
  ok: boolean;
  stats: AdminStats;
  articles: ArticleSummary[];
  issues: ValidationIssue[];
}

export class AdminError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The name recorded against every change made in this browser session. */
let adminName = "";
export function setAdminName(name: string): void {
  adminName = name;
}
export function getAdminName(): string {
  return adminName;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAdminToken()}`,
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
    const body = payload as { error?: string; issues?: ValidationIssue[] } | null;
    throw new AdminError(
      body?.error ?? `Request failed (${response.status})`,
      body?.issues ?? [],
    );
  }
  return payload as T;
}

export const listKnowledge = () =>
  request<KnowledgeListResponse>("/api/admin/knowledge");

export const getKnowledgeArticle = (id: string) =>
  request<{ ok: boolean; article: KnowledgeArticle }>(
    `/api/admin/knowledge/${encodeURIComponent(id)}`,
  );

/** Save an article. The server bumps the version and records who changed it. */
export const saveKnowledgeArticle = (
  article: KnowledgeArticle,
  changeNote?: string,
) =>
  request<{
    ok: boolean;
    file: string;
    version: number;
    warnings: ValidationIssue[];
    stats: AdminStats;
  }>(`/api/admin/knowledge/${encodeURIComponent(article.id)}`, {
    method: "PUT",
    headers: { "X-Admin-Name": adminName },
    body: JSON.stringify({ ...article, changeNote }),
  });

export const fetchSchema = () => request<SchemaResponse>("/api/admin/schema");

/** Ask a question exactly as a customer would, before publishing anything. */
export const testKnowledge = (question: string) =>
  request<TestResult>("/api/admin/test", {
    method: "POST",
    body: JSON.stringify({ question }),
  });

export const fetchVersions = (id: string) =>
  request<{ ok: boolean; currentVersion: number; versions: ArticleVersion[] }>(
    `/api/admin/knowledge/${encodeURIComponent(id)}/versions`,
  );

export const restoreVersion = (id: string, version: number) =>
  request<{ ok: boolean; version: number; message: string }>(
    `/api/admin/knowledge/${encodeURIComponent(id)}/versions/${version}/restore`,
    { method: "POST", headers: { "X-Admin-Name": adminName } },
  );
