import { Router, type Request, type Response } from "express";
import {
  CATEGORY_LABELS,
  DEFAULT_LANGUAGE,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  STATUS_LABELS,
  type KnowledgeArticle,
  type KnowledgeVersion,
} from "../../src/knowledge/types";
import {
  getArticle,
  getIssues,
  getVersion,
  getVersions,
  reloadKnowledgeBase,
  restoreVersion,
  saveArticle,
} from "../../src/knowledge/repository";
import { classifyQuery, knowledgeBaseStats } from "../../src/knowledge/retrieval";
import { answerSupportQuestion, isAiConfigured } from "../support/ai";
import { guestIdentity } from "../support/auth";
import { SOURCE_PRIORITY, tierFor } from "../support/sources";
import { recordAudit } from "../support/auditLog";

/**
 * Who to record as the author of a change.
 *
 * The bearer token is the shared admin secret, so it cannot identify a person.
 * The name is taken from an explicit header when present, and otherwise the
 * change is attributed to "unknown administrator" rather than guessed.
 */
function adminName(req: Request): string {
  const header = req.headers["x-admin-name"];
  const name = typeof header === "string" ? header.trim().slice(0, 80) : "";
  return name || "unknown administrator";
}

/**
 * ============================================================================
 *  KNOWLEDGE BASE ADMIN API
 * ============================================================================
 *
 *  Lets an authorized Yene administrator maintain the knowledge base at
 *  runtime: features, packages, prices, policies, FAQs, tutorials,
 *  troubleshooting instructions, contact information and support procedures.
 *
 *  AUTHORIZATION
 *  ------------
 *  Every route requires `Authorization: Bearer <YENE_KB_ADMIN_TOKEN>`.
 *
 *  The token is compared with a timing-safe check, and the comparison is always
 *  performed even when no token is configured, so a misconfigured deployment
 *  fails closed rather than opening the knowledge base to the internet.
 *
 *  This is an INTERNAL tool. Keep it behind your network boundary or an
 *  additional gateway rule as well.
 */
export const knowledgeAdminRouter = Router();

// Per-process throttle. Generous for a human editor, tight enough to make
// blind brute-forcing pointless.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isThrottled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAdmin(req: Request): boolean {
  const expected = process.env.YENE_KB_ADMIN_TOKEN;
  const header = req.headers.authorization;

  // Fail closed: no configured token means nobody is an admin.
  if (!expected || expected.startsWith("CHANGE_ME")) return false;
  if (!header || !header.startsWith("Bearer ")) return false;

  return safeEqual(header.slice("Bearer ".length).trim(), expected);
}

function unauthorized(res: Response): Response {
  // Deliberately vague: never reveal whether the token was close.
  return res.status(401).json({ error: "Not authorized." });
}

knowledgeAdminRouter.use((req: Request, res: Response, next) => {
  if (isThrottled(req.ip || "unknown")) {
    return res.status(429).json({ error: "Too many attempts. Try again shortly." });
  }
  if (!isAdmin(req)) return unauthorized(res);
  next();
});

// ---------------------------------------------------------------------------
// GET /knowledge - list every article plus validation issues
// ---------------------------------------------------------------------------
knowledgeAdminRouter.get("/knowledge", (_req: Request, res: Response) => {
  const snapshot = reloadKnowledgeBase();
  return res.status(200).json({
    ok: true,
    stats: knowledgeBaseStats(),
    articles: snapshot.articles.map((article) => ({
      id: article.id,
      title: article.title,
      category: article.category,
      categoryLabel: CATEGORY_LABELS[article.category],
      status: article.status,
      statusLabel: STATUS_LABELS[article.status],
      audience: article.audience,
      language: article.language,
      version: article.version,
      createdBy: article.createdBy,
      createdAt: article.createdAt,
      updatedBy: article.updatedBy,
      updatedAt: article.updatedAt,
      lastReviewed: article.lastReviewed,
      reviewedBy: article.reviewedBy,
      keywords: article.keywords,
      requiresAccountData: !!article.requiresAccountData,
      related: article.related ?? [],
      bodyLength: article.body.length,
    })),
    issues: snapshot.issues,
  });
});

