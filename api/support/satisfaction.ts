import { MAX_SURVEY_COMMENT, MAX_SURVEY_RATING, type ResolutionAnswer } from "../../src/constants";
import {
  findFeedbackForConversation,
  findFeedbackForTicket,
  getConversation,
  saveFeedback,
  type SupportFeedback,
} from "./analyticsStore";
import { getTicketById } from "./ticketStore";
import type { SupportIdentity } from "./types";

/**
 * ============================================================================
 *  CUSTOMER SATISFACTION
 * ============================================================================
 *
 *  The specification asks one question after resolution - "Was your issue
 *  resolved?" - with Yes / Partially / No, plus an optional rating and optional
 *  feedback.
 *
 *  WHEN IT IS ASKED
 *  -----------------
 *  Decided here, on the server, by rule, and only for the conversation's own
 *  customer. The browser is never told "you may now be asked" by a flag it can
 *  set, and a signed-in customer can only ever survey their own conversation.
 *  A prompt is a request; a rule is a control.
 *
 *  Two deterministic triggers, because "after resolution" has two honest
 *  meanings in this product:
 *
 *    1. A HUMAN RESOLVED IT. The conversation's ticket is Resolved or Closed.
 *       This is the primary path and the one the specification describes.
 *
 *    2. THE CUSTOMER SAID SO. They typed a sign-off such as "thanks, that
 *       worked" or "that's all, I sorted it". Without this, an AI-resolved
 *       conversation could never be measured at all - and the AI resolution
 *       rate is the single most important figure Section 7 asks for.
 *
 *  In both cases the survey is offered exactly once. A satisfied customer is
 *  asked once, not on every page load.
 */

/**
 * Phrases meaning the customer considers the matter closed.
 *
 * Deliberately conservative. A false positive asks a customer to rate support
 * they have not finished receiving, which is worse than never asking at all, so
 * only unambiguous sign-offs match.
 */
const RESOLVED_SIGNOFF_PATTERNS: RegExp[] = [
  /\bthat'?s? (it|all|everything|done|perfect|great|working now|worked)\b/i,
  /\bit'?s? working (now|again|perfectly)\b/i,
  /\bit worked\b/i,
  /\bworks? now\b/i,
  /\b(fixed|sorted|resolved|solved)( it)?\b/i,
  /\b(thanks|thank you|appreciate it)\b.{0,40}\b(worked|fixed|helped|solved|resolved)\b/i,
  /\b(thanks|thank you)\b.{0,20}\b(all|that'?s all|perfect)\b/i,
  /\b(you'?re? (great|awesome|perfect)|brilliant|excellent)\b/i,
];

/** True when the customer appears to be closing the conversation. */
export function indicatesResolved(message: string): boolean {
  return RESOLVED_SIGNOFF_PATTERNS.some((pattern) => pattern.test(message));
}

export interface SurveyState {
  /** Show the survey now. */
  show: boolean;
  /** The customer has already answered this conversation. */
  answered: boolean;
  /** The conversation reached a resolution point. */
  resolved: boolean;
}

const RESOLVED_TICKET_STATUSES = ["Resolved", "Closed"];

/**
 * Decide whether to show the survey for one conversation.
 *
 * `identity` is required even though the conversation id is opaque: the
 * conversation is looked up and then checked against the caller, so a signed-in
 * customer cannot survey somebody else's conversation by guessing its id. A
 * mismatch is reported as "no survey" rather than as an error, so this endpoint
 * cannot be used to probe for other people's conversations.
 */
export function getSurveyState(conversationId: string, identity: SupportIdentity): SurveyState {
  const conversation = getConversation(conversationId);
  if (!conversation) return { show: false, answered: false, resolved: false };

  // A conversation recorded for a signed-in customer may only be surveyed by
  // that customer.
  if (conversation.wasAuthenticated && !identity.isAuthenticated) {
    return { show: false, answered: false, resolved: false };
  }

  const answered =
    findFeedbackForConversation(conversationId) !== null ||
    (conversation.ticketId !== null && findFeedbackForTicket(conversation.ticketId) !== null);

  const ticket = conversation.ticketId ? getTicketById(conversation.ticketId) : null;
  const ticketResolved = ticket !== null && RESOLVED_TICKET_STATUSES.includes(ticket.status);

  const resolved = ticketResolved || conversation.customerSignedOff;

  return { show: resolved && !answered, answered, resolved };
}

// ---------------------------------------------------------------------------
// Answer validation
// ---------------------------------------------------------------------------

export interface SurveySubmission {
  resolved: ResolutionAnswer;
  rating: number | null;
  comment: string | null;
}

export type ParseResult =
  | { ok: true; value: SurveySubmission }
  | { ok: false; error: string };

const RESOLUTION_ANSWERS: ResolutionAnswer[] = ["yes", "partially", "no"];

/**
 * Validate what the browser sent.
 *
 * The rating and the comment are genuinely optional, so their absence is a
 * complete answer, not a validation failure. A rating that is present must be
 * a whole number from 1 to 5 - anything else is refused rather than coerced,
 * because a silently clamped 0 would drag the average satisfaction score down
 * on the strength of a malformed request.
 */
export function parseSubmission(body: Record<string, unknown>): ParseResult {
  const resolved = body.resolved;
  if (
    typeof resolved !== "string" ||
    !RESOLUTION_ANSWERS.includes(resolved as ResolutionAnswer)
  ) {
    return { ok: false, error: `Choose one of: ${RESOLUTION_ANSWERS.join(", ")}.` };
  }

  let rating: number | null = null;
  if (body.rating !== undefined && body.rating !== null && body.rating !== "") {
    const value = Number(body.rating);
    if (!Number.isInteger(value) || value < 1 || value > MAX_SURVEY_RATING) {
      return {
        ok: false,
        error: `A rating must be a whole number from 1 to ${MAX_SURVEY_RATING}.`,
      };
    }
    rating = value;
  }

  const rawComment = typeof body.comment === "string" ? body.comment.trim() : "";
  const comment = rawComment ? rawComment.slice(0, MAX_SURVEY_COMMENT) : null;

  return { ok: true, value: { resolved: resolved as ResolutionAnswer, rating, comment } };
}

/**
 * Record an answer against a conversation the caller owns.
 *
 * Returns null when the conversation is unknown, which is the caller's signal
 * that there was nothing to attach the answer to.
 */
export function submitFeedback(
  conversationId: string,
  identity: SupportIdentity,
  submission: SurveySubmission,
): SupportFeedback | null {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;

  // A conversation recorded for a signed-in customer may only be surveyed by
  // that customer.
  if (conversation.wasAuthenticated && !identity.isAuthenticated) return null;

  return saveFeedback({
    conversationId,
    ticketId: conversation.ticketId,
    resolved: submission.resolved,
    rating: submission.rating,
    comment: submission.comment,
  });
}

