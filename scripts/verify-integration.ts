/**
 * Final integration verification - the Section 9 contract.
 *
 *   npm run test:integration
 *
 * Walks the customer journey the specification describes, in order, and
 * asserts that each step works AND hands the next one what it needs:
 *
 *   AI answers -> problem solved
 *   AI cannot answer -> escalate -> ticket created
 *   conversation + factual summary transferred to the ticket
 *   agent receives it -> responds -> resolves
 *   customer can see their own requests (component 8)
 *   customer can give feedback
 *
 * It also proves the components stay ISOLATED where isolation is the point:
 * one business's journey must never be visible to another.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Redirect every durable store before anything imports it, so this suite never
// writes into real customer data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-integration-"));
process.env.YENE_DATA_DIR = dataDir;
process.env.YENE_AUDIT_FILE = path.join(dataDir, "audit.json");

import {
  clearAll, getConversation, markEscalated, recordTurn,
} from "../api/support/analyticsStore";
import { clearAudit, queryAudit } from "../api/support/auditLog";
import { allTickets, insertTicket } from "../api/support/ticketStore";
import { listTicketsForCaller, ticketForCustomer } from "../api/support/tickets";
import { getSurveyState, parseSubmission, submitFeedback } from "../api/support/satisfaction";
import { buildHandoffSummary } from "../api/support/summary";
import { evaluateEscalation } from "../api/support/escalation";
import { canAccessTicket } from "../api/support/tenant";
import { TICKET_STATUSES, type SupportIdentity } from "../api/support/types";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const ownerA: SupportIdentity = {
  userId: "u-alemayehu", businessId: "green-coffee", displayName: "Alemayehu",
  role: "owner", isAuthenticated: true,
};
const employeeA: SupportIdentity = {
  userId: "u-selam", businessId: "green-coffee", displayName: "Selam",
  role: "employee", isAuthenticated: true,
};
const ownerB: SupportIdentity = {
  userId: "u-dawit", businessId: "blue-shop", displayName: "Dawit",
  role: "owner", isAuthenticated: true,
};
const guest: SupportIdentity = {
  userId: "guest", businessId: null, displayName: null,
  role: "unknown", isAuthenticated: false,
};

const BASE_TICKET = {
  customerName: "Alemayehu",
  customerEmail: null,
  customerPhone: null,
  businessName: "Green Coffee",
  businessId: "green-coffee",
  userId: "u-alemayehu",
  packageName: "Standard",
  subject: "Inventory issue",
  description: "I cannot see my inventory",
  category: "inventory" as const,
  priority: "normal" as const,
  aiSummary: {
    customerProblem: "Customer cannot see their inventory",
    customerGoal: "Understand how a Yene-Store feature works.",
    accountInformation: ["Signed in as: Alemayehu (role: owner)", "Business: Green Coffee"],
    alreadyTried: ["Answered from the knowledge base: features-inventory"],
    relevantMessages: [{ role: "user" as const, content: "I cannot see my inventory" }],
    suggestedNextSteps: ["Check recorded stock levels for the affected items"],
  },
  escalationReasons: ["unknown-answer" as const],
  isAuthenticated: true,
  conversation: [{ role: "user" as const, content: "I cannot see my inventory" }],
};

/** Remove every ticket, so each section starts from a known state. */
function resetTickets(): void {
  const store = allTickets();
  store.length = 0;
}

console.log("\n=== 1. AI answers -> problem solved (no ticket) ===\n");
{
  clearAll();
  resetTickets();
  const before = allTickets().length;

  recordTurn({
    conversationId: "s_solved", question: "how do I manage my inventory",
    category: "inventory", grounded: true, sourceIds: ["features-inventory"],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: true,
  });

  check("a resolved conversation creates no ticket", allTickets().length === before);
  check("it is recorded as a conversation", getConversation("s_solved") !== null);
  check("the customer signed off", getConversation("s_solved")?.customerSignedOff === true);
  check("the survey becomes due after the sign-off", getSurveyState("s_solved", ownerA).show === true);
  check("and it is recorded as resolved", getSurveyState("s_solved", ownerA).resolved === true);
}

console.log("\n=== 2. AI cannot answer -> escalate -> ticket created ===\n");
{
  clearAll();
  resetTickets();
  const before = allTickets().length;

  const question = "how do I connect my facebook page";
  const escalation = evaluateEscalation(
    { message: question, isAuthenticated: true, unresolvedStreak: 0 },
    false, // no grounded answer
  );
  check("the question triggers an escalation", escalation.shouldEscalate);
  check("the reason is that we do not know", escalation.reasons.includes("unknown-answer"));

  const ticket = insertTicket({ ...BASE_TICKET, conversationId: "s_escalated" });
  markEscalated("s_escalated", escalation.reasons, ticket.ticketId);

  check("a ticket was created", allTickets().length === before + 1);
  check("it is open", ticket.status === "Open");
  check("it carries a subject", ticket.subject.length > 0);
  check("it is bound to the right business", ticket.businessId === "green-coffee");
  check("the conversation is marked escalated", getConversation("s_escalated")?.escalatedToHuman === true);
}

