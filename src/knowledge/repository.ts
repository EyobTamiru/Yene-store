import fs from "node:fs";
import path from "node:path";
import { createJsonCollection } from "../../api/lib/jsonCollection";
import {
  DEFAULT_LANGUAGE,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  type KnowledgeArticle,
  type KnowledgeBaseSnapshot,
  type KnowledgeVersion,
  type ValidationIssue,
} from "./types";

/**
 * ============================================================================
 *  KNOWLEDGE BASE REPOSITORY
 * ============================================================================
 *
 *  The knowledge base is DATA, not code.
 *
 *  Every article is a markdown file under `knowledge-base/`, so a Yene
 *  administrator can update a feature, a package, a price, a policy, an FAQ,
 *  a tutorial or a support procedure without touching a line of TypeScript and
 *  without a developer in the loop.
 *
 *  Layout:  knowledge-base/<category>/<slug>.md
 *
 *  Files and folders beginning with `_` are ignored, so `_TEMPLATE.md` can
 *  live alongside real content.
 *
 *  DESIGN NOTE ON FAILURE: a malformed file never takes support offline. Bad
 *  articles are skipped and reported through `getIssues()` and the admin API,
 *  so one bad edit costs one article rather than the whole assistant.
 */

export const KB_ROOT = path.resolve(process.cwd(), "knowledge-base");
const MAX_ARTICLE_BYTES = 256 * 1024;
const IGNORED_PREFIX = "_";

let cache: KnowledgeBaseSnapshot | null = null;

export interface ParsedMarkdown {
  frontmatter: Record<string, string | string[] | boolean>;
  body: string;
}

function coerceValue(raw: string): string | string[] | boolean {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Parse the small YAML subset used by the knowledge base: scalar values,
 * inline arrays, and block lists of scalars. Nested maps are not supported on
 * purpose - the schema is flat, and a flat format cannot be got subtly wrong.
 */
export function parseFrontmatter(text: string): ParsedMarkdown {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "").trim();
  const frontmatter: Record<string, string | string[] | boolean> = {};

  let currentKey: string | null = null;
  for (const line of block.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentKey) {
      const existing = frontmatter[currentKey];
      const list = Array.isArray(existing) ? [...existing] : [];
      list.push(asString(coerceValue(listItem[1])));
      frontmatter[currentKey] = list;
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!pair) continue;

    currentKey = pair[1];
    const value = pair[2].trim();
    frontmatter[currentKey] = value === "" ? "" : coerceValue(value);
  }

  return { frontmatter, body };
}

export function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "boolean") return String(value);
  return fallback;
}

export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Turn a parsed file into an article, or report why it cannot be used. */
export function validateArticle(
  file: string,
  parsed: ParsedMarkdown,
): { article?: KnowledgeArticle; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const fm = parsed.frontmatter;
  const error = (message: string) => issues.push({ file, level: "error", message });

  const id = asString(fm.id);
  const title = asString(fm.title);
  const category = asString(fm.category);
  const status = asString(fm.status);
  const audience = asString(fm.audience);
  const lastReviewed = asString(fm.lastReviewed);
  const reviewedBy = asString(fm.reviewedBy);
  const keywords = asList(fm.keywords);
  const body = parsed.body;

  if (!id) error("missing required field: id");
  else if (!ID_PATTERN.test(id)) error(`id "${id}" must be lowercase-kebab-case`);
  else if (path.basename(file) !== `${id}.md`) {
    error(`filename must be "${id}.md" to match the id`);
  }

  if (!title) error("missing required field: title");
  if (!body) error("missing required field: body (the article is empty)");

  if (!category) error("missing required field: category");
  else if (!(KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)) {
    error(`unknown category "${category}". Valid: ${KNOWLEDGE_CATEGORIES.join(", ")}`);
  }

  if (!status) error("missing required field: status");
  else if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(status)) {
    error(`unknown status "${status}". Valid: ${KNOWLEDGE_STATUSES.join(", ")}`);
  }

  if (!audience) error("missing required field: audience");
  else if (!(KNOWLEDGE_AUDIENCES as readonly string[]).includes(audience)) {
    error(`unknown audience "${audience}". Valid: ${KNOWLEDGE_AUDIENCES.join(", ")}`);
  }

  if (!lastReviewed) error("missing required field: lastReviewed");
  else if (!DATE_PATTERN.test(lastReviewed)) {
    error(`lastReviewed must be YYYY-MM-DD, got "${lastReviewed}"`);
  }

  if (!reviewedBy) error("missing required field: reviewedBy");
  if (keywords.length === 0) {
    error("at least one keyword is required, otherwise the article is unfindable");
  }

  // The most important guard in the whole system: a PUBLISHED article must
  // never still contain a placeholder.
  if (status === "published") {
    if (/TODO\(content-owner\)|TODO:/i.test(body)) {
      error("a published article must not contain a TODO placeholder");
    }
    if (body.length < 40) {
      issues.push({
        file,
        id,
        level: "warning",
        message: "published article is very short - check it actually answers the question",
      });
    }
  }

  if (id) for (const issue of issues) issue.id = id;
  if (issues.some((issue) => issue.level === "error")) return { issues };

  const now = new Date().toISOString();
  const version = Math.max(1, Number(asString(fm.version, "1")) || 1);

  return {
    issues,
    article: {
      id,
      title,
      category: category as KnowledgeArticle["category"],
      status: status as KnowledgeArticle["status"],
      audience: audience as KnowledgeArticle["audience"],
      language: asString(fm.language, DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE,
      version,
      keywords,
      body,
      lastReviewed,
      reviewedBy,
      createdBy: asString(fm.createdBy, "unknown"),
      createdAt: asString(fm.createdAt, now),
      updatedBy: asString(fm.updatedBy, asString(fm.createdBy, "unknown")),
      updatedAt: asString(fm.updatedAt, asString(fm.createdAt, now)),
      requiresAccountData:
        fm.requiresAccountData === true || fm.requiresAccountData === "true",
      related: asList(fm.related),
    },
  };
}

