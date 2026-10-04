import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection, type JsonCollection } from "../lib/jsonCollection";
import { detectIntent } from "./escalation";
import { questionFingerprint, redactCustomerText } from "./privacy";
import type { QuickActionCategory } from "../../src/constants";
import type { EscalationReason, SupportIntent } from "./types";

/**
 * ============================================================================
 *  SUPPORT ANALYTICS STORE
 * ============================================================================
 *
 *  Section 7 needs history: a rate, a duration and a "most common" list are
 *  meaningless over a single request. So conversation outcomes, satisfaction
 *  answers and knowledge-gap decisions are written to disk through the same
 *  durable JSON collection the ticket and live-chat stores use - atomic writes,
 *  coalesced, and a corrupt file reported rather than fatal.
 *
 *  WHAT IS DELIBERATELY NOT HERE
 *  -----------------------------
 *  No customer name, email, phone number, user id or business id. See
 *  `privacy.ts` for the full argument; the short version is that aggregate
 *  reporting has no use for an identity, and storing one would make this file
 *  as sensitive as the ticket store next to it.
 *
 *  WHY THE RECORDS ARE DERIVED, NOT RAW
 *  ------------------------------------
 *  A turn is stored already classified - category, intent, grounding, sources.
 *  Aggregation then never has to re-run the model, re-detect intent or re-run
 *  redaction over historical text, so a fix to any of those improves past data
 *  retroactively for everything not already stored as a label.
 *
 *  TODO(production): replace with a real database before running multiple
 *  instances. As with the ticket store, the exported functions are the seam.
 */

/** One customer question and what the assistant was able to do with it. */
export interface ConversationTurn {
  /** Redacted, truncated customer question. Never the raw text. */
  question: string;
  /** Stable grouping key - see `questionFingerprint`. */
  fingerprint: string;
  at: string;
  category: QuickActionCategory;
  /** Best guess at the customer's goal, from the deterministic detector. */
  intent: SupportIntent;
  /** True only when the reply was fully sourced from an approved article. */
  grounded: boolean;
  /** Article ids actually cited in the reply the customer saw. */
  sourceIds: string[];
  escalationReasons: EscalationReason[];
  /** The customer signed off ("thanks, that worked"). */
  customerSignedOff: boolean;
}

/** Everything analytics needs to know about one conversation. */
export interface SupportConversation {
  conversationId: string;
  startedAt: string;
  updatedAt: string;
  turns: ConversationTurn[];
  /** A human took the conversation over. */
  escalatedToHuman: boolean;
  escalationReasons: EscalationReason[];
  /** Pseudonymous reference, so staff can jump to the ticket. Never identity. */
  ticketId: string | null;
  /** Whether the visitor was signed in. No id, because an id is identity. */
  wasAuthenticated: boolean;
  customerSignedOff: boolean;
}

export interface RecordTurnInput {
  conversationId: string;
  /** Raw customer message. Redacted here, before it touches disk. */
  question: string;
  category: QuickActionCategory;
  grounded: boolean;
  sourceIds: string[];
  escalationReasons: EscalationReason[];
  customerSignedOff: boolean;
  wasAuthenticated: boolean;
}

export interface SupportFeedback {
  id: string;
  conversationId: string | null;
  ticketId: string | null;
  resolved: "yes" | "partially" | "no";
  /** 1..5, or null when the customer chose not to rate. */
  rating: number | null;
  /** Redacted, truncated. Null when the customer left it blank. */
  comment: string | null;
  at: string;
}

export interface FeedbackInput {
  conversationId: string | null;
  ticketId: string | null;
  resolved: "yes" | "partially" | "no";
  rating: number | null;
  /** Raw comment. Redacted here, before it touches disk. */
  comment: string | null;
}

