import { GoogleGenAI, Type } from "@google/genai";
import {
  CONTACT_AGENT_EXPLANATION,
  HUMAN_HANDOFF_PROMPT,
  NO_INFORMATION_MESSAGE,
  SECURITY_HANDOFF_PREFIX,
  SERVICE_UNAVAILABLE_MESSAGE,
  UNRESOLVED_HANDOFF_MESSAGE,
} from "../../src/constants";
import { evaluateEscalation } from "./escalation";
import { containsInternalInformation } from "./internal";
import type { EscalationDecision } from "./types";
import { classifyQuery } from "../../src/knowledge/retrieval";
import { KNOWLEDGE_CATEGORIES } from "../../src/knowledge/types";
import type { QuickActionCategory } from "../../src/constants";
import { getAccountContext } from "./account";
import { buildHistoryContents, buildSystemInstruction } from "./prompts";
import type {
  ChatResponseBody,
  ChatTurn,
  SupportAccountContext,
  SupportDecision,
  SupportIdentity,
} from "./types";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_CHARS = 1800;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("MY_")) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** True when the assistant can actually answer. Used by /api/support/health. */
export function isAiConfigured(): boolean {
  return getClient() !== null;
}

const CATEGORIES: QuickActionCategory[] = [...KNOWLEDGE_CATEGORIES];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "Customer-facing answer." },
    grounded: { type: Type.BOOLEAN, description: "True only if fully sourced." },
    needsHuman: { type: Type.BOOLEAN, description: "Offer a support agent?" },
    needsClarification: { type: Type.BOOLEAN, description: "Ask a question first?" },
    category: { type: Type.STRING, enum: CATEGORIES },
    sourceIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Ids of sources actually used, copied exactly.",
    },
  },
  required: [
    "reply", "grounded", "needsHuman", "needsClarification", "category", "sourceIds",
  ],
} as const;

/**
 * Parses and normalises the model's JSON.
 * @internal exported for the guardrail test suite.
 */
export function parseDecision(raw: string): SupportDecision | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SupportDecision>;
    if (typeof parsed.reply !== "string") return null;
    return {
      reply: parsed.reply,
      grounded: parsed.grounded === true,
      needsHuman: parsed.needsHuman === true,
      category: CATEGORIES.includes(parsed.category as QuickActionCategory)
        ? (parsed.category as QuickActionCategory)
        : "platform",
      sourceIds: Array.isArray(parsed.sourceIds)
        ? parsed.sourceIds.filter((id): id is string => typeof id === "string")
        : [],
      needsClarification: parsed.needsClarification === true,
    };
  } catch {
    return null;
  }
}

/**
 * Patterns that must never reach a customer.
 *
 * Defence in depth. The prompt forbids revealing internals and grounding
 * forbids unsupported claims, but a single slip - or a prompt-injection
 * attempt echoed back by the model - should still not be able to put an API
 * key or a stack trace in front of a customer.
 */
const LEAK_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/, // OpenAI-style key
  /\bAIza[0-9A-Za-z_-]{10,}/, // Google API key
  /\b[0-9]{6,}:[A-Za-z0-9_-]{20,}/, // Telegram bot token
  /process\.env/i,
  /\bsystem\s*(prompt|instruction)s?\b/i,
  /\bstack\s*trace\b/i,
  /\b(uncaught|unhandled)\s+\w*(error|exception)/i,
  /\bnode_modules\b/i,
  /\b(error|exception)\s+at\s+[\w./\\-]+\.(ts|js|mjs|cjs):\d+/i,
  /["'][A-Z_]{4,}KEY["']\s*[:=]/, // KEY = "..."
  /"type"\s*:\s*"(string|object|number|array|null|integer|boolean)"/i, // raw JSON schema
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
];

/** True when a reply looks like it leaked internals. */
export function containsLeak(text: string): boolean {
  if (LEAK_PATTERNS.some((pattern) => pattern.test(text))) return true;
  // Section 8: the wider internal-information contract - system prompts,
  // internal notes, security configuration, other customers' data. Owned by
  // `internal.ts` so there is one answer to "could this reach a customer?".
  return containsInternalInformation(text);
}

