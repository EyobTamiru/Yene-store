import { CATEGORY_LABELS, type KnowledgeCategory } from "../../src/knowledge/types";
import type { QuickActionCategory } from "../../src/constants";
import { getArticle } from "../../src/knowledge/repository";
import { retrieveArticles } from "../../src/knowledge/retrieval";
import { REASON_LABELS } from "./intents";
import { allConversations, allFeedback, findGapAction } from "./analyticsStore";
import { allTickets } from "./ticketStore";
import type { ConversationTurn, SupportConversation } from "./analyticsStore";
import type { TicketStatus } from "./types";

/**
 * ============================================================================
 *  SUPPORT ANALYTICS
 * ============================================================================
 *
 *  Read-side aggregation for Section 7. Every figure the specification asks
 *  for is computed here from the conversation, ticket and feedback stores, and
 *  this is the only module that shapes the analytics payload.
 *
 *  Three decisions worth stating up front, because each one is a judgement
 *  call that changes what the numbers mean.
 *
 *  1. "AI-RESOLVED" IS DEFINED PER CONVERSATION, NOT PER REPLY.
 *     A conversation counts as AI-resolved when the assistant produced at least
 *     one grounded answer AND the conversation was never escalated. A grounded
 *     reply that the customer ignored still counts against the AI, and a
 *     conversation the AI half-answered before a human took over is counted as
 *     an escalation rather than quietly credited to the AI.
 *
 *  2. A DELIBERATE REFUSAL IS NOT A KNOWLEDGE GAP.
 *     Account security and payment disputes suppress the automated answer on
 *     purpose - the product rule is that a human handles them. Counting those
 *     turns as gaps would tell an administrator to write knowledge articles
 *     explaining how to handle a suspected account compromise, which is
 *     actively the wrong instruction. They are excluded, and the count of them
 *     is published in the report so the exclusion is visible rather than a
 *     silent hole in the numbers.
 *
 *  3. NOTHING WITHOUT A DENOMINATOR IS A PERCENTAGE.
 *     Every rate is null - rendered as "-" - when it cannot be computed, rather
 *     than defaulting to 0%. An escalation rate of 0% on a day with no
 *     conversations is a false claim that the AI is performing perfectly, and
 *     it is exactly the reading a manager would act on.
 */

export interface AnalyticsRange {
  /** 0 means all recorded history. */
  days: number;
  since: string | null;
}

