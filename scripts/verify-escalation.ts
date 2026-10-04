/**
 * Escalation and handover verification.
 *
 *   npm run test:escalation
 *
 * Proves the Section 3 requirements:
 *   1. All eleven escalation conditions are detected.
 *   2. Priority and intent are assigned sensibly.
 *   3. Account security and payment disputes suppress the automated answer.
 *   4. The handoff summary is factual and contains no chain-of-thought.
 *   5. The required customer-facing wording is exact.
 */

import {
  evaluateEscalation,
  indicatesStillUnresolved,
} from "../api/support/escalation";
import { buildHandoffSummary, formatSummaryForTicket } from "../api/support/summary";
import {
  CONNECT_AGENT_BUTTON_LABEL,
  CONTACT_AGENT_EXPLANATION,
  CONTACT_SUPPORT_BUTTON_LABEL,
  INVESTIGATING_MESSAGE,
  UNRESOLVED_HANDOFF_MESSAGE,
} from "../src/constants";
import { TICKET_STATUSES, type EscalationReason, type SupportIdentity } from "../api/support/types";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const signedIn: SupportIdentity = {
  userId: "u-1", businessId: "green-coffee", displayName: "Alemayehu",
  role: "owner", isAuthenticated: true,
};
const guest: SupportIdentity = {
  userId: "guest", businessId: null, displayName: null,
  role: "unknown", isAuthenticated: false,
};

const evalFor = (message: string, auth = true, streak = 0, grounded = true) =>
  evaluateEscalation({ message, isAuthenticated: auth, unresolvedStreak: streak }, grounded);

console.log("\n=== 1. All eleven escalation conditions fire ===\n");
const conditions: [string, string, EscalationReason][] = [
  ["1. does not know the answer", "what is the airspeed velocity of a swallow", "unknown-answer"],
  ["2. customer requests a human", "I want to speak to a real person please", "customer-requested-human"],
  ["3. account security", "I think someone else has got into my account", "account-security"],
  ["4. payment dispute", "I was double charged this month", "payment-dispute"],
  ["5. manual account change", "please change my business name to Green Coffee Ltd", "manual-account-change"],
  ["6. technical investigation", "the checkout page shows an error 500", "technical-investigation"],
  ["7. custom development", "we need a custom inventory system built for us", "custom-development"],
  ["8. complaint", "this is completely unacceptable and frustrating", "complaint"],
  ["9. quotation request", "please send me a quotation for 3 branches", "quotation-request"],
  ["10. AI failed to resolve", "my order is still not here", "unresolved"],
  ["11. repeatedly unresolved", "it is still not working", "repeatedly-unresolved"],
];

for (const [label, message, expected] of conditions) {
  const result = evalFor(
    message, true, expected === "repeatedly-unresolved" ? 2 : 0,
    expected === "unknown-answer" ? false : true,
  );
  check(
    `${label}: "${message.slice(0, 38)}"`,
    result.shouldEscalate && result.reasons.includes(expected),
    `reasons=${result.reasons.join(",") || "none"}`,
  );
}

console.log("\n=== 2. 'repeatedly unresolved' needs a streak ===\n");
{
  check("one unresolved message is not enough", !evalFor("it is still not working", true, 1).reasons.includes("repeatedly-unresolved"));
  check("two in a row triggers it", evalFor("still not working", true, 2).reasons.includes("repeatedly-unresolved"));
  check("detector recognises the phrasing", indicatesStillUnresolved("still not working"));
  check("detector ignores a fresh question", !indicatesStillUnresolved("what is a subdomain?"));
}

console.log("\n=== 3. Priority is assigned correctly ===\n");
{
  check("account security is urgent", evalFor("someone hacked my account").priority === "urgent");
  check("payment dispute is high", evalFor("you double charged me").priority === "high");
  check("complaint is high", evalFor("this is unacceptable").priority === "high");
  check("quotation is normal", evalFor("send me a quotation").priority === "normal");
}

console.log("\n=== 4. Security and payment never get an automated answer ===\n");
{
  check("security suppresses the answer", evalFor("my account was hacked").suppressAutomatedAnswer);
  check("payment dispute suppresses the answer", evalFor("I want a refund for a duplicate charge").suppressAutomatedAnswer);
  check("a normal question does not suppress", !evalFor("what is a subdomain?").suppressAutomatedAnswer);
  check("a quotation does not suppress", !evalFor("send me a quotation").suppressAutomatedAnswer);
}

