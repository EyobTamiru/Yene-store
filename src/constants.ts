/**
 * Shared, user-facing constants for Yene AI Support.
 *
 * This module is imported by BOTH the browser client and the Express server,
 * so it must stay free of Node-only and browser-only APIs.
 *
 * DESIGN RULE: every string in this file is copy that a customer is allowed
 * to read. Nothing here may contain internal details, error codes or secrets.
 */

// ---------------------------------------------------------------------------
// Brand / design system
// ---------------------------------------------------------------------------
export const BRAND = {
  name: "Yene-Store",
  company: "Yene Business Group",
  aiName: "Yene AI Support",
  background: "#0D1117",
  accent: "#3DDC97",
} as const;

/** Real, published Yene Business Group contact channels. */
export const SUPPORT_CONTACT = {
  phone: "+251 964110744",
  email: "yenebusinessgroup@gmail.com",
  location: "Addis Ababa, Ethiopia",
} as const;

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------
export const GREETING_MESSAGE =
  "Hi! I'm Yene AI Support. I can help you understand Yene-Store, manage your business, find features, troubleshoot common problems, and connect you with a Yene Business Group support agent when needed.";

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------
import type { KnowledgeCategory } from "./knowledge/types";

export type QuickActionCategory = KnowledgeCategory;

export interface QuickAction {
  id: string;
  label: string;
  /** Message sent to the assistant when the chip is tapped. */
  prompt: string;
  category: QuickActionCategory;
  /** True when tapping the chip should open the handoff form, not the chat. */
  opensHandoff?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "how-it-works",
    label: "How does Yene-Store work?",
    prompt: "How does Yene-Store work?",
    category: "platform",
  },
  {
    id: "my-account",
    label: "My account",
    prompt: "I need help with my account.",
    category: "account",
  },
  {
    id: "my-package",
    label: "My package",
    prompt: "Can you tell me which package my business is on?",
    category: "packages",
  },
  {
    id: "store-help",
    label: "Store help",
    prompt: "I need help with my store on Yene-Store.",
    category: "store",
  },
  {
    id: "orders",
    label: "Orders",
    prompt: "I have a question about an order.",
    category: "orders",
  },
  {
    id: "promotions",
    label: "Promotions",
    prompt: "How do promotions work on Yene-Store?",
    category: "promotions",
  },
  {
    id: "inventory",
    label: "Inventory",
    prompt: "How do I manage inventory on Yene-Store?",
    category: "inventory",
  },
  {
    id: "billing",
    label: "Billing & subscription",
    prompt: "I have a question about billing or my subscription.",
    category: "billing",
  },
  {
    id: "contact-agent",
    label: "Contact support agent",
    prompt: "I want to talk to a Yene Business Group support agent.",
    category: "contact",
    opensHandoff: true,
  },
];

// ---------------------------------------------------------------------------
// Canned, customer-safe messages
// ---------------------------------------------------------------------------

/** Shown when the assistant has no approved knowledge to answer from. */
export const NO_INFORMATION_MESSAGE =
  "I don't have enough confirmed information in my Yene-Store knowledge base to answer that accurately, and I don't want to guess. I can connect you with a Yene Business Group support agent who can help.";

/** Shown when the question is account-specific but the visitor is a guest. */
export const AUTH_REQUIRED_MESSAGE =
  "That question is about your own account, so I need you to be signed in before I can look it up. Please sign in to Yene-Store, or I can connect you with a Yene Business Group support agent instead.";

/** Shown when the AI backend is down, times out, or returns something unusable. */
export const SERVICE_UNAVAILABLE_MESSAGE =
  "Yene AI Support is temporarily unavailable. You can still contact a Yene Business Group support agent.";

/** Appended when the model asked for a human. */
export const HUMAN_HANDOFF_PROMPT =
  "Would you like me to connect you with a Yene Business Group support agent now?";

/**
 * Section 3: the escalation wording.
 *
 * These are the exact customer-facing sentences the product specification
 * requires, kept here so the client and the server cannot drift apart.
 */

/** Shown while the assistant is checking something before deciding. */
export const INVESTIGATING_MESSAGE = "Let me check a few things...";

/** When a ticket is opened at the customer's request. */
export const CONTACT_AGENT_EXPLANATION =
  "I'll connect you with a Yene Business Group support agent. I'll also share the relevant conversation so you don't have to explain everything again.";

