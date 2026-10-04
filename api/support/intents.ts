import type { QuickActionCategory } from "../../src/constants";
import type { EscalationReason, SupportIntent } from "./types";

/**
 * What the customer is trying to accomplish, and what an agent should do next.
 *
 * This is deliberately data, not prose written at runtime: the handover brief
 * is assembled from these values, which is what keeps the summary factual
 * instead of speculative.
 */

/** Phrases that reveal the underlying goal. Order matters - first match wins. */
export const INTENT_PATTERNS: { intent: SupportIntent; patterns: RegExp[] }[] = [
  { intent: "security-concern", patterns: [/\b(hacked|compromis|locked out|phish|scam|suspicious|2fa|password|unauthori[sz]ed)\b/i] },
  { intent: "payment-dispute", patterns: [/\b(refund|chargeback|dispute|double charged|invoice|payment|billing|charged)\b/i] },
  { intent: "complaint", patterns: [/\b(complain|frustrat|unacceptable|disappoint|ridiculous|terrible)\w*/i] },
  { intent: "custom-development", patterns: [/\b(custom|bespoke|integrat\w+|develop\w*|migrat\w+|api)\b/i] },
  { intent: "pricing-quotation", patterns: [/\b(pric\w+|cost|quotation|quote|estimate|fee|budget|afford|rate card)\w*/i] },
  { intent: "order-issue", patterns: [/\b(order|checkout|cart|purchase|delivery|shipment)\w*/i] },
  { intent: "inventory-issue", patterns: [/\b(inventory|stock|warehouse|branch|supplier|sku|restock)\w*/i] },
  { intent: "promotion-setup", patterns: [/\b(promotion|discount|coupon|campaign|offer|sale)\w*/i] },
  { intent: "analytics-reporting", patterns: [/\b(analytic|report|sales figure|revenue|dashboard|statistic|performance)\w*/i] },
  { intent: "package-inquiry", patterns: [/\b(package|plan|tier|subscription level|upgrade|downgrade)\w*/i] },
  { intent: "account-help", patterns: [/\b(account|profile|login|log in|sign in|password|user|staff|permission|role)\w*/i] },
  { intent: "technical-problem", patterns: [/\b(error|bug|broken|not working|crash|blank|loading|stuck|freeze)\w*/i] },
  { intent: "human-request", patterns: [/\b(human|agent|person|representative|support team|call me)\b/i] },
  { intent: "product-information", patterns: [/\b(what is|how does|explain|feature|can i|do you|does it)\b/i] },
];

/** The goal an agent should keep in mind, per intent. */
export const INTENT_GOAL: Record<SupportIntent, string> = {
  "product-information": "Understand how a Yene-Store feature works.",
  "account-help": "Get the account or profile set up correctly.",
  "package-inquiry": "Understand which package and limits apply.",
  "pricing-quotation": "Get an accurate, official price or a quotation.",
  "order-issue": "Resolve an issue with a specific order.",
  "inventory-issue": "Resolve an inventory or stock issue.",
  "promotion-setup": "Set up or fix a promotion.",
  "analytics-reporting": "Get the reporting or analytics they need.",
  "technical-problem": "Get a technical fault investigated and fixed.",
  "security-concern": "Secure the account and verify who accessed it.",
  "payment-dispute": "Resolve a disputed or incorrect payment.",
  "complaint": "Have a complaint addressed.",
  "custom-development": "Scope custom development or integration work.",
  "human-request": "Speak to a human agent.",
  "unknown": "Unclear - a human needs to classify this.",
};


/** Investigation checklist an agent should work through, per intent. */
export const INTENT_NEXT_STEPS: Record<SupportIntent, string[]> = {
  "product-information": [
    "Confirm which part of the question the knowledge base could not answer",
  ],
  "account-help": [
    "Verify the caller's role and permissions",
    "Confirm the exact screen they were on",
  ],
  "package-inquiry": [
    "Check the package configured on the account",
    "Confirm the limits configured for that package",
  ],
  "pricing-quotation": [
    "Confirm the official package pricing",
    "Arrange a quotation with the business development team",
  ],
  "order-issue": [
    "Pull the specific order record",
    "Check the current order status",
    "Check the fulfilment history for that customer",
  ],
  "inventory-issue": [
    "Check recorded stock levels for the affected items",
    "Check recent stock movements and adjustments",
    "Check warehouse and branch configuration",
  ],
  "promotion-setup": [
    "Check the promotion configuration",
    "Check the package promotion limits",
    "Confirm the promotion is published to the Yene subdomain",
  ],
  "analytics-reporting": [
    "Confirm which report and date range the customer needs",
    "Check the underlying data",
  ],
  "technical-problem": [
    "Reproduce the issue",
    "Check service status and recent changes",
    "Check browser and account configuration",
  ],
  "security-concern": [
    "Verify the account holder's identity before sharing anything",
    "Review recent sign-in and access history",
    "Force a credential reset and check for other active sessions",
  ],
  "payment-dispute": [
    "Pull the transaction and invoice record",
    "Compare the charge against the agreed package",
    "Escalate to billing for a refund decision",
  ],
  "complaint": [
    "Review the full conversation history",
    "Acknowledge the impact to the customer",
    "Escalate to the business owner",
  ],
  "custom-development": [
    "Capture the requirements",
    "Assess scope, timeline and dependencies",
    "Hand to the Yene Business Group development team",
  ],
  "human-request": ["Review the conversation history", "Follow up with the customer"],
  "unknown": [
    "Read the full conversation history",
    "Classify the issue and route it to the right team",
  ],
};

export function intentGoal(intent: SupportIntent): string {
  return INTENT_GOAL[intent] ?? INTENT_GOAL.unknown;
}

export function intentNextSteps(intent: SupportIntent): string[] {
  return INTENT_NEXT_STEPS[intent] ?? INTENT_NEXT_STEPS.unknown;
}

/** Customer-facing label for an escalation, used in the ticket subject. */
export const REASON_LABELS: Record<EscalationReason, string> = {
  "unknown-answer": "No confirmed answer available",
  "customer-requested-human": "Customer requested a human agent",
  "account-security": "Account security concern",
  "payment-dispute": "Payment dispute",
  "manual-account-change": "Manual account change requested",
  "technical-investigation": "Technical investigation required",
  "custom-development": "Custom development enquiry",
  "complaint": "Complaint",
  "quotation-request": "Quotation requested",
  "unresolved": "Issue not resolved automatically",
  "repeatedly-unresolved": "Still unresolved after repeated attempts",
};

/** Route the ticket to the right part of the product. */
export function escalationCategory(reasons: EscalationReason[]): QuickActionCategory {
  if (reasons.includes("account-security")) return "account";
  if (reasons.includes("payment-dispute")) return "billing";
  if (reasons.includes("complaint")) return "contact";
  if (reasons.includes("custom-development")) return "platform";
  if (reasons.includes("quotation-request")) return "packages";
  return "contact";
}
