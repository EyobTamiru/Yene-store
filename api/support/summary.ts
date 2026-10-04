import { intentGoal, intentNextSteps, REASON_LABELS } from "./intents";
import type {
  ChatTurn,
  EscalationDecision,
  HandoffSummary,
  SupportAccountContext,
  SupportIdentity,
} from "./types";

/**
 * ============================================================================
 *  AI HANDOFF SUMMARY
 * ============================================================================
 *
 *  The internal brief attached to a support ticket. It must let an agent pick
 *  the conversation up cold, without the customer repeating anything.
 *
 *  It contains six things, per the specification:
 *    1. the customer's problem
 *    2. what the customer is trying to accomplish
 *    3. relevant account information
 *    4. what the assistant already tried
 *    5. the relevant conversation messages
 *    6. a suggested next investigation
 *
 *  WHY THIS IS BUILT DETERMINISTICALLY
 *  -----------------------------------
 *  The summary is assembled from facts the server already holds - the
 *  transcript, the verified identity, the account facts and which knowledge
 *  articles were cited. It is never written by the model.
 *
 *  That is a deliberate safety property, not an implementation shortcut: no
 *  model reasoning, no internal deliberation and no chain of thought can be
 *  included, because none of it is ever available to this function. An agent
 *  gets what happened, never why the assistant thought it happened.
 */

const MAX_PROBLEM_LENGTH = 300;
const MAX_RELEVANT_MESSAGES = 8;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The customer's own words are the most reliable problem statement there is. */
function customerProblem(transcript: ChatTurn[], latestMessage: string): string {
  const userMessages = transcript.filter((turn) => turn.role === "user");
  if (userMessages.length === 0) return truncate(latestMessage, MAX_PROBLEM_LENGTH);

  const lastUser = userMessages[userMessages.length - 1]?.content ?? latestMessage;
  if (userMessages.length === 1) return truncate(lastUser, MAX_PROBLEM_LENGTH);

  const earlier = userMessages[userMessages.length - 2].content;
  return truncate(
    `${earlier} (follow-up) — most recent: ${lastUser}`,
    MAX_PROBLEM_LENGTH,
  );
}

/**
 * What the assistant actually did, stated as observable actions.
 * No reasoning, no confidence, no internal deliberation.
 */
function alreadyTried(input: {
  grounded: boolean;
  citedArticles: string[];
  offeredHuman: boolean;
  turnCount: number;
  askedClarification: boolean;
}): string[] {
  const actions: string[] = [];

  if (input.grounded && input.citedArticles.length > 0) {
    actions.push(`Answered from the knowledge base: ${input.citedArticles.join(", ")}`);
  } else {
    actions.push("No confirmed answer was available in the knowledge base for this question");
  }

  if (input.askedClarification) actions.push("Asked the customer a clarifying question");
  if (input.offeredHuman) actions.push("Offered a connection to a human agent");
  actions.push(`Customer has sent ${input.turnCount} message(s) in this conversation`);

  return actions;
}

function accountInformation(
  identity: SupportIdentity,
  account: SupportAccountContext,
): string[] {
  const lines: string[] = [];

  if (identity.isAuthenticated) {
    lines.push(`Signed in as: ${identity.displayName ?? "user"} (role: ${identity.role})`);
    lines.push(`User ID: ${identity.userId}`);
    if (identity.businessId) {
      lines.push(`Business: ${account.businessName ?? identity.businessId}`);
    }
    if (account.packageName) lines.push(`Package: ${account.packageName}`);
    if (account.subscriptionStatus) lines.push(`Subscription: ${account.subscriptionStatus}`);
    for (const fact of account.facts) lines.push(fact);
  } else {
    lines.push("Customer is not signed in - no account data was available or read");
  }

  return lines;
}

export interface BuildSummaryInput {
  identity: SupportIdentity;
  account: SupportAccountContext;
  /** Full conversation, oldest first, ending with the latest customer message. */
  transcript: ChatTurn[];
  escalation: EscalationDecision;
  grounded: boolean;
  citedArticleIds: string[];
  offeredHuman: boolean;
  askedClarification: boolean;
}

export function buildHandoffSummary(input: BuildSummaryInput): HandoffSummary {
  const {
    identity, account, transcript, escalation,
    grounded, citedArticleIds, offeredHuman, askedClarification,
  } = input;

  return {
    customerProblem: customerProblem(
      transcript,
      transcript[transcript.length - 1]?.content ?? "",
    ),
    customerGoal: intentGoal(escalation.intent),
    accountInformation: accountInformation(identity, account),
    alreadyTried: alreadyTried({
      grounded,
      citedArticles: citedArticleIds,
      offeredHuman,
      turnCount: transcript.filter((turn) => turn.role === "user").length,
      askedClarification,
    }),
    relevantMessages: transcript.slice(-MAX_RELEVANT_MESSAGES).map((turn) => ({
      role: turn.role,
      content: truncate(turn.content, 500),
    })),
    suggestedNextSteps: [
      ...intentNextSteps(escalation.intent),
      `Escalation reason(s): ${escalation.reasons.map((r) => REASON_LABELS[r]).join("; ")}`,
    ],
  };
}

/** Plain-text rendering sent to the support team. */
export function formatSummaryForTicket(ticketId: string, summary: HandoffSummary): string {
  return [
    `Ticket: ${ticketId}`,
    ``,
    `PROBLEM`,
    summary.customerProblem,
    ``,
    `GOAL`,
    summary.customerGoal,
    ``,
    `ACCOUNT`,
    ...summary.accountInformation.map((line) => `- ${line}`),
    ``,
    `ALREADY TRIED`,
    ...summary.alreadyTried.map((line) => `- ${line}`),
    ``,
    `RELEVANT MESSAGES`,
    ...summary.relevantMessages.map(
      (turn) => `${turn.role === "assistant" ? "AI" : "Customer"}: ${turn.content}`,
    ),
    ``,
    `SUGGESTED NEXT STEPS`,
    ...summary.suggestedNextSteps.map((line) => `- ${line}`),
  ].join("\n");
}
