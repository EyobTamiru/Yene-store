import { INTENT_PATTERNS } from "./intents";
import type {
  EscalationDecision,
  EscalationReason,
  SupportIntent,
  TicketPriority,
} from "./types";

/**
 * ============================================================================
 *  ESCALATION DETECTION
 * ============================================================================
 *
 *  The product rule lists eleven conditions under which the assistant must
 *  offer a human agent. These are implemented as deterministic rules rather
 *  than left to the model, for the same reason the grounding rules are: a
 *  prompt is a request, not a control.
 *
 *  Every rule maps 1:1 to a condition in the specification, so the behaviour
 *  can be reviewed against the document rather than inferred.
 */

interface Rule {
  reason: EscalationReason;
  priority: TicketPriority;
  intent: SupportIntent;
  /** Match if any of these appear in the message. */
  patterns: RegExp[];
  /**
   * Set when the assistant must not attempt an automated answer. Account
   * security is the case that matters: handing over is the safe action.
   */
  suppressAnswer?: boolean;
  /** Only fires when the visitor is signed in. */
  requiresAuth?: boolean;
}

const RULES: Rule[] = [
  {
    reason: "customer-requested-human",
    priority: "normal",
    intent: "human-request",
    patterns: [
      /\b(speak|talk|chat)\s+to\s+(a\s+)?(human|person|agent|someone|representative)/i,
      /\b(human|real person|live agent|actual person)\b/i,
      /\b(contact|reach|get)\s+(a\s+)?(support\s+)?(agent|human|person|team)/i,
      /\b(escalat\w+|raise a (ticket|case))/i,
      /\bcall me\b/i,
    ],
  },
  {
    reason: "account-security",
    priority: "urgent",
    intent: "security-concern",
    suppressAnswer: true,
    patterns: [
      /\b(hacked|compromis\w+|stolen|unauthori[sz]ed|breach)\b/i,
      // "someone else has got into my account" - allow filler words between.
      /\b(someone|somebody|another person|another user|another business)\b[\s\w]{0,24}?\b(into|in to|access\w*|log(?:ged)? ?in|getting in)\b/i,
      /\b(locked out|can'?t log in|unable to log in|can'?t sign in|account locked)\b/i,
      /\b(suspicious|phish\w*|scam|fraud\w*)\b/i,
      /\b(reset|change)\s+my\s+password\b/i,
      /\b(two[- ]factor|2fa|otp)\b/i,
    ],
  },
  {
    reason: "payment-dispute",
    priority: "high",
    intent: "payment-dispute",
    suppressAnswer: true,
    patterns: [
      /\b(double|twice|duplicate)\s+(charged|charge|payment)\b/i,
      /\b(charged|billed|paid|invoice)\s+(me\s+)?(wrongly|incorrectly|twice|again|extra|too much)\b/i,
      /\b(money|payment|refund)\s+(hasn'?t|has not|never|didn'?t|did not)\s+(arriv|come|be received|refund)/i,
      /\b(refund|reimburse|chargeback|dispute)\b/i,
      /\bover[- ]?charged\b/i,
      /\bwhy (was|were) i (charged|billed)\b/i,
    ],
  },
  {
    reason: "quotation-request",
    priority: "normal",
    intent: "pricing-quotation",
    patterns: [
      /\b(quotation|quote|estimate|proposal|rate card)\b/i,
      /\bhow (much|many)\b.*\bcost/i,
      /\b(price|pricing|cost|fee|charge)\b[^.?]*\b(package|plan|subscription|super|standard|platinum|basic)\b/i,
      /\bget a (quote|quotation|price)\b/i,
    ],
  },
  {
    reason: "custom-development",
    priority: "normal",
    intent: "custom-development",
    patterns: [
      // "custom inventory system", "custom ERP", "custom workflow"...
      /\bcustom\b[\s\w]{0,20}?\b(erp|crm|inventory|stock|system|app\w*|workflow|dashboard|integration|api|module|portal)\b/i,
      /\bcustom(?:is|iz)ed\b/i,
      /\b(build|develop|create)\s+(me|us|my)\s+(a|an)\s+(system|app\w*|portal|tool)\b/i,
      /\b(integra\w+)\s+(with|to)\b/i,
      /\bexisting system|migrat\w+ to\b/i,
    ],
  },
  {
    reason: "complaint",
    priority: "high",
    intent: "complaint",
    patterns: [
      /\b(complain\w*|unacceptable|disappoint\w+|frustrat\w+|ridiculous|terrible|awful|worst)\b/i,
      /\bi'?m (not|very) (happy|satisfied|pleased)\b/i,
      /\bthis is (not working|broken|a joke)\b/i,
      /\b(worse|worsening)\s+than\b/i,
      /\b(formal complaint|report (your|a) (management|boss))\b/i,
    ],
  },
  {
    reason: "manual-account-change",
    priority: "normal",
    intent: "account-help",
    requiresAuth: true,
    patterns: [
      /\b(change|update|transfer|correct|fix)\s+(my\s+|our\s+|the\s+)?(business\s+)?(name|email|owner\w*|ownership|phone|address|number)\b/i,
      /\b(remove|delete|revoke)\s+(a\s+|an\s+)?(user|staff|employee|member)\b/i,
      /\b(add|invite)\s+(a\s+|an\s+)?(user|staff|employee)\b/i,
      /\btransfer\s+(the\s+)?(business|account|ownership)\b/i,
      /\b(delete|close|deactivate)\s+(my|our|the)\s+(account|business)\b/i,
    ],
  },
  {
    reason: "technical-investigation",
    priority: "normal",
    intent: "technical-problem",
    patterns: [
      /\b(error|exception|crash\w*|stack trace|500|404|403)\b/i,
      /\b(blank|white)\s+(screen|page)\b/i,
      /\bnot (loading|saving|syncing|responding|working)\b/i,
      /\b(won'?t|doesn'?t|does not|can'?t|cannot|unable to)\s+(load|open|save|send|upload|submit|log ?in|see)\b/i,
      /\b(spinning|buffering|tim(e|es) out|timing out)\b/i,
      /\bdata (is|are|has) (missing|gone|wrong|incorrect)\b/i,
    ],
  },
];

/** Best guess at the customer's goal. Matched rules win over heuristics. */
export function detectIntent(message: string, matched: Rule[] = []): SupportIntent {
  for (const rule of matched) {
    if (rule.patterns.some((pattern) => pattern.test(message))) return rule.intent;
  }
  for (const entry of INTENT_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(message))) return entry.intent;
  }
  return "unknown";
}

