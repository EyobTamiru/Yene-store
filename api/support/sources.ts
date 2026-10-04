import type { RetrievedArticle } from "../../src/knowledge/types";

/**
 * ============================================================================
 *  AI SOURCE PRIORITY
 * ============================================================================
 *
 *  The product rule, made explicit and enforceable:
 *
 *    1. Current official knowledge base
 *    2. Authenticated platform data
 *    3. Approved support documentation
 *    4. General AI knowledge - ONLY for non-platform generic questions
 *
 *  TIER 4 IS NOT A SAFETY NET FOR YENE-STORE QUESTIONS.
 *
 *  If the official knowledge base does not cover something, the assistant must
 *  say so and offer a human. It must never close the gap with general
 *  knowledge about similar products - that is precisely the "invented
 *  information" failure this system exists to prevent.
 *
 *  This is enforced twice: the prompt states the precedence, and
 *  `enforceGrounding` in `ai.ts` discards any reply that cites nothing.
 */

export const SOURCE_PRIORITY = [
  {
    tier: 1,
    id: "official-kb",
    label: "Current official knowledge base",
    description:
      "Published Yene-Store articles written and reviewed by Yene Business Group.",
  },
  {
    tier: 2,
    id: "account-data",
    label: "Authenticated platform data",
    description:
      "Live values read from the signed-in account: package, subscription, orders, stock.",
  },
  {
    tier: 3,
    id: "support-docs",
    label: "Approved support documentation",
    description: "Reviewed troubleshooting and policy material for Yene-Store.",
  },
  {
    tier: 4,
    id: "general-knowledge",
    label: "General AI knowledge",
    description:
      "The model's own general knowledge. Usable ONLY for non-platform generic questions, never to fill a Yene-Store gap.",
  },
] as const;

export type SourceTierId = (typeof SOURCE_PRIORITY)[number]["id"];

/** The precedence block injected into the system prompt. */
export function sourcePriorityBlock(hasAccount: boolean): string {
  return [
    "SOURCE PRIORITY (highest first, never inverted):",
    "1. Current official knowledge base - the SOURCES below.",
    hasAccount
      ? "2. Authenticated platform data - the account facts below. This is authoritative for live values."
      : "2. Authenticated platform data - UNAVAILABLE: the customer is not signed in.",
    "3. Approved support documentation - only where it is cited as a source below.",
    "4. General knowledge - you may use it ONLY for non-platform generic questions",
    "   (e.g. what an invoice is). You must NEVER use it to answer a Yene-Store",
    "   question that the sources do not cover. A missing Yene-Store fact is a",
    "   reason to say you do not know, not a reason to guess.",
  ].join("\n");
}

/** Which tier a retrieved article came from. */
export function tierFor(hit: RetrievedArticle): SourceTierId {
  // Published articles are the official knowledge base. A draft neighbour is
  // support documentation that has not been approved for answering.
  return hit.article.status === "published" ? "official-kb" : "support-docs";
}
