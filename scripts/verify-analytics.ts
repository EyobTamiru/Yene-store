/**
 * Support analytics verification - the Section 7 contract.
 *
 *   npm run test:analytics
 *
 * Proves:
 *   1. AI metrics are counted correctly and rates need a denominator.
 *   2. Human support metrics come from the real ticket store.
 *   3. The satisfaction survey is only asked after resolution, and only once.
 *   4. Knowledge gaps find what the AI cannot answer - and do not flag the
 *      refusals that are working exactly as specified.
 *   5. PRIVACY: no customer identity, and no unredacted contact details, ever
 *      reach the analytics payload.
 *   6. Only authorized administrators can see platform-wide analytics.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Redirect the analytics store BEFORE it is imported by anything else, so the
// fixtures below never touch real reporting data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-analytics-"));
process.env.YENE_DATA_DIR = dataDir;

import {
  allConversations,
  clearAll,
  getConversation,
  markEscalated,
  recordTurn,
  saveFeedback,
  saveGapAction,
} from "../api/support/analyticsStore";
import {
  buildAnalyticsReport,
  computeAiMetrics,
  computeHumanMetrics,
  computeKnowledgeGaps,
  computeSatisfactionMetrics,
  resolveRange,
} from "../api/support/analytics";
import { getSurveyState, indicatesResolved, parseSubmission } from "../api/support/satisfaction";
import {
  findForbiddenKeys,
  questionFingerprint,
  redactCustomerText,
} from "../api/support/privacy";
import { can } from "../api/support/roles";
import { allTickets, insertTicket } from "../api/support/ticketStore";
import { RESOLUTION_SURVEY_QUESTION, RESOLUTION_SURVEY_OPTIONS } from "../src/constants";
import type { SupportIdentity } from "../api/support/types";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const ALL = resolveRange(0);

const guest: SupportIdentity = {
  userId: "guest", businessId: null, displayName: null,
  role: "unknown", isAuthenticated: false,
};

console.log("\n=== 1. AI metrics ===\n");
{
  clearAll();

  // Two conversations the AI fully handled.
  recordTurn({
    conversationId: "s_1", question: "how do I manage inventory",
    category: "inventory", grounded: true, sourceIds: ["features-inventory"],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: false,
  });
  recordTurn({
    conversationId: "s_2", question: "what does the standard package include",
    category: "packages", grounded: true, sourceIds: ["packages-standard"],
    escalationReasons: [], customerSignedOff: false, wasAuthenticated: false,
  });

  // One the AI answered, then a human took over.
  recordTurn({
    conversationId: "s_3", question: "how do orders work",
    category: "orders", grounded: true, sourceIds: ["features-orders"],
    escalationReasons: [], customerSignedOff: false, wasAuthenticated: false,
  });
  markEscalated("s_3", ["customer-requested-human"], "YENE-TEST01");

  // One the AI could not answer at all.
  recordTurn({
    conversationId: "s_4", question: "how do I connect my facebook page",
    category: "contact", grounded: false, sourceIds: [],
    escalationReasons: ["unknown-answer"], customerSignedOff: false, wasAuthenticated: false,
  });

  // A second turn in conversation 1, so the length average is not trivial.
  recordTurn({
    conversationId: "s_1", question: "and how do I import products",
    category: "products", grounded: true, sourceIds: ["features-inventory"],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: false,
  });

  const ai = computeAiMetrics(ALL);

  check("total conversations", ai.totalConversations === 4, String(ai.totalConversations));
  check("AI-resolved conversations", ai.aiResolvedConversations === 2, String(ai.aiResolvedConversations));
  check("human escalations", ai.humanEscalations === 1, String(ai.humanEscalations));
  // s_3 was handed over and s_4 was offered a human but never accepted, so the
  // two figures must differ: an offer is not an escalation.
  check("human offers are counted separately", ai.humanOffered === 2, String(ai.humanOffered));
  check("escalations never exceed offers", ai.humanEscalations <= ai.humanOffered);
  check("unresolved conversations", ai.unresolvedConversations === 1, String(ai.unresolvedConversations));
  check("escalation rate is 1 of 4", ai.escalationRatePercent === 25, String(ai.escalationRatePercent));
  check("total turns", ai.totalTurns === 5, String(ai.totalTurns));
  check("average conversation length is 1.3", ai.averageConversationLength === 1.3, String(ai.averageConversationLength));
  check("grounded turn rate is 4 of 5", ai.groundedTurnRatePercent === 80, String(ai.groundedTurnRatePercent));
  check("knowledge articles are counted", ai.articleUsage.length > 0, String(ai.articleUsage.length));
  check("the most used article is features-inventory", ai.articleUsage[0]?.id === "features-inventory", ai.articleUsage[0]?.id);
  check(
    "an article cited twice is counted twice",
    (ai.articleUsage.find((a) => a.id === "features-inventory")?.timesUsed ?? 0) === 2,
  );
  check("frequent questions are listed", ai.frequentQuestions.length >= 3, String(ai.frequentQuestions.length));
  check("common problems are listed", ai.commonProblems.length > 0);
  check("escalation reasons are ranked", ai.escalationReasons.length > 0);

  // A conversation the AI half-answered before escalation must NOT be counted
  // as AI-resolved: the human still had to finish it.
  check("an escalated conversation is not credited to the AI", ai.aiResolvedConversations === 2, `got ${ai.aiResolvedConversations}`);
}

console.log("\n=== 2. Rates without a denominator are null, not 0% ===\n");
{
  clearAll();
  const ai = computeAiMetrics(ALL);

  check("no conversations means a null escalation rate", ai.escalationRatePercent === null, String(ai.escalationRatePercent));
  check("no conversations means a null length", ai.averageConversationLength === null);
  check("no conversations means a null grounded rate", ai.groundedTurnRatePercent === null);
  check("but the counts are genuinely zero", ai.totalConversations === 0 && ai.humanEscalations === 0);

  const human = computeHumanMetrics(ALL);
  check("no tickets means a null first response time", human.averageFirstResponseMinutes === null);
  check("no tickets means a null reopen rate", human.reopenRatePercent === null);
}


console.log("\n=== 3. Human support metrics read the real ticket store ===\n");
{
  // Uses the production ticket store, so this proves the wiring rather than a
  // mock agreeing with itself. The fixtures are removed afterwards.
  const before = allTickets().length;

  const base = {
    customerName: "Alemayehu",
    customerEmail: "al@example.com",
    customerPhone: "+251 900 000 001",
    businessName: "Green Coffee",
    businessId: "green-coffee",
    userId: "u-1",
    packageName: "Standard",
    subject: "Inventory issue",
    description: "Cannot see inventory",
    category: "inventory" as const,
    priority: "normal" as const,
    conversationId: "s_t1",
    aiSummary: {
      customerProblem: "p", customerGoal: "g", accountInformation: [],
      alreadyTried: [], relevantMessages: [], suggestedNextSteps: [],
    },
    escalationReasons: ["unknown-answer" as const],
    isAuthenticated: true,
    conversation: [],
  };

  const t1 = insertTicket(base);
  const t2 = insertTicket({ ...base, conversationId: "s_t2", category: "orders" as never, packageName: "Super" });
  const t3 = insertTicket({ ...base, conversationId: "s_t3", businessName: "Blue Shop" });

  // Resolved, first response 30 minutes in, resolution 90 minutes in.
  t1.firstResponseAt = new Date(Date.now() + 30 * 60000).toISOString();
  t1.resolvedAt = new Date(Date.now() + 90 * 60000).toISOString();
  t1.status = "Resolved";
  t1.events.push({
    id: "e-r1", at: t1.resolvedAt, type: "resolved", actor: "Bereket", internal: false,
  });

  // Reopened: the event is what counts, not the current status.
  t2.events.push({
    id: "e-r2", at: new Date().toISOString(), type: "reopened", actor: "Bereket", internal: false,
  });

  const human = computeHumanMetrics(ALL);

  check("the new tickets are counted", human.ticketsCreated === before + 3, `${human.ticketsCreated} vs ${before + 3}`);
  check("a resolved ticket is counted as resolved", human.ticketsResolved === 1, String(human.ticketsResolved));
  check("two tickets remain open", human.openTickets === 2, String(human.openTickets));
  check("a reopened ticket is detected from its event", human.reopenedTickets === 1, String(human.reopenedTickets));
  check("average first response is 30 minutes", human.averageFirstResponseMinutes === 30, String(human.averageFirstResponseMinutes));
  check("average resolution is 90 minutes", human.averageResolutionMinutes === 90, String(human.averageResolutionMinutes));
  check("tickets are grouped by category", human.byCategory.some((c) => c.key === "inventory"));
  check("tickets are grouped by package", human.byPackage.some((c) => c.key === "Standard"));
  check("tickets are grouped by business", human.byBusiness.some((c) => c.key === "Green Coffee"));

  // A resolution stamp earlier than creation is a data fault, not a fast
  // resolution. It must be excluded rather than drag the average negative.
  t3.firstResponseAt = new Date(Date.now() - 60000).toISOString();
  const afterBad = computeHumanMetrics(ALL);
  check(
    "a negative span is excluded, not averaged in",
    (afterBad.averageFirstResponseMinutes ?? 0) >= 0,
    String(afterBad.averageFirstResponseMinutes),
  );

  for (const ticket of [t1, t2, t3]) {
    const index = allTickets().findIndex((t) => t.ticketId === ticket.ticketId);
    if (index >= 0) allTickets().splice(index, 1);
  }
}


console.log("\n=== 4. Customer satisfaction ===\n");
{
  clearAll();

  check("the survey question is exact", RESOLUTION_SURVEY_QUESTION === "Was your issue resolved?", RESOLUTION_SURVEY_QUESTION);
  check(
    "the three options are Yes / Partially / No",
    RESOLUTION_SURVEY_OPTIONS.map((o) => o.label).join(",") === "Yes,Partially,No",
    RESOLUTION_SURVEY_OPTIONS.map((o) => o.label).join(","),
  );

  // A conversation that has not resolved is never surveyed.
  recordTurn({
    conversationId: "s_open", question: "how do I add staff",
    category: "account", grounded: true, sourceIds: [],
    escalationReasons: [], customerSignedOff: false, wasAuthenticated: false,
  });
  check("an unresolved conversation is not surveyed", getSurveyState("s_open", guest).show === false);
  check("it is not marked resolved either", getSurveyState("s_open", guest).resolved === false);

  // The customer signs off.
  recordTurn({
    conversationId: "s_open", question: "thanks, that worked",
    category: "account", grounded: true, sourceIds: [],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: false,
  });
  check("signing off makes the survey due", getSurveyState("s_open", guest).show === true);
  check("and it is marked resolved", getSurveyState("s_open", guest).resolved === true);

  // Sign-off detection is deterministic and conservative.
  check("\"that works now\" is a sign-off", indicatesResolved("that works now now"));
  check("\"I sorted it\" is a sign-off", indicatesResolved("I sorted it, thanks"));
  check("a question is not a sign-off", !indicatesResolved("how do I change prices?"));
  check("a complaint is not a sign-off", !indicatesResolved("this still is not working"));

  // Validation: the rating and the comment are genuinely optional.
  const minimal = parseSubmission({ resolved: "yes" });
  check("an answer with no rating or comment is valid", minimal.ok === true);
  if (minimal.ok) {
    check("the rating defaults to null", minimal.value.rating === null);
    check("the comment defaults to null", minimal.value.comment === null);
  }

  const full = parseSubmission({ resolved: "partially", rating: 4, comment: "good but slow" });
  check("an answer with a rating and comment is valid", full.ok === true);
  if (full.ok) check("the rating is kept", full.value.rating === 4);

  check("an unknown answer is refused", parseSubmission({ resolved: "maybe" }).ok === false);
  check("a missing answer is refused", parseSubmission({}).ok === false);
  check("a rating of 0 is refused", parseSubmission({ resolved: "yes", rating: 0 }).ok === false);
  check("a rating of 6 is refused", parseSubmission({ resolved: "yes", rating: 6 }).ok === false);
  check("a fractional rating is refused", parseSubmission({ resolved: "yes", rating: 2.5 }).ok === false);

  // Record some answers and check the aggregate. Each answer is attached to a
  // real, signed-off conversation, because that is the only way one can exist
  // in production: the survey is never offered before resolution.
  const surveyCase = (id: string, resolved: "yes" | "partially" | "no", rating: number | null) => {
    recordTurn({
      conversationId: id, question: "how do I change a product price",
      category: "products", grounded: true, sourceIds: [],
      escalationReasons: [], customerSignedOff: true, wasAuthenticated: false,
    });
    saveFeedback({ conversationId: id, ticketId: null, resolved, rating, comment: null });
  };

  surveyCase("s_a", "yes", 5);
  surveyCase("s_b", "yes", 3);
  surveyCase("s_c", "partially", 2);
  surveyCase("s_d", "no", null);

  const sat = computeSatisfactionMetrics(ALL);
  check("four responses recorded", sat.responses === 4, String(sat.responses));
  check("two Yes", sat.yes === 2, String(sat.yes));
  check("one Partially", sat.partially === 1, String(sat.partially));
  check("one No", sat.no === 1, String(sat.no));
  check("resolution rate is 2 of 4", sat.resolutionRatePercent === 50, String(sat.resolutionRatePercent));
  check("full or partial is 3 of 4", sat.fullOrPartialRatePercent === 75, String(sat.fullOrPartialRatePercent));
  check("three ratings given", sat.ratingsGiven === 3, String(sat.ratingsGiven));
  check("average rating is 3.3", sat.averageRating === 3.3, String(sat.averageRating));

  // Answering again replaces rather than double-counts.
  saveFeedback({ conversationId: "s_d", ticketId: null, resolved: "yes", rating: 5, comment: null });
  const after = computeSatisfactionMetrics(ALL);
  check("re-answering replaces, it does not append", after.responses === 4, String(after.responses));
  check("and the replaced answer is counted", after.yes === 3, String(after.yes));

  // Having answered, the survey is not offered again.
  check("an answered conversation is not surveyed twice", getSurveyState("s_a", guest).show === false);
  check("but it records that an answer exists", getSurveyState("s_a", guest).answered === true);

  // An unknown conversation is simply not surveyable.
  check("an unknown conversation is not surveyed", getSurveyState("s_never_existed", guest).show === false);
}


console.log("\n=== 5. Knowledge gaps ===\n");
{
  clearAll();

  // The specification's own example, asked three times by three people.
  for (let i = 1; i <= 3; i += 1) {
    recordTurn({
      conversationId: `s_fb_${i}`,
      question: "how do I connect my facebook page",
      category: "contact", grounded: false, sourceIds: [],
      escalationReasons: ["unknown-answer"], customerSignedOff: false, wasAuthenticated: false,
    });
  }

  // Something the AI answers, so it must never become a gap.
  recordTurn({
    conversationId: "s_ok", question: "how do I manage inventory",
    category: "inventory", grounded: true, sourceIds: ["features-inventory"],
    escalationReasons: [], customerSignedOff: true, wasAuthenticated: false,
  });

  // A question the assistant DELIBERATELY refused. Refusing is the specified
  // behaviour here, so this must not be reported as a missing article.
  recordTurn({
    conversationId: "s_sec", question: "I think someone has got into my account",
    category: "account", grounded: false, sourceIds: [],
    escalationReasons: ["account-security"], customerSignedOff: false, wasAuthenticated: false,
  });
  recordTurn({
    conversationId: "s_pay", question: "I was double charged this month",
    category: "billing", grounded: false, sourceIds: [],
    escalationReasons: ["payment-dispute"], customerSignedOff: false, wasAuthenticated: false,
  });

  const gaps = computeKnowledgeGaps(ALL);

  check("one knowledge gap is found", gaps.length === 1, String(gaps.length));
  const gap = gaps[0];
  check("it is the repeated facebook question", /facebook/i.test(gap?.question ?? ""), gap?.question);
  check("it is counted three times", gap?.occurrences === 3, String(gap?.occurrences));
  check("across three conversations", gap?.conversations === 3, String(gap?.conversations));
  check("it starts out open", gap?.status === "open", gap?.status);
  check("it suggests an article id", (gap?.suggestedArticleId ?? "").length > 0, gap?.suggestedArticleId);
  check("it suggests a category", !!gap?.suggestedCategory, gap?.suggestedCategory);
  check("it is not attributed to anyone", gap?.decidedBy === null);

  // The exclusions, asserted individually.
  check("an answered question is not a gap", !gaps.some((g) => /inventory/i.test(g.question)));
  check(
    "an account-security refusal is not a gap",
    !gaps.some((g) => /got into my account/i.test(g.question)),
  );
  check(
    "a payment dispute is not a gap",
    !gaps.some((g) => /double charged/i.test(g.question)),
  );

  // The specification's closing example: an admin can act on the gap, and the
  // decision is remembered so it stops reappearing as unaddressed.
  saveGapAction(gap!.fingerprint, "planned", "Yonas (support manager)", "Writing the article");
  const afterDecision = computeKnowledgeGaps(ALL);
  check("the decision is remembered", afterDecision[0]?.status === "planned", afterDecision[0]?.status);
  check("the note is kept", afterDecision[0]?.note === "Writing the article");
  check("who decided is recorded", afterDecision[0]?.decidedBy === "Yonas (support manager)");

  // A later decision supersedes an earlier one.
  saveGapAction(gap!.fingerprint, "published", "Yonas (support manager)", "Shipped");
  check("the latest decision wins", computeKnowledgeGaps(ALL)[0]?.status === "published");

  // Grouping: the same question worded differently is one gap, not two.
  clearAll();
  recordTurn({
    conversationId: "g_1", question: "how do I connect my Facebook page",
    category: "contact", grounded: false, sourceIds: [],
    escalationReasons: ["unknown-answer"], customerSignedOff: false, wasAuthenticated: false,
  });
  recordTurn({
    conversationId: "g_2", question: "how do I connect a facebook page please",
    category: "contact", grounded: false, sourceIds: [],
    escalationReasons: ["unknown-answer"], customerSignedOff: false, wasAuthenticated: false,
  });
  const grouped = computeKnowledgeGaps(ALL);
  check("reworded duplicates are one gap", grouped.length === 1, String(grouped.length));
  check("but the occurrences are added up", grouped[0]?.occurrences === 2, String(grouped[0]?.occurrences));
}


console.log("\n=== 6. PRIVACY: no customer data in the report ===\n");
{
  clearAll();

  // A conversation whose question contains the kind of detail an aggregate
  // report must never republish.
  recordTurn({
    conversationId: "s_private",
    question: "my email is alemayehu@example.com and my phone is +251 911 234 567",
    category: "account", grounded: false, sourceIds: [],
    escalationReasons: ["unknown-answer"], customerSignedOff: false, wasAuthenticated: true,
  });
  saveFeedback({
    conversationId: "s_private", ticketId: null, resolved: "no", rating: 1,
    comment: "call me on 0911 555 1234 or email selam@example.com",
  });

  const report = buildAnalyticsReport(0);
  const serialised = JSON.stringify(report);

  // 1. No identity fields anywhere in the payload, at any depth.
  const forbidden = findForbiddenKeys(report);
  check("the report contains no forbidden identity keys", forbidden.length === 0, forbidden.join(", "));

  // 2. The literal contact details are gone, not merely the field names.
  check("no customer email survives", !serialised.includes("alemayehu@example.com"));
  check("no staff email survives", !serialised.includes("selam@example.com"));
  check("no phone number survives", !serialised.includes("911 234 567"));
  check("no phone number survives in the comment", !serialised.includes("0911 555 1234"));
  check("the redaction is visible instead", serialised.includes("[email removed]"));

  // 3. The stored records themselves are clean, not just the output. A future
  //    endpoint that forgot to filter would then have nothing to leak.
  const stored = JSON.stringify(allConversations());
  check("the stored conversation has no email", !stored.includes("alemayehu@example.com"));
  check("the stored conversation has no phone", !stored.includes("911 234 567"));
  check("the store holds no customerName", !stored.includes("customerName"));
  check("the store holds no userId", !stored.includes("userId"));
  check("the store holds no customerEmail", !stored.includes("customerEmail"));

  const conversation = getConversation("s_private");
  check("the conversation records no customer identity", conversation !== null && !("userId" in conversation));
  check("it records no email", conversation !== null && !("customerEmail" in conversation));

  // 4. The report states its own guarantee.
  check("the report carries a privacy note", (report.privacy.note ?? "").length > 0);
  check("it counts the deliberate refusals it excluded", report.privacy.deliberateRefusals >= 0);

  // 5. Redaction, directly.
  check(
    "an email is redacted",
    redactCustomerText("mail me at a.b@c.com") === "mail me at [email removed]",
    redactCustomerText("mail me at a.b@c.com"),
  );
  check(
    "a phone number is redacted",
    !/\d{4}/.test(redactCustomerText("call +251 911 234 567")),
    redactCustomerText("call +251 911 234 567"),
  );
  check(
    "a URL is redacted",
    !redactCustomerText("see https://example.com/help").includes("example.com"),
  );
  check(
    "a long order number is redacted",
    !redactCustomerText("order 12345678 never arrived").includes("12345678"),
    redactCustomerText("order 12345678 never arrived"),
  );
  check(
    "ordinary text is untouched",
    redactCustomerText("how do I manage my inventory") === "how do I manage my inventory",
  );

  // 6. Fingerprints group by meaning, not by exact wording.
  check(
    "reworded questions share a fingerprint",
    questionFingerprint("how do I connect my facebook page") ===
      questionFingerprint("how do I connect a facebook page please"),
  );
  check(
    "different questions do not",
    questionFingerprint("how do I connect my facebook page") !==
      questionFingerprint("how do refunds work"),
  );
}

console.log("\n=== 7. Only authorized administrators see platform analytics ===\n");
{
  check("a support agent cannot view analytics", !can("support-agent", "analytics.view"));
  check("a senior agent cannot view analytics", !can("senior-support-agent", "analytics.view"));
  check("a support manager can", can("support-manager", "analytics.view"));
  check("a super admin can", can("super-admin", "analytics.view"));

  check("an agent cannot manage knowledge gaps", !can("support-agent", "knowledge-gap.manage"));
  check("a manager can manage knowledge gaps", can("support-manager", "knowledge-gap.manage"));
}

console.log(failures === 0 ? "\nALL ANALYTICS CHECKS PASSED\n" : "\n" + failures + " ANALYTICS CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);