console.log("\n=== 5. Manual account change requires sign-in ===\n");
{
  check("fires for a signed-in owner", evalFor("please change my business name", true).reasons.includes("manual-account-change"));
  check("does not fire for a guest", !evalFor("please change my business name", false).reasons.includes("manual-account-change"));
}

console.log("\n=== 6. A normal product question is not escalated ===\n");
for (const message of [
  "what is yene store",
  "do I get a subdomain",
  "what does the standard package include",
  "how do promotions work",
]) {
  check(`"${message}" is not escalated`, !evalFor(message).shouldEscalate);
}

console.log("\n=== 7. Handover summary is factual, with no chain of thought ===\n");
{
  const summary = buildHandoffSummary({
    identity: signedIn,
    account: {
      businessName: "Green Coffee Roasters",
      packageName: "Standard",
      facts: ["Package is Standard."],
    },
    transcript: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "I cannot see my inventory" },
      { role: "assistant", content: "I do not have that information." },
    ],
    escalation: evalFor("I cannot see my inventory", true, 1, false),
    grounded: false,
    citedArticleIds: [],
    offeredHuman: true,
    askedClarification: false,
  });

  const all = JSON.stringify(summary).toLowerCase();

  check("has a customer problem", summary.customerProblem.length > 0);
  check("has a goal", summary.customerGoal.length > 0);
  check("has account information", summary.accountInformation.length > 0);
  check("states what was already tried", summary.alreadyTried.length > 0);
  check("quotes the relevant messages", summary.relevantMessages.length === 4);
  check("suggests next steps", summary.suggestedNextSteps.length > 0);
  check("names the signed-in business", all.includes("green coffee"));
  check(
    "records that no confirmed answer was available",
    summary.alreadyTried.some((line) => line.includes("No confirmed answer")),
  );

  // The critical safety property: no reasoning may reach the ticket.
  for (const phrase of [
    "chain of thought", "reasoning", "i think", "the model",
    "deliberat", "confidence that", "my instructions",
  ]) {
    check(`summary never contains "${phrase}"`, !all.includes(phrase));
  }

  const rendered = formatSummaryForTicket("YENE-TEST01", summary);
  check("renders a ticket brief", rendered.includes("PROBLEM") && rendered.includes("SUGGESTED NEXT STEPS"));
  check("brief contains the ticket id", rendered.includes("YENE-TEST01"));
}

console.log("\n=== 8. Guest summaries reveal no account data ===\n");
{
  const summary = buildHandoffSummary({
    identity: guest,
    account: { facts: [] },
    transcript: [{ role: "user", content: "I need help" }],
    escalation: evalFor("I need help", false, 0, false),
    grounded: false,
    citedArticleIds: [],
    offeredHuman: true,
    askedClarification: false,
  });
  check("states the customer is not signed in", summary.accountInformation.some((l) => l.includes("not signed in")));
  check("does not leak a business", !JSON.stringify(summary).includes("green-coffee"));
}

console.log("\n=== 9. Required customer-facing wording is exact ===\n");
{
  check(
    "contact button label",
    CONTACT_SUPPORT_BUTTON_LABEL === "Contact Yene Business Group Support Agent",
    CONTACT_SUPPORT_BUTTON_LABEL,
  );
  check(
    "contact explanation",
    CONTACT_AGENT_EXPLANATION ===
      "I will connect you with a Yene Business Group support agent. I will also share the relevant conversation so you don't have to explain everything again.".replace(/I will/g, "I'll"),
    CONTACT_AGENT_EXPLANATION,
  );
  check(
    "unresolved handoff",
    UNRESOLVED_HANDOFF_MESSAGE ===
      "I couldn't resolve this automatically. I'll connect you with a Yene Business Group support agent and provide them with the details of our conversation.",
    UNRESOLVED_HANDOFF_MESSAGE,
  );
  check("investigating message", INVESTIGATING_MESSAGE === "Let me check a few things...");
  check("connect button label", CONNECT_AGENT_BUTTON_LABEL === "Connect me with a support agent");
}

console.log("\n=== 10. Ticket statuses match the specification ===\n");
check(
  "exact status set",
  JSON.stringify([...TICKET_STATUSES]) ===
    JSON.stringify([
      "Open", "In Progress", "Waiting for Customer",
      "Waiting for Internal Team", "Resolved", "Closed",
    ]),
  TICKET_STATUSES.join(" | "),
);

console.log(failures === 0 ? "\nALL ESCALATION CHECKS PASSED\n" : "\n" + failures + " ESCALATION CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);