export function resolveRange(days: number): AnalyticsRange {
  const clean = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  if (clean === 0) return { days: 0, since: null };
  const since = new Date(Date.now() - clean * 24 * 60 * 60 * 1000);
  return { days: clean, since: since.toISOString() };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function inRange(iso: string | null, since: string | null): boolean {
  if (!since) return true;
  if (!iso) return false;
  return new Date(iso).getTime() >= new Date(since).getTime();
}

/** Percentage of part out of total, or null when total is zero. */
function percent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

export interface NamedCount {
  key: string;
  label: string;
  count: number;
}

/** Rank a count map, highest first, with a stable tie-break on the key. */
function rank(
  counts: Map<string, number>,
  label: (key: string) => string,
  limit = 12,
): NamedCount[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: label(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Was this turn a deliberate, correct refusal rather than a gap? */
function isDeliberateRefusal(turn: ConversationTurn): boolean {
  return (
    turn.escalationReasons.includes("account-security") ||
    turn.escalationReasons.includes("payment-dispute")
  );
}

function conversationsIn(range: AnalyticsRange): SupportConversation[] {
  return allConversations().filter((conversation) =>
    inRange(conversation.updatedAt, range.since),
  );
}

function turnsOf(conversations: SupportConversation[]): ConversationTurn[] {
  return conversations.flatMap((conversation) => conversation.turns);
}

// ---------------------------------------------------------------------------
// AI metrics
// ---------------------------------------------------------------------------

export interface QuestionSummary {
  fingerprint: string;
  /** Redacted, representative phrasing of the question. */
  question: string;
  /** How many times it was asked. */
  occurrences: number;
  /** How many separate conversations it appeared in. */
  conversations: number;
  /** Times the assistant could answer it from an approved article. */
  answered: number;
  /** Times it led to a human. */
  escalated: number;
}

export interface ArticleUsage {
  id: string;
  title: string;
  category: KnowledgeCategory;
  /** Known: false when the article has since been removed. */
  known: boolean;
  timesUsed: number;
  /** Conversations the article appeared in. */
  conversations: number;
}

export interface AiMetrics {
  totalConversations: number;
  aiResolvedConversations: number;
  humanEscalations: number;
  /**
   * Conversations where a human was OFFERED, whether or not it was taken up.
   * Always >= humanEscalations. The gap between the two is the number of
   * customers the AI referred who chose to carry on with the assistant.
   */
  humanOffered: number;
  unresolvedConversations: number;
  /** Escalations as a percentage of conversations. Null when none occurred. */
  escalationRatePercent: number | null;
  /** Mean customer turns per conversation. */
  averageConversationLength: number | null;
  totalTurns: number;
  /** Turns answered from an approved article, as a percentage of all turns. */
  groundedTurnRatePercent: number | null;
  /** The most common kinds of problem, by detected intent. */
  commonProblems: NamedCount[];
  /** Topic breakdown by knowledge category. */
  byCategory: NamedCount[];
  /** The questions customers ask most often. */
  frequentQuestions: QuestionSummary[];
  /** The knowledge articles actually used to answer. */
  articleUsage: ArticleUsage[];
  escalationReasons: NamedCount[];
}

export function computeAiMetrics(range: AnalyticsRange): AiMetrics {
  const conversations = conversationsIn(range);
  const turns = turnsOf(conversations);

  let aiResolved = 0;
  let escalated = 0;
  let unresolved = 0;
  let offered = 0;

  for (const conversation of conversations) {
    const answered = conversation.turns.some((turn) => turn.grounded);
    if (conversation.escalatedToHuman) escalated += 1;
    // Resolved by the AI: it produced a grounded answer and a human was never
    // needed. See decision (1) in the file header.
    if (answered && !conversation.escalatedToHuman) aiResolved += 1;
    // Unresolved: the assistant never produced a single grounded answer.
    if (!answered) unresolved += 1;
    // Offered: the assistant suggested a human at least once, whether or not
    // the customer took it up. Reported separately so an offer-heavy assistant
    // is distinguishable from one that actually routes people to agents.
    if (conversation.escalationReasons.length > 0) offered += 1;
  }

  const groundedTurns = turns.filter((turn) => turn.grounded).length;

  // --- Frequently asked questions, grouped by fingerprint ------------------
  const questions = new Map<string, QuestionSummary & { conversationIds: Set<string> }>();
  for (const conversation of conversations) {
    for (const turn of conversation.turns) {
      if (!turn.question) continue;
      let entry = questions.get(turn.fingerprint);
      if (!entry) {
        entry = {
          fingerprint: turn.fingerprint,
          question: turn.question,
          occurrences: 0,
          conversations: 0,
          answered: 0,
          escalated: 0,
          conversationIds: new Set<string>(),
        };
        questions.set(turn.fingerprint, entry);
      }
      entry.occurrences += 1;
      entry.answered += turn.grounded ? 1 : 0;
      entry.escalated += turn.escalationReasons.length > 0 ? 1 : 0;
      entry.conversationIds.add(conversation.conversationId);
    }
  }

  const frequentQuestions: QuestionSummary[] = [...questions.values()]
    .map(({ conversationIds, ...rest }) => ({ ...rest, conversations: conversationIds.size }))
    .sort((a, b) => b.occurrences - a.occurrences || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 15);


  // --- Knowledge articles used ---------------------------------------------
  // A count of how often an article was actually cited in a reply the customer
  // saw, which is the only honest measure of "used": an article retrieved but
  // not cited contributed nothing to the answer.
  const usage = new Map<string, { timesUsed: number; conversations: Set<string> }>();
  for (const conversation of conversations) {
    for (const turn of conversation.turns) {
      for (const id of turn.sourceIds) {
        const entry = usage.get(id) ?? { timesUsed: 0, conversations: new Set<string>() };
        entry.timesUsed += 1;
        entry.conversations.add(conversation.conversationId);
        usage.set(id, entry);
      }
    }
  }

  const articleUsage: ArticleUsage[] = [...usage.entries()]
    .map(([id, entry]) => {
      const article = getArticle(id);
      return {
        id,
        // A removed article still has usage history, so fall back rather than
        // dropping the row and under-reporting the total.
        title: article?.title ?? `${id} (removed)`,
        category: article?.category ?? "platform",
        known: article !== undefined,
        timesUsed: entry.timesUsed,
        conversations: entry.conversations.size,
      };
    })
    .sort((a, b) => b.timesUsed - a.timesUsed || a.id.localeCompare(b.id))
    .slice(0, 15);

  return {
    totalConversations: conversations.length,
    aiResolvedConversations: aiResolved,
    humanEscalations: escalated,
    humanOffered: offered,
    unresolvedConversations: unresolved,
    escalationRatePercent: percent(escalated, conversations.length),
    averageConversationLength: average(conversations.map((c) => c.turns.length)),
    totalTurns: turns.length,
    groundedTurnRatePercent: percent(groundedTurns, turns.length),
    commonProblems: rank(
      countBy(turns.map((turn) => turn.intent)),
      (key) => key.replace(/-/g, " "),
    ),
    byCategory: rank(
      countBy(turns.map((turn) => turn.category)),
      (key) => CATEGORY_LABELS[key as KnowledgeCategory] ?? key,
    ),
    frequentQuestions,
    articleUsage,
    escalationReasons: rank(
      countBy(conversations.flatMap((c) => c.escalationReasons)),
      (key) => REASON_LABELS[key as keyof typeof REASON_LABELS] ?? key,
    ),
  };
}


// ---------------------------------------------------------------------------
// Human support metrics
// ---------------------------------------------------------------------------

const OPEN_STATUSES: TicketStatus[] = [
  "Open",
  "In Progress",
  "Waiting for Customer",
  "Waiting for Internal Team",
];

export interface HumanMetrics {
  ticketsCreated: number;
  ticketsResolved: number;
  openTickets: number;
  /** Tickets that reached a resolved or closed state at least once. */
  ticketsClosed: number;
  /** Tickets an agent reopened after resolving. */
  reopenedTickets: number;
  /** Reopened as a percentage of all tickets. Null when there are none. */
  reopenRatePercent: number | null;
  /** Minutes from creation to the first agent action. */
  averageFirstResponseMinutes: number | null;
  /** Minutes from creation to resolution. */
  averageResolutionMinutes: number | null;
  /** Of the tickets, the share that reached a resolved or closed state. */
  resolutionRatePercent: number | null;
  byCategory: NamedCount[];
  byPackage: NamedCount[];
  byBusiness: NamedCount[];
  byPriority: NamedCount[];
  byStatus: NamedCount[];
}

function minutesBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const value = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
  // A clock change or a hand-edited record can produce a negative span. Report
  // it as absent rather than letting it drag the average below zero.
  return value < 0 ? null : value;
}

export function computeHumanMetrics(range: AnalyticsRange): HumanMetrics {
  const tickets = allTickets().filter((ticket) => inRange(ticket.createdAt, range.since));

  const firstResponse: number[] = [];
  const resolution: number[] = [];
  let reopened = 0;
  let closed = 0;

  for (const ticket of tickets) {
    const response = minutesBetween(ticket.createdAt, ticket.firstResponseAt);
    if (response !== null) firstResponse.push(response);

    const resolved = minutesBetween(ticket.createdAt, ticket.resolvedAt);
    if (resolved !== null) resolution.push(resolved);

    // A ticket counts as reopened only if a "reopened" event exists, which is
    // written by the resolve/reopen routes. Relying on the event rather than on
    // a status comparison means a resolved-then-reopened-then-resolved ticket
    // is counted once, not twice.
    if (ticket.events.some((event) => event.type === "reopened")) reopened += 1;
    if (ticket.resolvedAt || ticket.status === "Closed") closed += 1;
  }

  return {
    ticketsCreated: tickets.length,
    ticketsResolved: tickets.filter((ticket) => ticket.resolvedAt !== null).length,
    openTickets: tickets.filter((ticket) => OPEN_STATUSES.includes(ticket.status)).length,
    ticketsClosed: closed,
    reopenedTickets: reopened,
    reopenRatePercent: percent(reopened, tickets.length),
    averageFirstResponseMinutes: average(firstResponse),
    averageResolutionMinutes: average(resolution),
    resolutionRatePercent: percent(closed, tickets.length),
    byCategory: rank(countBy(tickets.map((t) => t.category)), (key) => key),
    byPackage: rank(countBy(tickets.map((t) => t.packageName)), (key) => key),
    // Business names are retained by design: this breakdown is required, and a
    // business is a counterparty rather than an individual. See privacy.ts.
    byBusiness: rank(countBy(tickets.map((t) => t.businessName)), (key) => key, 15),
    byPriority: rank(countBy(tickets.map((t) => t.priority)), (key) => key),
    byStatus: rank(countBy(tickets.map((t) => t.status)), (key) => key),
  };
}


// ---------------------------------------------------------------------------
// Customer satisfaction
// ---------------------------------------------------------------------------

export interface SatisfactionFeedback {
  id: string;
  /** Pseudonymous reference so staff can find the conversation. */
  ticketId: string | null;
  resolved: "yes" | "partially" | "no";
  rating: number | null;
  /** Redacted comment. Null when the customer left it blank. */
  comment: string | null;
  at: string;
}

export interface SatisfactionMetrics {
  responses: number;
  yes: number;
  partially: number;
  no: number;
  /** Share answering "Yes". Null until somebody has answered. */
  resolutionRatePercent: number | null;
  /** Share answering "Yes" or "Partially". */
  fullOrPartialRatePercent: number | null;
  ratingsGiven: number;
  /** Mean of the 1-5 ratings. Null when nobody rated. */
  averageRating: number | null;
  ratingDistribution: { rating: number; count: number }[];
  comments: SatisfactionFeedback[];
}

export function computeSatisfactionMetrics(range: AnalyticsRange): SatisfactionMetrics {
  const entries = allFeedback()
    .filter((entry) => inRange(entry.at, range.since))
    .sort((a, b) => b.at.localeCompare(a.at));

  const yes = entries.filter((entry) => entry.resolved === "yes").length;
  const partially = entries.filter((entry) => entry.resolved === "partially").length;
  const no = entries.filter((entry) => entry.resolved === "no").length;
  const ratings = entries
    .map((entry) => entry.rating)
    .filter((rating): rating is number => typeof rating === "number");

  return {
    responses: entries.length,
    yes,
    partially,
    no,
    resolutionRatePercent: percent(yes, entries.length),
    fullOrPartialRatePercent: percent(yes + partially, entries.length),
    ratingsGiven: ratings.length,
    averageRating: average(ratings),
    ratingDistribution: [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: ratings.filter((value) => value === rating).length,
    })),
    comments: entries
      .filter((entry) => entry.comment)
      .slice(0, 25)
      .map((entry) => ({
        id: entry.id,
        ticketId: entry.ticketId,
        resolved: entry.resolved,
        rating: entry.rating,
        comment: entry.comment,
        at: entry.at,
      })),
  };
}