function collectMarkdownFiles(dir: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(IGNORED_PREFIX)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, found);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

/** Read and validate every article on disk. */
export function loadKnowledgeBase(): KnowledgeBaseSnapshot {
  const issues: ValidationIssue[] = [];
  const articles: KnowledgeArticle[] = [];
  const seen = new Map<string, string>();

  for (const file of collectMarkdownFiles(KB_ROOT)) {
    const relative = path.relative(KB_ROOT, file);

    let raw: string;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_ARTICLE_BYTES) {
        issues.push({
          file: relative,
          level: "error",
          message: `file is larger than ${MAX_ARTICLE_BYTES} bytes`,
        });
        continue;
      }
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      issues.push({
        file: relative,
        level: "error",
        message: `could not read file: ${(error as Error).message}`,
      });
      continue;
    }

    const result = validateArticle(relative, parseFrontmatter(raw));
    issues.push(...result.issues);
    if (!result.article) continue;

    const previous = seen.get(result.article.id);
    if (previous) {
      issues.push({
        file: relative,
        id: result.article.id,
        level: "error",
        message: `duplicate id, already defined in ${previous}`,
      });
      continue;
    }

    seen.set(result.article.id, relative);
    articles.push(result.article);
  }

  // Warn about dangling `related` links - harmless, but usually a typo.
  for (const article of articles) {
    for (const related of article.related ?? []) {
      if (!seen.has(related)) {
        issues.push({
          file: article.id,
          id: article.id,
          level: "warning",
          message: `related article "${related}" does not exist`,
        });
      }
    }
  }

  articles.sort((a, b) => a.id.localeCompare(b.id));
  return { articles, issues, loadedAt: Date.now() };
}

/** Cached snapshot. Loads on first use, then serves from memory. */
export function getKnowledgeBase(): KnowledgeBaseSnapshot {
  if (!cache) cache = loadKnowledgeBase();
  return cache;
}

/** Force a re-read from disk. Called after an admin saves an article. */
export function reloadKnowledgeBase(): KnowledgeBaseSnapshot {
  cache = loadKnowledgeBase();
  return cache;
}

/** Pick a folder that matches the article's category. */
function categoryFolder(category: string): string {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)
    ? category
    : "general";
}

