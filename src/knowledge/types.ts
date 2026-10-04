/**
 * Types for the Yene-Store knowledge base.
 *
 * CONTENT LIVES IN `knowledge-base/<category>/<slug>.md`, NOT HERE.
 * This file is the schema only. Yene Business Group updates the product by
 * editing markdown; nothing here needs to change when a feature or price does.
 *
 * The `status` field is the enforcement mechanism for the product rule
 * "the AI must NOT invent information":
 *
 *  - "approved"  official, reviewed content. The assistant is allowed to make
 *                factual claims using it.
 *  - "draft"     a placeholder for a topic Yene-Store has, but whose official
 *                wording has not been supplied yet. The assistant may use it
 *                ONLY to understand what the user is asking about and to route
 *                them. It must never present its body as fact.
 *
 * Nothing else may be treated as a source of truth.
 */

export type KnowledgeStatus = "draft" | "published" | "archived";

/**
 * The twenty official knowledge categories.
 *
 * Declared as a const array so the admin validator, the category picker, the
 * model's response schema and the tests can never drift apart.
 */
export const KNOWLEDGE_CATEGORIES = [
  "platform",
  "account",
  "business-profile",
  "store",
  "products",
  "orders",
  "customers",
  "inventory",
  "promotions",
  "analytics",
  "packages",
  "billing",
  "subscription",
  "payments",
  "security",
  "troubleshooting",
  "policies",
  "faq",
  "tutorials",
  "contact",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** Human labels for the admin UI. */
export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  platform: "Platform",
  account: "Account",
  "business-profile": "Business Profile",
  store: "Store",
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  inventory: "Inventory",
  promotions: "Promotions",
  analytics: "Analytics",
  packages: "Packages",
  billing: "Billing",
  subscription: "Subscription",
  payments: "Payments",
  security: "Security",
  troubleshooting: "Troubleshooting",
  policies: "Policies",
  faq: "Frequently Asked Questions",
  tutorials: "Tutorials",
  contact: "Contact Information",
};

export const KNOWLEDGE_STATUSES = ["draft", "published", "archived"] as const;

export const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const KNOWLEDGE_AUDIENCES = [
  "customer",
  "business-owner",
  "employee",
  "all",
] as const;

export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];

/** Default language. Articles may be authored in any supported language. */
export const DEFAULT_LANGUAGE = "en";

/**
 * How much of the knowledge base is authoritative enough to answer from.
 *
 *   published  reviewed official content - the only thing the model may assert
 *   draft      in progress; recognised so routing works, never quoted as fact
 *   archived   superseded; retained for history, never served
 */
export function isAnswerable(status: KnowledgeStatus): boolean {
  return status === "published";
}

export interface KnowledgeArticle {
  /** Stable kebab-case id, e.g. "store-checkout". Never reuse an id. */
  id: string;
  category: KnowledgeCategory;
  title: string;
  audience: KnowledgeAudience;
  status: KnowledgeStatus;
  /** BCP-47 style tag, e.g. "en", "am", "fr". */
  language: string;
  /** Increments on every save. Starts at 1. */
  version: number;
  /**
   * Search terms. Write the words a real user would type, including synonyms
   * and local phrasing, because retrieval is keyword based.
   */
  keywords: string[];
  /** The markdown answer body. This is what the assistant may quote from. */
  body: string;
  /** ISO date (YYYY-MM-DD). */
  lastReviewed: string;
  reviewedBy: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /**
   * True when the article describes a live account-specific value (price,
   * order state, stock level...). The assistant states these only from the
   * authenticated account API, never from this file.
   */
  requiresAccountData?: boolean;
  /** Ids of related articles, used to pull in neighbouring context. */
  related?: string[];
}

/** A problem found while loading or validating an article. */
export interface ValidationIssue {
  file: string;
  id?: string;
  level: "error" | "warning";
  message: string;
}

/** A single scored hit from the retrieval step. */
export interface RetrievedArticle {
  article: KnowledgeArticle;
  score: number;
}

/** The result of loading the knowledge base from disk. */
export interface KnowledgeBaseSnapshot {
  articles: KnowledgeArticle[];
  issues: ValidationIssue[];
  loadedAt: number;
}

/**
 * One retained revision of an article.
 *
 * A new version is written BEFORE the live file is replaced, so history can
 * never be lost by a failed or partial save.
 */
export interface KnowledgeVersion {
  id: string;
  articleId: string;
  version: number;
  title: string;
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  language: string;
  keywords: string[];
  body: string;
  /** Who made the change. */
  changedBy: string;
  /** When they made it. */
  changedAt: string;
  /** Optional note explaining the change. */
  changeNote?: string;
  /** True when this revision is the one currently on disk. */
  isCurrent: boolean;
}
