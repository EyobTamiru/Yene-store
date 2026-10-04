/**
 * ============================================================================
 *  ANALYTICS PRIVACY
 * ============================================================================
 *
 *  Section 7 requires support analytics AND requires that sensitive customer
 *  information never reaches them. Those two rules pull in opposite directions,
 *  so the tension is resolved here, in one module, rather than being left to
 *  whoever writes the next aggregation.
 *
 *  THE RULE
 *  --------
 *  Support analytics is AGGREGATE reporting. It answers "how often", "how
 *  long", "how many" and "which article". It never answers "who".
 *
 *  Two mechanisms enforce that:
 *
 *  1. NO IDENTITY IS STORED. Conversation analytics records carry no customer
 *     name, email address, phone number, user id or business id. Not hashed,
 *     not tokenised - absent. A record cannot leak what it does not hold, and
 *     an analytics store is far less sensitive than the ticket store it sits
 *     beside, so a breach of one is not a breach of both.
 *
 *  2. CUSTOMER TEXT IS REDACTED BEFORE IT IS WRITTEN. Questions and survey
 *     comments are real customer sentences, so they routinely contain an email
 *     address or a phone number the customer pasted in. `redactCustomerText`
 *     strips those before the value ever reaches disk - which is stronger than
 *     filtering them on the way out, because a later reporting bug then has
 *     nothing to leak.
 *
 *  The business name IS retained, because "tickets by business" is an explicit
 *  product requirement. A business is a counterparty in an aggregate commercial
 *  breakdown, not an individual, and the same figure already appears in the
 *  ticket dashboard.
 */

import { createHash } from "node:crypto";
import { tokenize } from "../../src/knowledge/retrieval";

/**
 * Placeholders that replace a removed value.
 *
 * They are deliberately visible. "How do I reach you? [email removed]" tells an
 * administrator the customer asked about a contact channel; a silent blank
 * would look like the assistant simply had no content.
 */
export const REDACTION_LABELS = {
  email: "[email removed]",
  phone: "[phone removed]",
  link: "[link removed]",
  number: "[number removed]",
} as const;

/**
 * Ordered deliberately. Links go first because a URL can contain both an email
 * and a long digit run, and removing the link removes them together.
 */
const REDACTION_RULES: { pattern: RegExp; replacement: string }[] = [
  // https://..., www.example.com/path
  { pattern: /\b(?:https?:\/\/|www\.)\S+/gi, replacement: REDACTION_LABELS.link },
  // someone@example.com
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, replacement: REDACTION_LABELS.email },
  // +251 964 110 744 / 0911 234 5678 / (011) 555-0199
  { pattern: /\+?\d[\d\s().-]{6,}\d/g, replacement: REDACTION_LABELS.phone },
  // Any remaining 6+ digit run: order references, card digits, account numbers.
  { pattern: /\b\d{6,}\b/g, replacement: REDACTION_LABELS.number },
];

/** Longest question or comment retained for reporting. */
export const MAX_ANALYTICS_TEXT = 200;

/**
 * Remove identifiable values from customer-authored text.
 *
 * Call this on EVERY string that came from a customer and is about to be
 * stored for analytics. It is deliberately aggressive: a support report that
 * loses a digit is a much smaller problem than one that republishes a phone
 * number to every manager who opens the dashboard.
 */
export function redactCustomerText(text: string, maxLength = MAX_ANALYTICS_TEXT): string {
  let out = text.replace(/\s+/g, " ").trim();
  for (const { pattern, replacement } of REDACTION_RULES) {
    out = out.replace(pattern, replacement);
  }
  out = out.trim();
  if (out.length <= maxLength) return out;
  return `${out.slice(0, maxLength - 1).trimEnd()}…`;
}


/**
 * The keys that must never appear in an analytics payload.
 *
 * Kept as data rather than as prose so `verify-analytics.ts` can assert against
 * the same list the implementation is written from. A new identifier added to
 * the ticket store is therefore a failing test, not a silent leak.
 */
export const FORBIDDEN_ANALYTICS_KEYS = [
  "customerName",
  "customerEmail",
  "customerPhone",
  "customerPhoneWithheld",
  "userId",
  "businessId",
  "contactEmail",
  "contactPhone",
  "accountInformation",
  "aiSummary",
  "conversation",
  "description",
  "internalNotesWithheld",
] as const;

/**
 * Find any forbidden key anywhere in a serialised analytics payload.
 *
 * Used by the verification suite rather than in the request path: the report
 * builder is written so that forbidden fields cannot occur, and the test proves
 * it stays that way.
 */
export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findForbiddenKeys(item, `${path}[${index}]`)));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_ANALYTICS_KEYS as readonly string[]).includes(key)) {
        found.push(`${path}.${key}`);
      }
      found.push(...findForbiddenKeys(child, `${path}.${key}`));
    }
  }
  return found;
}

/** How many leading tokens identify a question for grouping. */
const FINGERPRINT_TOKENS = 8;

/**
 * A stable key for "the same question, asked again".
 *
 * Uses the same tokenizer the retriever uses, so the grouping agrees with how
 * retrieval already understands language: stop words removed, light suffix
 * folding, order-independent. Two customers phrasing the same question
 * differently therefore land in one bucket, which is the entire point of a
 * "frequently asked questions" and "knowledge gaps" list.
 *
 * Sorted and truncated because a fingerprint is an identity, not a summary: two
 * long questions sharing their first eight words are treated as one question
 * rather than fragmenting a genuine repeated question into three.
 */
export function questionFingerprint(question: string): string {
  const tokens = [...new Set(tokenize(question))].sort().slice(0, FINGERPRINT_TOKENS);
  return createHash("sha1").update(tokens.join(" ")).digest("hex").slice(0, 12);
}