/** Render an article back to the on-disk markdown format. */
export function serializeArticle(article: KnowledgeArticle): string {
  const lines = [
    "---",
    `id: ${article.id}`,
    `title: ${article.title}`,
    `category: ${article.category}`,
    `status: ${article.status}`,
    `audience: ${article.audience}`,
    `language: ${article.language}`,
    `version: ${article.version}`,
    `createdBy: ${article.createdBy}`,
    `createdAt: ${article.createdAt}`,
    `updatedBy: ${article.updatedBy}`,
    `updatedAt: ${article.updatedAt}`,
    `lastReviewed: ${article.lastReviewed}`,
    `reviewedBy: ${article.reviewedBy}`,
    `requiresAccountData: ${article.requiresAccountData ? "true" : "false"}`,
    "keywords:",
    ...article.keywords.map((keyword) => `  - ${keyword}`),
  ];

  if (article.related && article.related.length > 0) {
    lines.push(`related: [${article.related.join(", ")}]`);
  }

  lines.push("---", "", article.body.trim(), "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

const historyStore = createJsonCollection<KnowledgeVersion>(
  path.resolve(process.cwd(), "data", "knowledge-versions.json"),
  "knowledge-versions",
  2000,
);

/** Every retained revision of an article, newest first. */
export function getVersions(articleId: string): KnowledgeVersion[] {
  return historyStore
    .all()
    .filter((version) => version.articleId === articleId)
    .sort((a, b) => b.version - a.version);
}

export function getVersion(articleId: string, version: number): KnowledgeVersion | null {
  return getVersions(articleId).find((entry) => entry.version === version) ?? null;
}

/** How many revisions of an article to retain. */
const MAX_VERSIONS_PER_ARTICLE = 50;

function pruneVersions(articleId: string): void {
  const list = historyStore.all();
  const mine = list
    .filter((entry) => entry.articleId === articleId)
    .sort((a, b) => a.version - b.version);
  if (mine.length <= MAX_VERSIONS_PER_ARTICLE) return;

  const drop = new Set(mine.slice(0, mine.length - MAX_VERSIONS_PER_ARTICLE).map((v) => v.id));
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (drop.has(list[i].id)) list.splice(i, 1);
  }
}

/**
 * Record a revision.
 *
 * Called BEFORE the live file is replaced, so history cannot be lost by a
 * failed or partial save.
 */
export function recordVersion(
  article: KnowledgeArticle,
  changedBy: string,
  changeNote?: string,
): KnowledgeVersion {
  const version: KnowledgeVersion = {
    id: `${article.id}:v${article.version}`,
    articleId: article.id,
    version: article.version,
    title: article.title,
    category: article.category,
    status: article.status,
    language: article.language,
    keywords: article.keywords,
    body: article.body,
    changedBy,
    changedAt: new Date().toISOString(),
    changeNote,
    isCurrent: true,
  };

  // Only one revision can be the current one.
  for (const entry of historyStore.all()) {
    if (entry.articleId === article.id) entry.isCurrent = false;
  }

  const list = historyStore.all();
  const existing = list.find((entry) => entry.id === version.id);
  if (existing) {
    Object.assign(existing, version);
  } else {
    list.push(version);
  }

  pruneVersions(article.id);
  historyStore.touch();
  return version;
}

export interface SaveResult {
  ok: boolean;
  file?: string;
  issues: ValidationIssue[];
  /** The version number written. */
  version?: number;
}

export interface SaveOptions {
  /** Who is making the change. Recorded in the version history. */
  changedBy?: string;
  /** Optional note explaining what changed and why. */
  changeNote?: string;
}

/**
 * Create or replace an article, retaining the previous version.
 *
 * Order matters: the version history is written FIRST, so a failure during the
 * file write can never lose the previous revision. The version number is bumped
 * automatically unless the caller is restoring a specific one.
 */
export function saveArticle(article: KnowledgeArticle, options: SaveOptions = {}): SaveResult {
  const changedBy = options.changedBy?.trim() || "unknown administrator";
  const previous = getArticle(article.id);

  const now = new Date().toISOString();
  const next: KnowledgeArticle = {
    ...article,
    // Preserve creation provenance across edits.
    createdBy: previous?.createdBy ?? article.createdBy ?? changedBy,
    createdAt: previous?.createdAt ?? article.createdAt ?? now,
    updatedBy: changedBy,
    updatedAt: now,
    version: previous ? previous.version + 1 : Math.max(1, article.version || 1),
  };

  const fileName = `${next.id}.md`;
  const relative = path.join(categoryFolder(next.category), fileName);
  const absolute = path.join(KB_ROOT, relative);

  // Re-validate the exact text we are about to write.
  const text = serializeArticle(next);
  const { issues } = validateArticle(relative, parseFrontmatter(text));
  if (issues.some((issue) => issue.level === "error")) {
    return { ok: false, issues };
  }

  // History FIRST, so a crash after this point still leaves the old content
  // safe. Both revisions are recorded:
  //   - the outgoing content, at its own version number
  //   - the incoming content, at the new version number
  // Recording the outgoing state is what guarantees an article that predates
  // version tracking is never silently lost on its first edit.
  if (previous) {
    recordVersion(previous, previous.updatedBy || changedBy, "Superseded");
  }
  recordVersion(next, changedBy, options.changeNote);

  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temp = `${absolute}.${process.pid}.tmp`;
    fs.writeFileSync(temp, text, "utf8");
    fs.renameSync(temp, absolute);

    reloadKnowledgeBase();
    return { ok: true, file: relative, issues, version: next.version };
  } catch (error) {
    return {
      ok: false,
      issues: [
        { file: relative, id: next.id, level: "error", message: (error as Error).message },
      ],
    };
  }
}

/**
 * Restore a previous revision.
 *
 * The restore is itself a new version, so the history stays append-only and an
 * administrator can always see that a rollback happened and who did it.
 */
export function restoreVersion(
  articleId: string,
  version: number,
  changedBy: string,
): SaveResult {
  const target = getVersion(articleId, version);
  if (!target) return { ok: false, issues: [{ file: articleId, level: "error", message: "Version not found." }] };

  const current = getArticle(articleId);
  if (!current) {
    return { ok: false, issues: [{ file: articleId, level: "error", message: "Article not found." }] };
  }

  return saveArticle(
    {
      ...current,
      title: target.title,
      category: target.category,
      status: target.status,
      language: target.language,
      keywords: target.keywords,
      body: target.body,
    },
    { changedBy, changeNote: `Restored version ${version}` },
  );
}

export function getArticle(id: string): KnowledgeArticle | undefined {
  return getKnowledgeBase().articles.find((article) => article.id === id);
}

export function getArticles(): KnowledgeArticle[] {
  return getKnowledgeBase().articles;
}

export function getIssues(): ValidationIssue[] {
  return getKnowledgeBase().issues;
}
