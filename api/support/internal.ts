/**
 * ============================================================================
 *  INTERNAL INFORMATION GUARD
 * ============================================================================
 *
 *  Section 8 lists what must never be exposed to a customer. The existing leak
 *  filter in `ai.ts` covers credentials and stack traces. This module owns the
 *  rest of that list, and the parts of it that are specific to this system:
 *
 *    - system prompts and hidden instructions
 *    - database credentials and connection strings
 *    - internal notes and the AI handover brief
 *    - security configuration (capability names, env var names, token names)
 *    - private administrator information
 *    - other customers' information
 *
 *  WHY A SEPARATE MODULE
 *  ---------------------
 *  `ai.ts` already has a guard, and duplicating it would mean two answers to
 *  "could this reach a customer?". Instead this exports one predicate that
 *  `ai.ts` calls, and one that the verification suite can test directly with
 *  adversarial strings. Adding a category of forbidden content means adding a
 *  pattern here, and every existing reply is checked against it.
 *
 *  THE DELIBERATE LIMITATION
 *  -------------------------
 *  A pattern list catches disclosure that LOOKS like internal content. It
 *  cannot catch a model that paraphrases a secret convincingly, because at that
 *  point the text no longer contains the pattern. That is why the strongest
 *  control remains upstream: internal material is never put in a place the
 *  model can read in the first place. This filter is the backstop, not the wall.
 */

/** Credential and connection-string shapes. */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // postgres://user:pass@host, mysql://, mongodb+srv://, redis://...
  /\b(postgres|postgresql|mysql|mongodb\+srv|mongodb|redis|amqp)\s*:\/\/[^\s"']*:[^\s"'@]+@/i,
  // Connection strings and DSNs.
  /\b(DATABASE_URL|DB_PASSWORD|DB_PASS|SQLALCHEMY_DATABASE_URI)\b/i,
  // A private key block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** The system prompt, the hidden rules, and anything that reads like them. */
const PROMPT_PATTERNS: RegExp[] = [
  /\bsystem\s*(prompt|instruction|message)s?\b/i,
  /\b(hidden|secret|internal)\s+(instruction|rule|prompt|directive)s?\b/i,
  /\b(you are|your)\s+(told|instructed|configured)\s+to\b/i,
  /\bmy\s+(instruction|rule|guideline|constraint)s?\s+(are|is)\b/i,
  /\b(above|following)\s+(rule|instruction|constraint|directive)s?\b/i,
  /\bHARD_RULES\b/,
  /\bsource\s+priority\b/i,
  // Quoting the prompt back verbatim.
  /===\s*SOURCES\s*\(/i,
  /===\s*ACCOUNT ACCESS\s*===/i,
];

/** Internal notes, the handover brief, and staff-only reasoning. */
const INTERNAL_MATERIAL_PATTERNS: RegExp[] = [
  /\binternal\s+note\b/i,
  /\bAI\s+(handover\s+brief|summary)\b/i,
  /\balready\s+tried\b/i,
  /\bsuggested\s+next\s+steps\b/i,
  /\bescalation\s+reason\s*\(?s?\)?\s*:/i,
  /\bchain[- ]of[- ]thought\b/i,
];

/**
 * Security configuration.
 *
 * These are the names a support agent sees in the UI, and the environment
 * variables that switch behaviour. None of them mean anything to a customer,
 * so all of them are refused.
 */
const SECURITY_CONFIG_PATTERNS: RegExp[] = [
  // Capability identifiers from roles.ts.
  /\b(customer\.phone\.view|ticket\.view\.all|ticket\.note\.view|analytics\.view|staff\.manage|knowledge-gap\.manage)\b/,
  // The environment variables that configure this service.
  /\b(YENE_[A-Z_]+|GEMINI_API_KEY|TELEGRAM_[A-Z_]+|AUTH_MODE|NODE_ENV|DB_[A-Z_]+)\b/,
  // The admin token's own name.
  /\bYENE_KB_ADMIN_TOKEN\b/,
  // Our own internal routes.
  /\/api\/(support-admin|live-staff|admin)\b/,
];

/** Private administrator information. */
const ADMIN_INFO_PATTERNS: RegExp[] = [
  // Another staff member's name, role or address.
  /\b(bereket|selam|yonas)\b.*@(?:yenebusinessgroup|[\w-]+\.\w+)/i,
  /\bstaff-[0-9]+\b/,
  // Role and permission discussion.
  /\b(super[- ]admin|support manager|senior support agent)\b/i,
];

/**
 * Another customer's information.
 *
 * Deliberately narrow. A generic email pattern is already handled by the
 * analytics redactor; what matters here is the shape of a business or account
 * reference that is not the caller's own.
 */
const OTHER_CUSTOMER_PATTERNS: RegExp[] = [
  /\bbusiness[_ ]?id\s*[:=]\s*\S/i,
  /\btenant[_ ]?id\s*[:=]\s*\S/i,
];

const ALL_PATTERNS: RegExp[] = [
  ...CREDENTIAL_PATTERNS,
  ...PROMPT_PATTERNS,
  ...INTERNAL_MATERIAL_PATTERNS,
  ...SECURITY_CONFIG_PATTERNS,
  ...ADMIN_INFO_PATTERNS,
  ...OTHER_CUSTOMER_PATTERNS,
];

/** The categories, so a failure can be attributed rather than just detected. */
export const INTERNAL_CATEGORIES = [
  "credential",
  "system-prompt",
  "internal-material",
  "security-config",
  "admin-info",
  "other-customer",
] as const;

export type InternalCategory = (typeof INTERNAL_CATEGORIES)[number];

const CATEGORY_PATTERNS: Record<InternalCategory, RegExp[]> = {
  credential: CREDENTIAL_PATTERNS,
  "system-prompt": PROMPT_PATTERNS,
  "internal-material": INTERNAL_MATERIAL_PATTERNS,
  "security-config": SECURITY_CONFIG_PATTERNS,
  "admin-info": ADMIN_INFO_PATTERNS,
  "other-customer": OTHER_CUSTOMER_PATTERNS,
};

/** Every category this text trips, so callers can log which one matched. */
export function detectInternalLeak(text: string): InternalCategory[] {
  return INTERNAL_CATEGORIES.filter((category) =>
    CATEGORY_PATTERNS[category].some((pattern) => pattern.test(text)),
  );
}

/** True when the text must never reach a customer. */
export function containsInternalInformation(text: string): boolean {
  return ALL_PATTERNS.some((pattern) => pattern.test(text));
}
