import { getArticles, getKnowledgeBase } from "./repository";
import { isAnswerable } from "./types";
import type { KnowledgeArticle, KnowledgeCategory, RetrievedArticle } from "./types";

/**
 * A small, dependency-free keyword retriever.
 *
 * It is intentionally simple and predictable: the bot must be able to explain
 * exactly why it chose the articles it chose, and a content owner must be able
 * to predict whether a new article will be found. A vector database would make
 * that impossible to reason about without adding a service to operate.
 */

/** Words that carry no retrieval signal in this domain. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had", "having", "i", "me",
  "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her",
  "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs",
  "this", "that", "these", "those", "to", "of", "in", "on", "at", "by", "for",
  "with", "about", "into", "from", "and", "or", "but", "if", "then", "so",
  "than", "as", "can", "could", "would", "should", "will", "shall", "may",
  "might", "must", "please", "thanks", "thank", "hi", "hello", "hey", "there",
  "what", "which", "who", "whom", "when", "where", "why", "how", "any",
  "some", "no", "not", "only", "own", "same", "too", "very", "just", "also",
  "now", "get", "got", "need", "want", "like", "know", "tell", "help",
]);

/** Collapse a string to a comparable form: lowercase, alphanumeric+spaces only. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Very light suffix folding so "orders" matches "order" and "refunds" matches
 * "refund". Deliberately conservative - aggressive stemming causes false hits.
 */
function foldToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && (token.endsWith("ses") || token.endsWith("xes"))) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  return token;
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(foldToken);
}

/** Weights control how strongly each field pulls an article in. */
const FIELD_WEIGHTS = {
  keywords: 4,
  title: 2,
  category: 1.5,
  body: 1,
} as const;

function scoreArticle(article: KnowledgeArticle, query: string, tokens: string[]): number {
  let score = 0;

  // 1. Whole-phrase keyword match - the strongest signal, because keywords are
  //    written to capture how users actually phrase things ("order status").
  for (const keyword of article.keywords) {
    const phrase = normalize(keyword);
    if (phrase.length > 2 && query.includes(phrase)) score += FIELD_WEIGHTS.keywords * 2;
  }

  // 2. Token-level matches, per field.
  const tokenSet = new Set(tokens);
  for (const token of tokenSet) {
    for (const keyword of article.keywords) {
      if (tokenize(keyword).includes(token)) score += FIELD_WEIGHTS.keywords;
    }
    if (tokenize(article.title).includes(token)) score += FIELD_WEIGHTS.title;
    if (tokenize(article.category).includes(token)) score += FIELD_WEIGHTS.category;
    if (tokenize(article.body).includes(token)) score += FIELD_WEIGHTS.body;
  }

  return score;
}

export interface RetrieveOptions {
  limit?: number;
  /** Include unapproved articles. Only useful for topic detection, never for answers. */
  includeDrafts?: boolean;
}

/**
 * Rank knowledge-base articles against a user question.
 * Returns only articles with a non-zero score, highest first.
 */
export function retrieveArticles(
  query: string,
  options: RetrieveOptions = {},
): RetrievedArticle[] {
  const { limit = 4, includeDrafts = false } = options;

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const pool = getArticles().filter(
    (article) => includeDrafts || isAnswerable(article.status),
  );

  return pool
    .map((article) => ({ article, score: scoreArticle(article, normalizedQuery, tokens) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Pull in articles an admin explicitly linked as `related` to a strong hit.
 * Runs after the keyword ranking so an exact question still wins; this only
 * adds context around it.
 */
function expandWithRelated(
  hits: RetrievedArticle[],
  limit: number,
): RetrievedArticle[] {
  if (hits.length === 0) return hits;

  const byId = new Map<string, KnowledgeArticle>();
  for (const article of getArticles()) byId.set(article.id, article);

  const expanded: RetrievedArticle[] = [...hits];
  const seen = new Set(expanded.map((hit) => hit.article.id));

  for (const hit of hits.slice(0, 2)) {
    for (const relatedId of hit.article.related ?? []) {
      if (seen.has(relatedId)) continue;
      const article = byId.get(relatedId);
      // Only approved neighbours may be shown to the model.
      if (!article || !isAnswerable(article.status)) continue;
      seen.add(relatedId);
      expanded.push({ article, score: hit.score * 0.5 });
    }
  }

  return expanded.slice(0, limit);
}

/** All articles that may be shown to the model as answerable source material. */
export function getApprovedArticles(): KnowledgeArticle[] {
  return getArticles().filter((article) => isAnswerable(article.status));
}

/** True when a topic exists in the knowledge base but is not approved yet. */
export function hasDraftTopic(query: string): boolean {
  return retrieveArticles(query, { limit: 1, includeDrafts: true }).some(
    (hit) => hit.article.status === "draft",
  );
}

/** Diagnostic used by the health endpoint, the admin API and the console. */
export function knowledgeBaseStats() {
  const { articles, issues } = getKnowledgeBase();
  const byCategory: Record<string, number> = {};
  for (const article of articles) {
    byCategory[article.category] = (byCategory[article.category] ?? 0) + 1;
  }
  return {
    total: articles.length,
    published: articles.filter((a) => isAnswerable(a.status)).length,
    draft: articles.filter((a) => a.status === "draft").length,
    archived: articles.filter((a) => a.status === "archived").length,
    byCategory: byCategory as Partial<Record<KnowledgeCategory, number>>,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
  };
}

/**
 * The full picture for a question: what we may answer from, and whether the
 * user is asking about a topic we simply have not documented yet.
 */
export interface QueryClassification {
  approved: RetrievedArticle[];
  drafts: RetrievedArticle[];
  /**
   * True when the question is clearly about a Yene-Store topic whose article
   * exists but has not been approved.
   *
   * This matters more than it looks. Without it, a question like "how do
   * promotions work" would still match a generic approved article (they all
   * mention "support" and "help"), which would let the model treat the
   * question as answerable and drift into inventing promotion rules. When this
   * is true we refuse deterministically instead of asking the model at all.
   */
  topicIsUndocumented: boolean;
}

export function classifyQuery(query: string, limit = 4): QueryClassification {
  // `related` neighbours are added to the approved side only. Drafts are
  // matched on their own keywords so a neighbour can never make an
  // undocumented topic look documented.
  const approved = expandWithRelated(
    retrieveArticles(query, { limit, includeDrafts: false }),
    limit,
  );
  const drafts = retrieveArticles(query, { limit, includeDrafts: true }).filter(
    (hit) => hit.article.status === "draft",
  );

  const topApproved = approved[0]?.score ?? 0;
  const topDraft = drafts[0]?.score ?? 0;

  return {
    approved,
    drafts,
    topicIsUndocumented: topDraft > topApproved,
  };
}