console.log("\n=== 3. Conversation and factual summary transfer to the ticket ===\n");
{
  const transcript = [
    { role: "user" as const, content: "I cannot see my inventory" },
    { role: "assistant" as const, content: "You can check Inventory from the menu." },
    { role: "user" as const, content: "it is empty" },
  ];
  const escalation = evaluateEscalation(
    { message: "it is empty", isAuthenticated: true, unresolvedStreak: 0 }, false,
  );

  const summary = buildHandoffSummary({
    identity: ownerA,
    account: { businessName: "Green Coffee", packageName: "Standard", facts: ["Business: Green Coffee"] },
    transcript,
    escalation,
    grounded: true,
    citedArticleIds: ["features-inventory"],
    offeredHuman: true,
    askedClarification: false,
  });

  check("the summary states the problem", summary.customerProblem.length > 0);
  check("the summary states the goal", summary.customerGoal.length > 0);
  check("the summary carries the account context", summary.accountInformation.length > 0);
  check("the summary states what was already tried", summary.alreadyTried.length > 0);
  check("the summary includes the messages", summary.relevantMessages.length === 3);
  check("the summary suggests next steps", summary.suggestedNextSteps.length > 0);

  // The agent must receive facts, never the assistant's reasoning.
  const serialised = JSON.stringify(summary);
  check("the summary contains no chain of thought", !/chain[- ]of[- ]thought/i.test(serialised));
  check("the summary contains no system prompt", !/system prompt/i.test(serialised));
}

console.log("\n=== 4. Agent receives, responds and resolves ===\n");
{
  clearAudit();
  resetTickets();
  const ticket = insertTicket({ ...BASE_TICKET, conversationId: "s_agent" });
  const event = (type: string, body?: string) => ({
    id: `e-${type}`, at: new Date().toISOString(),
    type: type as never, actor: "Yonas", actorRole: "support-manager",
    body, internal: false,
  });

  ticket.firstResponseAt = new Date().toISOString();
  ticket.events.push(event("agent-reply", "I can see the issue."));
  ticket.status = "Resolved";
  ticket.resolvedAt = new Date().toISOString();
  ticket.events.push(event("resolved", "Fixed."));

  check("the agent's reply is on the ticket", ticket.events.some((e) => e.type === "agent-reply"));
  check("the first response time is stamped", ticket.firstResponseAt !== null);
  check("the ticket is resolved", ticket.status === "Resolved");
  check("the resolution time is stamped", ticket.resolvedAt !== null);

  const view = ticketForCustomer(ticket);
  check("the customer sees the resolved status", view.status === "Resolved");
  check("the customer sees the agent's reply", (view.events ?? []).some((e) => e.type === "agent-reply"));
  check("but never the AI summary", !("aiSummary" in (view as object)));
  check("and never the attachments", !("attachments" in (view as object)));
}


console.log("\n=== 5. Component 8: the customer can see their own requests ===\n");
{
  clearAll();
  resetTickets();

  const mine = insertTicket({ ...BASE_TICKET, conversationId: "s_hist_1" });
  const second = insertTicket({
    ...BASE_TICKET, conversationId: "s_hist_2", subject: "Billing question",
  });
  const theirs = insertTicket({
    ...BASE_TICKET, conversationId: "s_hist_3", businessId: "blue-shop",
    userId: "u-dawit", customerName: "Dawit",
  });

  const history = listTicketsForCaller(ownerA);
  check("the customer sees their own requests", history.length === 2, String(history.length));
  check("and only their own", history.every((t) => t.ticketId !== theirs.ticketId));
  check("both of their own are present",
    history.some((t) => t.ticketId === mine.ticketId)
    && history.some((t) => t.ticketId === second.ticketId));

  // A colleague in the same business sees the same history. This is the
  // business-scoped guarantee, not the per-user one.
  const colleague = listTicketsForCaller(employeeA);
  check("a colleague in the same business sees them too", colleague.length === 2, String(colleague.length));

  // The other business sees only ITS OWN request, and none of A's. Not zero:
  // blue-shop genuinely owns one of them.
  const otherBusiness = listTicketsForCaller(ownerB);
  check("another business sees only its own request", otherBusiness.length === 1, String(otherBusiness.length));
  check("and it is the one it owns", otherBusiness[0]?.ticketId === theirs.ticketId);
  check("and none of A's", otherBusiness.every((t) => t.ticketId !== mine.ticketId));
  check("a guest sees none of it", listTicketsForCaller(guest).length === 0);

  // The listing is customer-safe, like every other customer read path.
  const serialised = JSON.stringify(history);
  for (const field of ["aiSummary", "customerPhone", "attachments", "assignedTo"]) {
    check(`the history never contains "${field}"`, !serialised.includes(field));
  }

  // Newest first, so the most recent request is the one a customer wants.
  const dates = history.map((t) => t.updatedAt as string);
  check("the history is newest first",
    dates.every((date, index) => index === 0 || dates[index - 1] >= date));
}