/**
 * Turn the model's raw output into something we are willing to show.
 *
 * This is the real safety net. The prompt asks the model to be honest; this
 * function makes honesty non-optional. A reply is only kept when:
 *   - it parsed as valid JSON,
 *   - it did not leak internal detail,
 *   - the model marked it grounded, AND
 *   - every source it cited was actually retrieved for this question.
 *
 * Anything else is replaced with the standard "I don't have that information"
 * message plus a human-support offer.
 *
 * @internal exported for the guardrail test suite.
 */
export function enforceGrounding(
  decision: SupportDecision | null,
  articles: { article: { id: string; title: string } }[],
): { decision: SupportDecision; sources: { id: string; title: string }[] } {
  const retrievedIds = new Set(articles.map((hit) => hit.article.id));

  if (!decision) return { decision: fallbackDecision(), sources: [] };

  if (containsLeak(decision.reply)) {
    console.warn("[support] blocked a reply containing internal detail");
    return { decision: fallbackDecision(), sources: [] };
  }

  const validIds = decision.sourceIds.filter((id) => retrievedIds.has(id));
  const inventedCitation = decision.sourceIds.some((id) => !retrievedIds.has(id));

  if (inventedCitation) {
    console.warn("[support] model cited a source that was not retrieved");
  }

  if (!decision.grounded || validIds.length === 0 || inventedCitation) {
    return { decision: fallbackDecision(), sources: [] };
  }

  return {
    decision,
    sources: articles
      .filter((hit) => validIds.includes(hit.article.id))
      .map((hit) => ({ id: hit.article.id, title: hit.article.title })),
  };
}

/** The decision used whenever we will not show the model's own words. */
function fallbackDecision(): SupportDecision {
  return {
    reply: `${NO_INFORMATION_MESSAGE}\n\n${HUMAN_HANDOFF_PROMPT}`,
    grounded: false,
    needsHuman: true,
    needsClarification: false,
    category: "contact",
    sourceIds: [],
  };
}

/** The standard, customer-safe "I don't have that information" reply. */
function ungroundedResponse(
  viewer: ChatResponseBody["viewer"],
  sessionId: string,
  escalation?: EscalationDecision,
): ChatResponseBody {
  const shouldEscalate = escalation?.shouldEscalate ?? true;

  return {
    reply: `${NO_INFORMATION_MESSAGE}\n\n${HUMAN_HANDOFF_PROMPT}`,
    category: "contact",
    grounded: false,
    needsHuman: shouldEscalate,
    needsClarification: false,
    sources: [],
    viewer,
    sessionId,
    // An escalation condition that matched still counts, even though the
    // topic itself is undocumented.
    escalation: escalation?.shouldEscalate
      ? { reasons: escalation.reasons, priority: escalation.priority }
      : undefined,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error("support_ai_timeout")), ms),
    ),
  ]);
}

/**
 * Answer one customer message.
 *
 * Never throws: any internal failure becomes the customer-safe "temporarily
 * unavailable" message, so no error text, key or stack trace can reach the
 * browser.
 */