// ---------------------------------------------------------------------------
// Knowledge gaps
// ---------------------------------------------------------------------------

export type GapStatus = "open" | "planned" | "dismissed" | "published";

export interface KnowledgeGap {
  fingerprint: string;
  /** Redacted, representative phrasing. This is what an admin acts on. */
  question: string;
  occurrences: number;
  conversations: number;
  category: QuickActionCategory;
  intent: string;
  firstAskedAt: string;
  lastAskedAt: string;
  /** Where an administrator should put the new article. */
  suggestedCategory: KnowledgeCategory;
  suggestedArticleId: string;
  /** Articles that already partly cover this, so an admin extends rather than duplicates. */
  relatedArticles: { id: string; title: string; status: string }[];
  status: GapStatus;
  note: string;
  /** Set by an administrator, for audit. */
  decidedBy: string | null;
  decidedAt: string | null;
}

/**
 * Turn an unresolved question into a concrete instruction.
 *
 * The specification's example is "Users frequently ask how to connect their
 * Facebook page", and the whole point of the list is that somebody can act on
 * it by opening the knowledge base. A bare fingerprint would not be actionable,
 * so a gap proposes a category and an article id, and lists any existing
 * article that already partially covers the question.
 */
function suggestArticleId(question: string, category: KnowledgeCategory): string {
  const words = question
    .toLowerCase()
    // Drop the redaction placeholders, so "[email removed]" cannot become part
    // of an article slug.
    .replace(/\[[a-z ]+\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
  return words.length ? words.join("-") : `new-${category}-article`;
}

export function computeKnowledgeGaps(range: AnalyticsRange): KnowledgeGap[] {
  const conversations = conversationsIn(range);
  const grouped = new Map<
    string,
    {
      question: string;
      occurrences: number;
      conversations: Set<string>;
      category: QuickActionCategory;
      intent: string;
      firstAskedAt: string;
      lastAskedAt: string;
    }
  >();

  for (const conversation of conversations) {
    for (const turn of conversation.turns) {
      // Three exclusions, each deliberate:
      //  - grounded: the assistant answered it, so it is not a gap.
      //  - deliberate refusal: refusing is the specified behaviour for security
      //    and payment disputes. Writing an article about them would be wrong.
      //  - empty question: a synthetic record created by a handoff with no AI
      //    turn behind it. There is no question to fill in.
      if (turn.grounded || isDeliberateRefusal(turn) || !turn.question) continue;

      let entry = grouped.get(turn.fingerprint);
      if (!entry) {
        entry = {
          question: turn.question,
          occurrences: 0,
          conversations: new Set<string>(),
          category: turn.category,
          intent: turn.intent,
          firstAskedAt: turn.at,
          lastAskedAt: turn.at,
        };
        grouped.set(turn.fingerprint, entry);
      }
      entry.occurrences += 1;
      entry.conversations.add(conversation.conversationId);
      if (turn.at < entry.firstAskedAt) entry.firstAskedAt = turn.at;
      if (turn.at > entry.lastAskedAt) entry.lastAskedAt = turn.at;
    }
  }

  return [...grouped.entries()]
    .map(([fingerprint, entry]) => {
      const action = findGapAction(fingerprint);
      // A question asked in the `contact` category usually belongs with the
      // platform/support material rather than becoming a "Contact Information"
      // article, which already exists and is the wrong destination for it.
      const suggestedCategory: KnowledgeCategory =
        entry.category === "contact" ? "platform" : (entry.category as KnowledgeCategory);

      return {
        fingerprint,
        question: entry.question,
        occurrences: entry.occurrences,
        conversations: entry.conversations.size,
        category: entry.category,
        intent: entry.intent,
        firstAskedAt: entry.firstAskedAt,
        lastAskedAt: entry.lastAskedAt,
        suggestedCategory,
        suggestedArticleId: suggestArticleId(entry.question, suggestedCategory),
        relatedArticles: retrieveArticles(entry.question, { limit: 3, includeDrafts: true }).map(
          (hit) => ({
            id: hit.article.id,
            title: hit.article.title,
            status: hit.article.status,
          }),
        ),
        status: (action?.action ?? "open") as GapStatus,
        note: action?.note ?? "",
        decidedBy: action?.by ?? null,
        decidedAt: action?.at ?? null,
      } satisfies KnowledgeGap;
    })
    .sort(
      (a, b) => b.occurrences - a.occurrences || b.lastAskedAt.localeCompare(a.lastAskedAt),
    )
    .slice(0, 25);
}


// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface AnalyticsReport {
  generatedAt: string;
  range: AnalyticsRange;
  ai: AiMetrics;
  human: HumanMetrics;
  satisfaction: SatisfactionMetrics;
  knowledgeGaps: KnowledgeGap[];
  /** Reminds the UI, and the reviewer, what the payload deliberately omits. */
  privacy: {
    note: string;
    /** Count of deliberately-refused turns, excluded from the gap list. */
    deliberateRefusals: number;
  };
}

/**
 * Build the whole Section 7 payload.
 *
 * This is the only function that produces analytics for the API, so the
 * privacy contract has exactly one place to hold. `verify-analytics.ts` scans
 * the serialised result for forbidden keys to prove it.
 */
export function buildAnalyticsReport(days: number): AnalyticsReport {
  const range = resolveRange(days);
  const conversations = conversationsIn(range);
  const turns = turnsOf(conversations);

  return {
    generatedAt: new Date().toISOString(),
    range,
    ai: computeAiMetrics(range),
    human: computeHumanMetrics(range),
    satisfaction: computeSatisfactionMetrics(range),
    knowledgeGaps: computeKnowledgeGaps(range),
    privacy: {
      note: "Aggregate only. No customer names, contact details, user ids or conversation text appear in this report.",
      deliberateRefusals: turns.filter(isDeliberateRefusal).length,
    },
  };
}

