/**
 * Knowledge-management verification - the Section 6 contract.
 *
 *   npm run test:knowledge-mgmt
 *
 * Proves:
 *   1. Exactly the twenty official categories exist, with human labels.
 *   2. Statuses are Draft / Published / Archived, and only Published is
 *      answerable - drafts route, archived articles are never served.
 *   3. Every article carries the required fields.
 *   4. Version control keeps prior revisions with who/when.
 *   5. Source priority forbids general knowledge filling a Yene-Store gap.
 */

import {
  CATEGORY_LABELS,
  DEFAULT_LANGUAGE,
  isAnswerable,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  STATUS_LABELS,
  type KnowledgeArticle,
} from "../src/knowledge/types";
import { getArticles, getVersions, recordVersion } from "../src/knowledge/repository";
import { SOURCE_PRIORITY, sourcePriorityBlock } from "../api/support/sources";
import { retrieveArticles } from "../src/knowledge/retrieval";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const REQUIRED_CATEGORY_LABELS = [
  "Platform", "Account", "Business Profile", "Store", "Products", "Orders",
  "Customers", "Inventory", "Promotions", "Analytics", "Packages", "Billing",
  "Subscription", "Payments", "Security", "Troubleshooting", "Policies",
  "Frequently Asked Questions", "Tutorials", "Contact Information",
];

console.log("\n=== 1. The twenty official categories ===\n");
{
  check("exactly 20 categories", KNOWLEDGE_CATEGORIES.length === 20, String(KNOWLEDGE_CATEGORIES.length));
  for (const label of REQUIRED_CATEGORY_LABELS) {
    check(`category "${label}" exists`, Object.values(CATEGORY_LABELS).includes(label));
  }
  check("every category has a label", KNOWLEDGE_CATEGORIES.every((c) => !!CATEGORY_LABELS[c]));
  check("no duplicate labels", new Set(Object.values(CATEGORY_LABELS)).size === 20);
}

console.log("\n=== 2. Statuses: Draft / Published / Archived ===\n");
{
  check("exactly three statuses", KNOWLEDGE_STATUSES.length === 3);
  check("labels are Draft/Published/Archived",
    STATUS_LABELS.draft === "Draft" &&
    STATUS_LABELS.published === "Published" &&
    STATUS_LABELS.archived === "Archived");

  check("published is answerable", isAnswerable("published"));
  check("draft is NOT answerable", !isAnswerable("draft"));
  check("archived is NOT answerable", !isAnswerable("archived"));

  const hits = retrieveArticles("how do I create a promotion campaign", { limit: 5 });
  check(
    "only published articles are ever served",
    hits.every((hit) => hit.article.status === "published"),
    hits.map((h) => `${h.article.id}:${h.article.status}`).join(", "),
  );
}

console.log("\n=== 3. Required article fields ===\n");
{
  const articles = getArticles();
  check("articles loaded", articles.length > 0, String(articles.length));

  const required: (keyof KnowledgeArticle)[] = [
    "id", "title", "category", "body", "keywords", "language",
    "status", "version", "createdBy", "updatedBy", "createdAt", "updatedAt",
  ];
  for (const field of required) {
    const missing = articles.filter((a) => !a[field]);
    check(`every article has "${field}"`, missing.length === 0, missing.map((a) => a.id).join(", "));
  }

  check("every language is set", articles.every((a) => !!a.language), DEFAULT_LANGUAGE);
  check("every version is >= 1", articles.every((a) => a.version >= 1));
  check("every category is registered",
    articles.every((a) => (KNOWLEDGE_CATEGORIES as readonly string[]).includes(a.category)));
  check("timestamps parse", articles.every((a) => !Number.isNaN(Date.parse(a.updatedAt))));
}

console.log("\n=== 4. Version control retains who and when ===\n");
{
  const sample: KnowledgeArticle = {
    ...getArticles()[0],
    id: "test-versioning",
    version: 1,
    body: "Version one of the test article body.",
  };

  recordVersion(sample, "Yonas", "initial");
  const afterFirst = getVersions("test-versioning");
  check("first revision recorded", afterFirst.length === 1, String(afterFirst.length));
  check("records who changed it", afterFirst[0].changedBy === "Yonas");
  check("records when", !Number.isNaN(Date.parse(afterFirst[0].changedAt)));
  check("records the note", afterFirst[0].changeNote === "initial");
  check("is marked current", afterFirst[0].isCurrent === true);

  recordVersion({ ...sample, version: 2, body: "Version two." }, "Selam", "second edit");
  const afterSecond = getVersions("test-versioning");
  check("second revision recorded", afterSecond.length === 2, String(afterSecond.length));
  check("prior revision retained", afterSecond.some((v) => v.version === 1));
  check("different authors recorded", new Set(afterSecond.map((v) => v.changedBy)).size === 2);
  check("only one revision is current", afterSecond.filter((v) => v.isCurrent).length === 1);
  check("newest is the current one", afterSecond[0].version === 2 && afterSecond[0].isCurrent);
}

console.log("\n=== 5. Source priority forbids general-knowledge fill ===\n");
{
  check("four tiers", SOURCE_PRIORITY.length === 4);
  check("tiers are numbered 1..4", SOURCE_PRIORITY.every((t, i) => t.tier === i + 1));
  check("tier 1 is the official knowledge base", SOURCE_PRIORITY[0].id === "official-kb");
  check("tier 2 is authenticated platform data", SOURCE_PRIORITY[1].id === "account-data");
  check("tier 3 is approved support documentation", SOURCE_PRIORITY[2].id === "support-docs");
  check("tier 4 is general knowledge", SOURCE_PRIORITY[3].id === "general-knowledge");

  // Normalise whitespace: the block is line-wrapped, and a test should check
  // the meaning rather than the wrapping.
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, " ");
  const withAccount = flat(sourcePriorityBlock(true));
  const withoutAccount = flat(sourcePriorityBlock(false));

  check("block states the knowledge base is highest priority", withAccount.includes("highest first"));
  check("block forbids general knowledge for Yene-Store questions",
    withAccount.includes("never use it to answer a yene-store question"));
  check("a missing Yene-Store fact is a reason to say so",
    withAccount.includes("reason to say you do not know"));
  check("tells the model when account data is unavailable", withoutAccount.includes("unavailable"));
}

console.log(failures === 0 ? "\nALL KNOWLEDGE-MANAGEMENT CHECKS PASSED\n" : "\n" + failures + " CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);
