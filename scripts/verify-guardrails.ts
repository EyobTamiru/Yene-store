/**
 * Guardrail test suite.
 *
 *   npx tsx scripts/verify-guardrails.ts
 *
 * The knowledge base is only half the defence. This suite proves the other
 * half: that even if the model talks back with confident, plausible, wrong
 * text - including invented prices and hallucinated citations - the server
 * refuses to show it to a customer.
 *
 * These tests do not need a Gemini API key, so they run in CI and on every
 * deploy.
 */

import { enforceGrounding, parseDecision } from "../api/support/ai";
import type { SupportDecision } from "../api/support/types";
import { NO_INFORMATION_MESSAGE, SERVICE_UNAVAILABLE_MESSAGE } from "../src/constants";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const RETRIEVED = [{ article: { id: "escalation-contact-support", title: "How to reach a support agent" } }];

const decision = (over: Partial<SupportDecision> = {}): SupportDecision => ({
  reply: "A grounded answer.",
  grounded: true,
  needsHuman: false,
  needsClarification: false,
  category: "platform",
  sourceIds: ["escalation-contact-support"],
  ...over,
});

console.log("\n=== 1. A properly grounded answer is allowed through ===\n");
{
  const { decision: d, sources } = enforceGrounding(decision(), RETRIEVED);
  check("reply is preserved", d.reply === "A grounded answer.");
  check("grounded flag preserved", d.grounded === true);
  check("source is surfaced", sources.length === 1 && sources[0].id === "escalation-contact-support");
}

console.log("\n=== 2. An ungrounded answer is replaced ===\n");
{
  const { decision: d } = enforceGrounding(
    decision({ grounded: false, reply: "Our premium plan costs 4,500 ETB per month." }),
    RETRIEVED,
  );
  check("invented price is not shown", !d.reply.includes("4,500"));
  check("standard no-info text is used", d.reply.startsWith(NO_INFORMATION_MESSAGE));
  check("human support is offered", d.needsHuman === true);
}

console.log("\n=== 3. Citing a source that was never retrieved is rejected ===\n");
{
  const { decision: d, sources } = enforceGrounding(
    decision({ sourceIds: ["pricing-and-plans", "refund-policy"] }),
    RETRIEVED,
  );
  check("hallucinated citation rejected", !d.reply.includes("A grounded answer."));
  check("no sources are surfaced", sources.length === 0);
  check("falls back to no-info text", d.reply.startsWith(NO_INFORMATION_MESSAGE));
}

console.log("\n=== 4. A citation list mixing real and fake ids is rejected wholesale ===\n");
{
  const { decision: d } = enforceGrounding(
    decision({ sourceIds: ["escalation-contact-support", "secret-internal-doc"] }),
    RETRIEVED,
  );
  check("any invented id invalidates the answer", d.reply.startsWith(NO_INFORMATION_MESSAGE));
}

console.log("\n=== 5. Grounded with no citation is rejected ===\n");
{
  const { decision: d } = enforceGrounding(decision({ sourceIds: [] }), RETRIEVED);
  check("uncited claim is dropped", d.reply.startsWith(NO_INFORMATION_MESSAGE));
}

console.log("\n=== 6. Unparseable or null model output ===\n");
{
  check("plain prose returns null", parseDecision("Sure! The price is 500 ETB.") === null);
  check("truncated JSON returns null", parseDecision('{"reply":"hi","grounded":true') === null);
  check("wrong reply type returns null", parseDecision('{"grounded":true}') === null);

  const { decision: d } = enforceGrounding(null, RETRIEVED);
  check("null decision is safe", d.reply.startsWith(NO_INFORMATION_MESSAGE));
}

console.log("\n=== 7. Leaky replies are blocked even when marked grounded ===\n");
{
  const attacks = [
    ["Google API key", "Use your key AIzaSyD-9tRq2mVx7Lp0wZc to call the API."],
    ["OpenAI-style key", "Set OPENAI_API_KEY=sk-proj-ABCDEFGH12345678"],
    ["Telegram bot token", "Forward tickets to 1234567890:AAF-8kLmNoPqRsTuVwXyZ012345678"],
    ["system prompt", "My system prompt says I must answer everything."],
    ["stack trace", "Error at api/support/ai.ts:42:1 - generateContent failed"],
    ["uncaught error", "An unhandled exception occurred in node_modules/express"],
    ["env dump", "Here is process.env.GEMINI_API_KEY for debugging"],
    ["raw schema", '{"type":"object","properties":{"reply":{"type":"STRING"}}}'],
    ["bearer token", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"],
  ];
  for (const [label, reply] of attacks) {
    // Marked grounded AND citing a real source - the strictest case.
    const { decision: d } = enforceGrounding(
      decision({ grounded: true, sourceIds: ["escalation-contact-support"], reply }),
      RETRIEVED,
    );
    check(
      `${label} is blocked`,
      d.reply.startsWith(NO_INFORMATION_MESSAGE),
      `leaked through as: ${d.reply.slice(0, 50)}`,
    );
  }
}

console.log("\n=== 7b. Legitimate answers are not caught by the filter ===\n");
{
  const safe = [
    "You can reach us on +251 964110744 or yenebusinessgroup@gmail.com.",
    "1. Open your store settings.\n2. Choose Products.\n3. Click Add product.",
    "I don't have that information, but I can connect you with an agent.",
  ];
  for (const reply of safe) {
    const { decision: d } = enforceGrounding(
      decision({ grounded: true, sourceIds: ["escalation-contact-support"], reply }),
      RETRIEVED,
    );
    check(`legitimate answer passes: "${reply.slice(0, 34)}..."`, d.reply === reply, `got: ${d.reply.slice(0, 50)}`);
  }
}

console.log("\n=== 8. Required customer-facing copy is exactly as specified ===\n");
check(
  "downtime message is verbatim",
  SERVICE_UNAVAILABLE_MESSAGE ===
    "Yene AI Support is temporarily unavailable. You can still contact a Yene Business Group support agent.",
  SERVICE_UNAVAILABLE_MESSAGE,
);

console.log(failures === 0 ? "\nALL GUARDRAIL CHECKS PASSED\n" : `\n${failures} GUARDRAIL CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