const PRIORITY_ORDER: TicketPriority[] = ["low", "normal", "high", "urgent"];

function highestPriority(priorities: TicketPriority[]): TicketPriority {
  return priorities.reduce<TicketPriority>(
    (worst, current) =>
      PRIORITY_ORDER.indexOf(current) > PRIORITY_ORDER.indexOf(worst) ? current : worst,
    "low",
  );
}

/**
 * Phrases meaning the customer is telling us the previous attempt did not work.
 * Two of these in a row is the "repeatedly unresolved" condition.
 */
const STILL_UNRESOLVED = [
  /\bstill\b/i,
  /\b(didn'?t|did not|doesn'?t|does not|hasn'?t|has not)\s+(work|help|fix|resolve|answer)\b/i,
  /\bnot (working|helping|helped|fixed|resolved|answered)\b/i,
  /\bno\s+(that'?s|its|it'?s)\s+(not|wrong)\b/i,
  /\bthat'?s\s+(not|incorrect)\b/i,
  /\b(same (again|problem|issue|error)|once again|already told you|as i said|like i said)\b/i,
  /\bno (help|progress|answer)\b/i,
  /\bkeeps? (happening|failing)\b/i,
];

/** True when the customer is signalling the issue is still open. */
export function indicatesStillUnresolved(message: string): boolean {
  return STILL_UNRESOLVED.some((pattern) => pattern.test(message));
}

export interface EscalationInput {
  message: string;
  isAuthenticated: boolean;
  /** Consecutive turns the customer has said things are still broken. */
  unresolvedStreak: number;
}

/**
 * Decide whether this turn must offer a human agent.
 *
 * `hasGroundedAnswer` is supplied by the caller *after* the answer is
 * produced, so the "does not know the answer" and "did not resolve" conditions
 * are judged against what the assistant was actually able to do this turn.
 */
export function evaluateEscalation(
  input: EscalationInput,
  hasGroundedAnswer = true,
): EscalationDecision {
  const { message, isAuthenticated, unresolvedStreak } = input;

  const matched = RULES.filter((rule) => {
    if (rule.requiresAuth && !isAuthenticated) return false;
    return rule.patterns.some((pattern) => pattern.test(message));
  });

  const reasons = new Set<EscalationReason>(matched.map((rule) => rule.reason));

  if (unresolvedStreak >= 2) reasons.add("repeatedly-unresolved");

  // "The AI fails to resolve the problem": either there was no grounded
  // answer, or the customer is telling us the answer did not help. A reply
  // that is grounded can still fail to resolve the issue.
  if (indicatesStillUnresolved(message)) reasons.add("unresolved");

  if (!hasGroundedAnswer) {
    reasons.add("unknown-answer");
  }

  const intent = detectIntent(message, matched);

  return {
    shouldEscalate: reasons.size > 0,
    reasons: [...reasons],
    // A manual contact with no matching rule is a normal ticket, not a "low"
    // one - a customer reaching out on their own is the baseline case.
    priority: matched.length > 0 ? highestPriority(matched.map((r) => r.priority)) : "normal",
    intent,
    suppressAutomatedAnswer: matched.some((rule) => rule.suppressAnswer),
  };
}