export async function answerSupportQuestion(
  message: string,
  history: ChatTurn[],
  identity: SupportIdentity,
  sessionId: string,
  unresolvedStreak = 0,
): Promise<ChatResponseBody> {
  const viewer: ChatResponseBody["viewer"] = {
    isAuthenticated: identity.isAuthenticated,
    displayName: identity.displayName,
    businessName: null,
  };

  // Classify first, and refuse deterministically WITHOUT calling the model.
  // Asking the model at all is what creates the risk of invention, and this
  // path works even if the AI backend is down.
  // --- Escalation check, part 1 ------------------------------------------
  // This runs FIRST, before retrieval and before the model. Two reasons:
  //  1. Account security and payment disputes are never worked through in
  //     chat - the correct action is to hand over.
  //  2. An escalation condition must not be swallowed by the
  //     "topic is undocumented" refusal below, which returns early.
  const early = evaluateEscalation(
    { message, isAuthenticated: identity.isAuthenticated, unresolvedStreak },
    true,
  );

  if (early.suppressAutomatedAnswer) {
    console.log("[support] escalating without answering:", early.reasons.join(","));
    return suppressedResponse(viewer, sessionId, early);
  }

  // Classify next. If the question is about a Yene-Store topic we have not
  // documented yet, refuse deterministically WITHOUT calling the model.
  // Asking the model at all is what creates the risk of invention.
  const classification = classifyQuery(message, 4);

  if (classification.topicIsUndocumented) {
    console.log(
      "[support] refused: undocumented topic ->",
      classification.drafts[0]?.article.id,
    );
    return ungroundedResponse(viewer, sessionId, early);
  }

  const ai = getClient();
  if (!ai) {
    console.warn("[support] GEMINI_API_KEY missing or not configured");
    return unavailableResponse(viewer, sessionId);
  }

  // Only APPROVED articles are ever given to the model as answerable sources.
  const articles = classification.approved;

  const account: SupportAccountContext = await getAccountContext(identity);

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: buildHistoryContents(history, message),
        config: {
          systemInstruction: buildSystemInstruction(articles, identity, account),
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          topP: 0.9,
          maxOutputTokens: 1024,
        },
      }),
      REQUEST_TIMEOUT_MS,
    );

    const parsed = parseDecision(response.text ?? "");
    if (!parsed) console.warn("[support] model returned unparseable output");

    const { decision, sources } = enforceGrounding(parsed, articles);

    const base: ChatResponseBody = {
      reply: decision.reply.slice(0, MAX_REPLY_CHARS) || NO_INFORMATION_MESSAGE,
      category: decision.category,
      grounded: decision.grounded,
      needsHuman: decision.needsHuman,
      needsClarification: decision.needsClarification,
      sources,
      viewer: { ...viewer, businessName: account.businessName ?? null },
      sessionId,
    };

    // --- Escalation check, part 2: now the answer is known -------------------
    // "Does not know the answer" can only be judged once we know whether the
    // reply was grounded.
    const final = evaluateEscalation(
      {
        message,
        isAuthenticated: identity.isAuthenticated,
        unresolvedStreak,
      },
      base.grounded,
    );

    if (!final.shouldEscalate) return base;

    console.log("[support] escalating:", final.reasons.join(","));

    return {
      ...base,
      reply: appendHandoffOffer(base.reply, final),
      needsHuman: true,
      escalation: { reasons: final.reasons, priority: final.priority },
    };
  } catch (error) {
    // Never surface the reason to the customer.
    console.error("[support] generateContent failed:", error);
    return unavailableResponse(viewer, sessionId);
  }
}

/**
 * Add the handover offer in the customer's own language, without repeating it
 * if it is already there.
 */
function appendHandoffOffer(reply: string, escalation: EscalationDecision): string {
  if (/connect you with a .*support agent/i.test(reply)) return reply;

  const reasonIsUnresolved = escalation.reasons.includes("unresolved");
  const prefix = reasonIsUnresolved
    ? UNRESOLVED_HANDOFF_MESSAGE
    : CONTACT_AGENT_EXPLANATION;

  return `${reply.trim()}\n\n${prefix}`;
}

/** Account security / payment disputes: hand over without attempting an answer. */
function suppressedResponse(
  viewer: ChatResponseBody["viewer"],
  sessionId: string,
  escalation: EscalationDecision,
): ChatResponseBody {
  const lead =
    escalation.reasons.includes("account-security")
      ? SECURITY_HANDOFF_PREFIX
      : "This needs a person who can look into it properly, so I won't try to work through it in chat.";

  return {
    reply: `${lead}\n\n${CONTACT_AGENT_EXPLANATION}`,
    category: escalation.reasons.includes("account-security") ? "account" : "billing",
    grounded: false,
    needsHuman: true,
    needsClarification: false,
    sources: [],
    viewer,
    sessionId,
    escalation: { reasons: escalation.reasons, priority: escalation.priority },
  };
}


function unavailableResponse(
  viewer: ChatResponseBody["viewer"],
  sessionId: string,
): ChatResponseBody {
  return {
    reply: `${SERVICE_UNAVAILABLE_MESSAGE}\n\n${HUMAN_HANDOFF_PROMPT}`,
    category: "contact",
    grounded: false,
    needsHuman: true,
    needsClarification: false,
    sources: [],
    viewer,
    sessionId,
  };
}