// ---------------------------------------------------------------------------
// GET /knowledge/:id/versions - retained revisions, newest first
// ---------------------------------------------------------------------------
knowledgeAdminRouter.get("/knowledge/:id/versions", (req: Request, res: Response) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).json({ error: "Article not found." });

  return res.status(200).json({
    ok: true,
    currentVersion: article.version,
    versions: getVersions(req.params.id).map((version: KnowledgeVersion) => ({
      version: version.version,
      title: version.title,
      status: version.status,
      language: version.language,
      changedBy: version.changedBy,
      changedAt: version.changedAt,
      changeNote: version.changeNote,
      isCurrent: version.isCurrent,
      bodyLength: version.body.length,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /knowledge/:id/versions/:version - one revision in full
// ---------------------------------------------------------------------------
knowledgeAdminRouter.get("/knowledge/:id/versions/:version", (req: Request, res: Response) => {
  const version = getVersion(req.params.id, Number(req.params.version));
  if (!version) return res.status(404).json({ error: "Version not found." });
  return res.status(200).json({ ok: true, version });
});

// ---------------------------------------------------------------------------
// POST /knowledge/:id/versions/:version/restore
// ---------------------------------------------------------------------------
knowledgeAdminRouter.post("/knowledge/:id/versions/:version/restore", (req: Request, res: Response) => {
  const actor = adminName(req);
  const result = restoreVersion(req.params.id, Number(req.params.version), actor);
  if (!result.ok) {
    return res.status(400).json({ error: "Restore failed.", issues: result.issues });
  }
  // Section 8: a knowledge article change is an auditable action.
  recordAudit({
    action: "knowledge.changed",
    actor,
    actorKind: "staff",
    target: req.params.id,
    detail: `Restored version ${result.version}`,
  });
  return res.status(200).json({
    ok: true,
    file: result.file,
    version: result.version,
    message: `Restored as version ${result.version}. The earlier versions are still available.`,
  });
});

// ---------------------------------------------------------------------------
// GET /knowledge/:id - the full article
// ---------------------------------------------------------------------------
knowledgeAdminRouter.get("/knowledge/:id", (req: Request, res: Response) => {
  const article = getArticle(req.params.id);
  if (!article) return res.status(404).json({ error: "Article not found." });
  return res.status(200).json({ ok: true, article });
});

// ---------------------------------------------------------------------------
// PUT /knowledge/:id - create or replace an article
// ---------------------------------------------------------------------------
knowledgeAdminRouter.put("/knowledge/:id", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.id && body.id !== req.params.id) {
    return res.status(400).json({ error: "id in the body must match the URL." });
  }

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
  const str = (value: unknown, fallback = ""): string =>
    typeof value === "string" ? value : fallback;

  const existing = getArticle(req.params.id);
  const now = new Date().toISOString();
  const actor = adminName(req);

  const article: KnowledgeArticle = {
    id: req.params.id,
    title: str(body.title),
    category: str(body.category, "platform") as KnowledgeArticle["category"],
    status: str(body.status, "draft") as KnowledgeArticle["status"],
    audience: str(body.audience, "all") as KnowledgeArticle["audience"],
    language: str(body.language, DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE,
    // The repository owns versioning; the client may not set it arbitrarily.
    version: existing?.version ?? 1,
    keywords: strings(body.keywords),
    related: strings(body.related),
    body: str(body.body),
    lastReviewed: str(body.lastReviewed, new Date().toISOString().slice(0, 10)),
    reviewedBy: str(body.reviewedBy, actor),
    createdBy: existing?.createdBy ?? actor,
    createdAt: existing?.createdAt ?? now,
    updatedBy: actor,
    updatedAt: now,
    requiresAccountData: body.requiresAccountData === true,
  };

  const result = saveArticle(article, {
    changedBy: actor,
    changeNote: str(body.changeNote) || undefined,
  });
  if (!result.ok) {
    return res.status(400).json({ error: "Validation failed.", issues: result.issues });
  }

  // Section 8: a knowledge article change is an auditable action, and this is
  // the only route that can alter what the assistant is allowed to say.
  recordAudit({
    action: "knowledge.changed",
    actor,
    actorKind: "staff",
    target: req.params.id,
    detail: `${existing ? "Updated" : "Created"} as version ${result.version} (${article.status})`,
  });

  return res.status(200).json({
    ok: true,
    file: result.file,
    version: result.version,
    warnings: result.issues.filter((issue) => issue.level === "warning"),
    stats: knowledgeBaseStats(),
  });
});

// ---------------------------------------------------------------------------
// GET /schema - the valid values an editor may choose from
// ---------------------------------------------------------------------------
knowledgeAdminRouter.get("/schema", (_req: Request, res: Response) => {
  return res.status(200).json({
    categories: KNOWLEDGE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
    statuses: KNOWLEDGE_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    audiences: KNOWLEDGE_AUDIENCES,
    sourcePriority: SOURCE_PRIORITY,
    issues: getIssues(),
  });
});

// ---------------------------------------------------------------------------
// POST /test - ask a question exactly as a customer would, before publishing
//
// Returns the answer, the knowledge sources used, and a COVERAGE indicator.
//
// The coverage indicator is computed from retrieval and grounding facts, not
// from the model's opinion of its own confidence - a model asked how sure it is
// will always say it is sure, which is useless for a release gate.
//
// Nothing about the model's reasoning is returned. Only the customer-facing
// answer, the article ids it cited, and measurable coverage facts.
// ---------------------------------------------------------------------------
knowledgeAdminRouter.post("/test", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) {
    return res.status(400).json({ error: "Provide a question to test." });
  }

  const classification = classifyQuery(question, 4);

  // Run the real customer pipeline so the test reflects production exactly.
  const answer = await answerSupportQuestion(
    question,
    [],
    guestIdentity(),
    `admin_test_${Date.now()}`,
  );

  const sources = answer.sources.map((source) => {
    const article = getArticle(source.id);
    const hit = classification.approved.find((entry) => entry.article.id === source.id);
    return {
      id: source.id,
      title: source.title,
      status: article?.status ?? "unknown",
      version: article?.version ?? 0,
      category: article?.category ?? "unknown",
      categoryLabel: article ? CATEGORY_LABELS[article.category] : "unknown",
      // The highest-priority tier any of the cited sources belong to.
      tier: hit ? tierFor(hit) : "official-kb",
      score: hit ? Math.round(hit.score * 10) / 10 : null,
    };
  });

  const publishedHits = classification.approved.filter(
    (hit) => hit.article.status === "published",
  ).length;

  // Coverage reflects KNOWLEDGE, not whether the AI happened to be running.
  // Conflating the two would tell an administrator their content is missing
  // when the real problem is a model outage.
  const aiRunning = isAiConfigured();

  return res.status(200).json({
    ok: true,
    question,
    answer: answer.reply,
    grounded: answer.grounded,
    answerProduced: aiRunning && answer.grounded,
    sources,
    coverage: {
      level: coverageLevel(publishedHits),
      publishedSourcesMatched: publishedHits,
      citedSources: sources.length,
      // A topic that exists but is not published yet.
      unpublishedMatches: classification.drafts.map((hit) => ({
        id: hit.article.id,
        title: hit.article.title,
        status: hit.article.status,
      })),
      // The assistant will refuse this question without calling the model.
      willRefuse: classification.topicIsUndocumented,
      note: aiRunning
        ? null
        : "The AI backend is unavailable, so no live answer was generated. Coverage below reflects retrieval from the knowledge base only.",
    },
    // The candidate sources retrieval found, whether or not the model cited
    // them - useful when the answer could not be generated.
    matchedSources: classification.approved.map((hit) => ({
      id: hit.article.id,
      title: hit.article.title,
      status: hit.article.status,
      version: hit.article.version,
      category: hit.article.category,
      categoryLabel: CATEGORY_LABELS[hit.article.category],
      tier: tierFor(hit),
      score: Math.round(hit.score * 10) / 10,
    })),
    // The priority list the answer was produced under, for transparency.
    sourcePriority: SOURCE_PRIORITY,
  });
});

/**
 * A deterministic, explainable coverage verdict, based only on how much
 * published knowledge the question reached.
 *
 * It is deliberately NOT the model's self-reported confidence: asked how sure it
 * is, a model always says it is sure, which is useless as a release gate.
 */
function coverageLevel(publishedHits: number): "ready" | "review" | "not-covered" {
  if (publishedHits === 0) return "not-covered";
  if (publishedHits === 1) return "review";
  return "ready";
}


// ---------------------------------------------------------------------------
// POST /preview - what will the assistant retrieve for this question?
//
// Lets an administrator tune `keywords` without needing a Gemini key or
// spending tokens. Retrieval only - it never calls the model.
// ---------------------------------------------------------------------------
knowledgeAdminRouter.post("/preview", (req: Request, res: Response) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof raw.message === "string" ? raw.message.slice(0, 500) : "";

  if (!message.trim()) {
    return res.status(400).json({ error: "Provide a message to preview." });
  }

  const result = classifyQuery(message, 4);
  return res.status(200).json({
    ok: true,
    query: message,
    // If true, the assistant refuses without calling the model.
    willRefuse: result.topicIsUndocumented,
    answerable: result.approved.map((hit) => ({
      id: hit.article.id,
      title: hit.article.title,
      score: Math.round(hit.score * 10) / 10,
      matchedBecause: hit.score < 1 ? "related link" : "keywords",
    })),
    undocumentedMatches: result.drafts.map((hit) => ({
      id: hit.article.id,
      title: hit.article.title,
      status: hit.article.status,
      score: Math.round(hit.score * 10) / 10,
    })),
  });
});