/** When the assistant could not resolve the problem automatically. */
export const UNRESOLVED_HANDOFF_MESSAGE =
  "I couldn't resolve this automatically. I'll connect you with a Yene Business Group support agent and provide them with the details of our conversation.";

/** Label on the button that starts a human handoff. */
export const CONTACT_SUPPORT_BUTTON_LABEL = "Contact Yene Business Group Support Agent";

/** Section 5: the live-chat button. */
export const TALK_TO_HUMAN_LABEL = "Talk to a Human";

/** Shown while switching from AI to human support. */
export const CONNECTING_AGENT_MESSAGE = "Connecting you to a support agent...";

/**
 * Shown when nobody is available. Verbatim per the specification.
 *
 * Note what is NOT here: no response time, no "we'll reply within X", no
 * estimate. An invented wait time is a promise the team cannot keep.
 */
export const AGENTS_UNAVAILABLE_MESSAGE =
  "All support agents are currently unavailable. Your request has been saved as a support ticket. We'll respond as soon as an agent is available.";

/** Shown when a human agent has picked the conversation up. */
export const AGENT_CONNECTED_PREFIX = "You are now connected to a Yene Business Group support agent";

/** Shown when the customer returns to AI after a human helped them. */
export const RETURNED_TO_AI_MESSAGE =
  "You're back with AI Support. A support agent has already worked on this, so I'll have that context.";

/** Banner in human mode once the agent resolves the issue. */
export const RESOLVED_RETURN_PROMPT =
  "This conversation has been marked as resolved by your support agent. You can go back to AI Support at any time.";

/** Mode labels, shown in the chat header. */
export const MODE_AI_LABEL = "AI Support";
export const MODE_HUMAN_LABEL = "Human Support";

/** Shown in the queue when a customer is waiting. */
export const WAITING_FOR_AGENT_MESSAGE =
  "You're in the support queue. A support agent will pick this up as soon as one is available.";


/** Shown on the escalation button inside a reply. */
export const CONNECT_AGENT_BUTTON_LABEL = "Connect me with a support agent";

/** Confirms a ticket was opened. `{ticketId}` is replaced by the real id. */
export const TICKET_CREATED_PREFIX =
  "Your support request has been created. Ticket reference:";

/** For account security, we hand over instead of trying to help. */
export const SECURITY_HANDOFF_PREFIX =
  "Account security matters are handled directly by a support agent, so I won't try to work through this in chat.";


/** Signed to the bottom of every AI reply. */
export const AI_DISCLAIMER =
  "Answers come from the Yene-Store knowledge base. For anything account-specific, a Yene Business Group support agent can verify the details for you.";

export const CONTACT_SUMMARY =
  `You can reach Yene Business Group support at ${SUPPORT_CONTACT.phone} or ${SUPPORT_CONTACT.email}.`;

/**
 *  Customer satisfaction (Section 7)
 *
 *  Asked once, after resolution, with the three options the specification
 *  requires. A rating and a written comment are optional, and asking for
 *  neither is a complete answer rather than a partial one.
 */

export type ResolutionAnswer = "yes" | "partially" | "no";

/** The exact question, verbatim from the specification. */
export const RESOLUTION_SURVEY_QUESTION = "Was your issue resolved?";

export const RESOLUTION_SURVEY_OPTIONS: { value: ResolutionAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "partially", label: "Partially" },
  { value: "no", label: "No" },
];

export const RESOLUTION_SURVEY_INTRO =
  "One last question before you go.";

export const RESOLUTION_SURVEY_RATING_PROMPT =
  "How would you rate the support you received?";

export const RESOLUTION_SURVEY_FEEDBACK_PROMPT =
  "Anything you would like us to improve?";

/** Shown once the customer has answered. */
export const RESOLUTION_SURVEY_THANKS =
  "Thank you. Your feedback is shared with the Yene Business Group support team and helps us improve.";

export const RESOLUTION_SURVEY_SUBMIT_LABEL = "Send feedback";
export const RESOLUTION_SURVEY_SKIP_LABEL = "Skip";
export const RESOLUTION_SURVEY_SENDING_LABEL = "Sending...";

/** 1 (poor) to 5 (excellent). Rendered as stars. */
export const MAX_SURVEY_RATING = 5;

/** Longest comment accepted. Anything longer is truncated, never rejected. */
export const MAX_SURVEY_COMMENT = 1000;

/** Maximum user-supplied history we will accept from the browser. */
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_MESSAGE_LENGTH = 2000;
