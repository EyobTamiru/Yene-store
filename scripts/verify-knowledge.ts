/**
 * Knowledge-base verification script.
 *
 *   npm run test:knowledge
 *
 * Proves the guarantees the product depends on:
 *   1. The data-driven knowledge base loads and validates.
 *   2. A draft article is NEVER returned to the model as an answerable source.
 *   3. The real Yene-Store content is retrievable by ordinary phrasing.
 *   4. Pricing is never answered with a number.
 *   5. The custom ERP wording rule is present and intact.
 */

import { getArticles, getIssues } from "../src/knowledge/repository";
import { isAnswerable } from "../src/knowledge/types";
import {
  classifyQuery,
  getApprovedArticles,
  knowledgeBaseStats,
  retrieveArticles,
  tokenize,
} from "../src/knowledge/retrieval";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const articles = getArticles();

console.log("\n=== 1. The knowledge base loads with no errors ===\n");
{
  const errors = getIssues().filter((issue) => issue.level === "error");
  check("no validation errors", errors.length === 0, errors.map((e) => `${e.file}: ${e.message}`).join(" | "));
  check("articles found on disk", articles.length > 0, `found ${articles.length}`);
}

console.log("\n=== 2. No draft article can be used as a source ===\n");
for (const query of [
  "What is the price of the premium package?",
  "How many products can I add?",
  "What is your refund policy?",
  "How much does the Super package cost?",
  "Give me a quotation for Super",
]) {
  const leaked = retrieveArticles(query, { limit: 5 }).filter(
    (hit) => !isAnswerable(hit.article.status),
  );
  check(
    `"${query}" returns no unapproved source`,
    leaked.length === 0,
    leaked.map((h) => h.article.id).join(", "),
  );
}

console.log("\n=== 3. Platform content is retrievable ===\n");
const expected: [string, string][] = [
  ["how do I contact a human agent?", "support-contact"],
  ["what can you do, are you reliable?", "support-ai-scope"],
  ["what is yene store", "company-overview"],
  ["build digitize sell automate manage grow", "company-overview"],
  ["what is in a business profile", "features-business-profile"],
  ["do I get a subdomain", "features-yene-subdomain"],
  ["business.yene.store", "features-yene-subdomain"],
  ["how do I add a product to my store", "features-store"],
  ["how do I register my store in a mall", "features-malls"],
  ["which mall is a store in", "features-malls"],
  ["can my shop have two room numbers", "features-malls"],
  ["what is a mall store", "features-malls"],
  ["shop by mall directory", "features-malls"],
  ["can I run a discount campaign", "features-promotions"],
  ["where do I see my orders", "features-orders"],
  ["how do I track customer history", "features-customers"],
  ["low stock alerts and warehouses", "features-inventory"],
  ["show me sales and revenue analytics", "features-analytics"],
  ["roles and permissions for my employees", "features-business-management"],
  ["what is included in the basic package", "packages-basic"],
  ["what does standard give me", "packages-standard"],
  ["tell me about platinum", "packages-platinum"],
  ["what is the super package", "packages-super"],
  ["do you build a custom erp", "policy-custom-erp"],
  ["how much does super cost", "packages-pricing-and-quotation"],
];
for (const [query, id] of expected) {
  const hits = retrieveArticles(query, { limit: 5 });
  check(
    `"${query}" -> ${id}`,
    hits.some((hit) => hit.article.id === id),
    `got: ${hits.map((h) => h.article.id).join(", ") || "(nothing)"}`,
  );
}


console.log("\n=== 4. Pricing is never answered with a number ===\n");
for (const query of [
  "how much does super cost",
  "what is the price of standard",
  "what does yene store cost per month",
]) {
  const result = classifyQuery(query);
  check(
    `"${query}" routes to the pricing policy`,
    result.approved.some((h) => h.article.id === "packages-pricing-and-quotation"),
    `got: ${result.approved.map((h) => h.article.id).join(", ") || "(nothing)"}`,
  );
}

console.log("\n=== 5. Super must never state a price ===\n");
{
  const money = /\b\d[\d,.]*\s*(etb|birr|usd|eur|\$|€)/i;
  const offenders = getApprovedArticles().filter((a) => money.test(a.body));
  check("super article exists", !!articles.find((a) => a.id === "packages-super"));
  check(
    "no approved article states a monetary amount",
    offenders.length === 0,
    offenders.map((a) => a.id).join(", "),
  );
  const pricing = articles.find((a) => a.id === "packages-pricing-and-quotation");
  check(
    "the pricing policy states Super is custom",
    /Super pricing is custom/i.test(pricing?.body ?? ""),
  );
}

console.log("\n=== 6. The custom ERP wording rule is intact ===\n");
{
  const erp = articles.find((a) => a.id === "policy-custom-erp");
  const wording =
    "An ERP-style system customized by Yene Business Group for the customer's business.";
  check("policy-custom-erp exists", !!erp);
  check("contains the exact approved wording", (erp?.body ?? "").includes(wording));
  check("forbids describing it as a copy", /copy|clone/i.test(erp?.body ?? ""));
}

console.log("\n=== 7. Undocumented topics are recognised and refused ===\n");
for (const query of [
  "I cannot sign in",
  "how do I reset my password",
  "I have a billing question",
  "the page will not load",
]) {
  const result = classifyQuery(query);
  check(
    `"${query}" is flagged as undocumented`,
    result.topicIsUndocumented,
    `approved=${result.approved.map((h) => h.article.id).join(",") || "-"} drafts=${result.drafts.map((h) => h.article.id).join(",") || "-"}`,
  );
}

console.log("\n=== 8. Data integrity ===\n");
{
  const ids = articles.map((a) => a.id);
  check("ids are unique", new Set(ids).size === ids.length);
  check("every article has keywords", articles.every((a) => a.keywords.length > 0));
  check("no approved article contains a TODO", getApprovedArticles().every((a) => !/TODO/i.test(a.body)));
  check("no approved article is empty", getApprovedArticles().every((a) => a.body.trim().length > 40));
  check("every article has a lastReviewed date", articles.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.lastReviewed)));
  check(
    "no article names a competing ERP",
    articles.every((a) => !/\b(sap|oracle|odoo|quickbooks)\b/i.test(a.body)),
  );
}

console.log("\n=== 9. Tokenizer ===\n");
check("stems plurals", tokenize("orders").includes("order"), tokenize("orders").join(","));
check("drops stop words", !tokenize("what is the").includes("the"));

const stats = knowledgeBaseStats();
console.log(`\nKnowledge base: ${stats.published} approved, ${stats.draft} draft, ${stats.total} total`);
if (stats.draft > 0) {
  console.log(
    `\nNOTE: ${stats.draft} topic(s) are still drafts, so the assistant refuses them\n` +
      `rather than guessing. See knowledge-base/ for the placeholders to write.`,
  );
}
console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