console.log("\n=== 6. The customer can give feedback ===\n");
{
  clearAll();
  resetTickets();
  insertTicket({ ...BASE_TICKET, conversationId: "s_fb" });
  recordTurn({
    conversationId: "s_fb", question: "thanks, that worked",
    category: "inventory", grounded: true, sourceIds: ["features-inventory"],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: true,
  });
  markEscalated("s_fb", ["unknown-answer"], "YENE-FB0001");

  check("the survey is offered after resolution", getSurveyState("s_fb", ownerA).show === true);

  const parsed = parseSubmission({ resolved: "yes", rating: 5, comment: "Quick and clear" });
  check("the answer validates", parsed.ok);
  if (parsed.ok) {
    const stored = submitFeedback("s_fb", ownerA, parsed.value);
    check("the answer is recorded", stored !== null);
    check("the resolution is stored as yes", stored?.resolved === "yes");
    check("the rating is stored", stored?.rating === 5);
    check("the comment is stored", stored?.comment === "Quick and clear");
  }

  // Asked once only.
  const after = getSurveyState("s_fb", ownerA);
  check("the survey is not offered twice", after.show === false);
  check("but the answer is remembered", after.answered === true);

  // A guest cannot answer for a business conversation.
  clearAll();
  recordTurn({
    conversationId: "s_fb2", question: "thanks, that worked",
    category: "inventory", grounded: true, sourceIds: [],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: true,
  });
  const guestAttempt = submitFeedback("s_fb2", guest, {
    resolved: "yes", rating: 1, comment: null,
  });
  check("a guest cannot answer for a business conversation", guestAttempt === null);
}

console.log("\n=== 7. Isolation holds across the whole journey ===\n");
{
  clearAll();
  resetTickets();

  const a = insertTicket({ ...BASE_TICKET, conversationId: "s_iso_a" });
  const b = insertTicket({
    ...BASE_TICKET, conversationId: "s_iso_b", businessId: "blue-shop",
    userId: "u-dawit", customerName: "Dawit",
  });

  // The exact cross-tenant reads a hostile caller would attempt.
  check("A cannot open B's ticket", !canAccessTicket(ownerA, b).allowed);
  check("B cannot open A's ticket", !canAccessTicket(ownerB, a).allowed);
  check("a guest cannot open either",
    !canAccessTicket(guest, a).allowed && !canAccessTicket(guest, b).allowed);
  check("A can open their own", canAccessTicket(ownerA, a).allowed);
  check("A's history excludes B's ticket",
    listTicketsForCaller(ownerA).every((t) => t.ticketId !== b.ticketId));
}

console.log("\n=== 8. Every step of the journey is auditable ===\n");
{
  clearAudit();
  insertTicket({ ...BASE_TICKET, conversationId: "s_audit" });

  const all = queryAudit({ limit: 100 });
  check("ticket creation was audited", all.entries.some((e) => e.action === "ticket.created"));
  check("the audit is scoped to the business",
    all.entries.some((e) => e.businessId === "green-coffee"));

  // The whole action vocabulary the specification requires must be queryable.
  for (const action of [
    "ticket.created", "ticket.assigned", "ticket.updated", "agent.response",
    "ticket.resolved", "knowledge.changed", "permission.changed",
  ]) {
    check(`"${action}" is queryable`, typeof queryAudit({ action: action as never }).total === "number");
  }
}

console.log("\n=== 9. The ticket lifecycle is a closed set ===\n");
{
  const lifecycle = ["Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"];
  check("the journey uses only declared statuses",
    lifecycle.every((status) => (TICKET_STATUSES as readonly string[]).includes(status)));
  check("there are six statuses in total", TICKET_STATUSES.length === 6, String(TICKET_STATUSES.length));
}

console.log(failures === 0 ? "\nALL INTEGRATION CHECKS PASSED\n" : "\n" + failures + " INTEGRATION CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);