/** What an administrator decided to do about a knowledge gap. */
export interface KnowledgeGapAction {
  fingerprint: string;
  action: "planned" | "dismissed" | "published";
  note: string;
  by: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Where the analytics files live.
 *
 * `YENE_DATA_DIR` exists so the verification suite can point at a temporary
 * directory. Without it, running the tests would append fixture conversations
 * to real reporting data - the same complaint you would have about a test
 * suite that wrote to the production database.
 */
function dataDir(): string {
  return process.env.YENE_DATA_DIR
    ? path.resolve(process.env.YENE_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

let conversations: JsonCollection<SupportConversation> | null = null;
let feedback: JsonCollection<SupportFeedback> | null = null;
let gapActions: JsonCollection<KnowledgeGapAction> | null = null;

function conversationStore(): JsonCollection<SupportConversation> {
  conversations ??= createJsonCollection<SupportConversation>(
    path.join(dataDir(), "support-conversations.json"),
    "conversation-analytics",
    20000,
  );
  return conversations;
}

function feedbackStore(): JsonCollection<SupportFeedback> {
  feedback ??= createJsonCollection<SupportFeedback>(
    path.join(dataDir(), "support-feedback.json"),
    "satisfaction-analytics",
    20000,
  );
  return feedback;
}

function gapActionStore(): JsonCollection<KnowledgeGapAction> {
  gapActions ??= createJsonCollection<KnowledgeGapAction>(
    path.join(dataDir(), "support-knowledge-gaps.json"),
    "knowledge-gap-actions",
    5000,
  );
  return gapActions;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export function allConversations(): SupportConversation[] {
  return conversationStore().all();
}

export function getConversation(conversationId: string): SupportConversation | null {
  return conversationStore().all().find((c) => c.conversationId === conversationId) ?? null;
}

/**
 * Append one turn, creating the conversation if this is the first question.
 *
 * Recording never throws and never blocks the customer's reply. Analytics that
 * is important enough to fail a support request on is not analytics any more,
 * so a write problem is logged and the conversation continues.
 */
export function recordTurn(input: RecordTurnInput): SupportConversation | null {
  try {
    const store = conversationStore();
    const at = nowIso();
    const list = store.all();

    let conversation = list.find((c) => c.conversationId === input.conversationId);

    if (!conversation) {
      conversation = {
        conversationId: input.conversationId,
        startedAt: at,
        updatedAt: at,
        turns: [],
        escalatedToHuman: false,
        escalationReasons: [],
        ticketId: null,
        wasAuthenticated: input.wasAuthenticated,
        customerSignedOff: false,
      };
      list.push(conversation);
    }

    conversation.turns.push({
      // Redaction happens on the way IN, so no reporting bug can later publish
      // the raw sentence.
      question: redactCustomerText(input.question),
      fingerprint: questionFingerprint(input.question),
      at,
      category: input.category,
      intent: detectIntent(input.question),
      grounded: input.grounded,
      sourceIds: [...new Set(input.sourceIds)],
      escalationReasons: [...new Set(input.escalationReasons)],
      customerSignedOff: input.customerSignedOff,
    });

    // The reasons are kept for the "why did this need a human" breakdown, but
    // they do NOT set `escalatedToHuman`.
    //
    // Offering a human is not escalating to one. The assistant offers on every
    // ungrounded answer, and most customers never take it up; counting the
    // offer would report an escalation rate near 100% for a perfectly healthy
    // assistant. `markEscalated` is the only thing that sets the flag, because
    // only a real handoff means a person was actually involved.
    conversation.escalationReasons = [
      ...new Set([...conversation.escalationReasons, ...input.escalationReasons]),
    ];
    if (input.customerSignedOff) conversation.customerSignedOff = true;
    conversation.wasAuthenticated = conversation.wasAuthenticated || input.wasAuthenticated;
    conversation.updatedAt = at;

    store.touch();
    return conversation;
  } catch (error) {
    console.error("[analytics] could not record the conversation turn:", error);
    return null;
  }
}

/** Flag a conversation as handed to a human, and attach the ticket reference. */
export function markEscalated(
  conversationId: string,
  reasons: EscalationReason[],
  ticketId: string | null = null,
): void {
  try {
    const conversation = getConversation(conversationId);
    // A handoff can happen before any AI turn was recorded (the customer went
    // straight to "Talk to a Human"). Create the record so the escalation is
    // still counted rather than silently lost.
    const target =
      conversation ??
      recordTurn({
        conversationId,
        question: "",
        category: "contact",
        grounded: false,
        sourceIds: [],
        escalationReasons: reasons,
        customerSignedOff: false,
        wasAuthenticated: false,
      });
    if (!target) return;

    target.escalatedToHuman = true;
    target.escalationReasons = [...new Set([...target.escalationReasons, ...reasons])];
    if (ticketId) target.ticketId = ticketId;
    target.updatedAt = nowIso();
    conversationStore().touch();
  } catch (error) {
    console.error("[analytics] could not record the escalation:", error);
  }
}

// ---------------------------------------------------------------------------
// Customer satisfaction
// ---------------------------------------------------------------------------

export function allFeedback(): SupportFeedback[] {
  return feedbackStore().all();
}

/** Has this conversation already been surveyed? The survey is asked once. */
export function findFeedbackForConversation(conversationId: string): SupportFeedback | null {
  return allFeedback().find((entry) => entry.conversationId === conversationId) ?? null;
}

export function findFeedbackForTicket(ticketId: string): SupportFeedback | null {
  return allFeedback().find((entry) => entry.ticketId === ticketId) ?? null;
}

/**
 * Store one satisfaction answer.
 *
 * Replaces any earlier answer for the same conversation or ticket, so a
 * customer who changes their mind is recorded once with their final answer
 * rather than twice with a split that makes the resolution rate meaningless.
 */
export function saveFeedback(input: FeedbackInput): SupportFeedback {
  const store = feedbackStore();
  const list = store.all();

  const existing =
    (input.conversationId ? findFeedbackForConversation(input.conversationId) : null) ??
    (input.ticketId ? findFeedbackForTicket(input.ticketId) : null);

  const record: SupportFeedback = {
    id: existing?.id ?? randomBytes(6).toString("hex"),
    conversationId: input.conversationId,
    ticketId: input.ticketId,
    resolved: input.resolved,
    rating: input.rating,
    // Truncated and stripped, exactly like a question.
    comment: input.comment ? redactCustomerText(input.comment, 1000) : null,
    at: nowIso(),
  };

  if (existing) {
    Object.assign(existing, record);
  } else {
    list.push(record);
  }

  store.touch();
  return record;
}

// ---------------------------------------------------------------------------
// Knowledge gap decisions
// ---------------------------------------------------------------------------

export function allGapActions(): KnowledgeGapAction[] {
  return gapActionStore().all();
}

/** The most recent decision recorded for a gap, if any. */
export function findGapAction(fingerprint: string): KnowledgeGapAction | null {
  const actions = allGapActions().filter((entry) => entry.fingerprint === fingerprint);
  return actions.length ? actions[actions.length - 1] : null;
}

export function saveGapAction(
  fingerprint: string,
  action: KnowledgeGapAction["action"],
  by: string,
  note = "",
): KnowledgeGapAction {
  const store = gapActionStore();
  const record: KnowledgeGapAction = {
    fingerprint,
    action,
    note: note.slice(0, 500),
    by,
    at: nowIso(),
  };
  store.all().push(record);
  store.touch();
  return record;
}

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

/** Remove every record. Used by the verification suite to start from zero. */
export function clearAll(): void {
  conversationStore().all().length = 0;
  feedbackStore().all().length = 0;
  gapActionStore().all().length = 0;
  conversationStore().flush();
  feedbackStore().flush();
  gapActionStore().flush();
}

