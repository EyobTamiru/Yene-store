/**
 * ============================================================================
 *  CATEGORY TAXONOMY MIGRATION
 * ============================================================================
 *
 *  Run with:  npx tsx scripts/migrate-categories.ts --apply
 *
 *  The board moved from a 14-section product taxonomy to the 18-section
 *  classifieds taxonomy in `src/platform/categories.ts`. Three things had to move
 *  with it, or the marketplace would have gone quietly blank:
 *
 *    1. `platform-categories.json` is REBUILT from the new source of truth. It is
 *       a data file, so editing the TypeScript does not edit it, and the seeder is
 *       additive - it would never have removed the fourteen old rows.
 *    2. Every product is RE-FILED under its new category id. A product pointing at
 *       a category that no longer exists is invisible in search and in the
 *       category feed, with no error anywhere - the failure this prevents.
 *    3. Inventory items are re-filed too, because they carry the same id.
 *
 *  DRY RUN BY DEFAULT. It prints what it would change and writes nothing until
 *  `--apply` is passed, because this rewrites files a shop is trading from.
 *  Products are never deleted: one with no sensible new home keeps its old
 *  category rather than vanishing, and the script reports each one.
 */

import fs from "node:fs";
import path from "node:path";
import { INITIAL_CATEGORIES, buildInitialSubcategories } from "../src/platform/categories";
import { CATEGORY_MOVES, SUBCATEGORY_MOVES } from "./category-moves";

const dataDir = path.resolve(process.cwd(), "data");
const apply = process.argv.includes("--apply");

function read<T>(file: string): T[] {
  const full = path.join(dataDir, file);
  if (!fs.existsSync(full)) return [];
  return JSON.parse(fs.readFileSync(full, "utf8")) as T[];
}

function write(file: string, value: unknown): void {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Rebuild the category file
// ---------------------------------------------------------------------------

const rebuilt = [...INITIAL_CATEGORIES, ...buildInitialSubcategories()];
const mainIds = new Set(INITIAL_CATEGORIES.map((category) => category.id));
const allIds = new Set(rebuilt.map((category) => category.id));
const childCount = rebuilt.length - INITIAL_CATEGORIES.length;

console.log(
  `Categories: ${INITIAL_CATEGORIES.length} main, ${childCount} sub, ${rebuilt.length} total`,
);

// A duplicate id here would silently drop a whole section from the nav.
if (allIds.size !== rebuilt.length) {
  console.error("FAIL: duplicate category ids in the new taxonomy. Aborting.");
  process.exit(1);
}

// Every subcategory must point at a main category that exists, or the two-level
// nav would render an unreachable child.
const orphans = rebuilt.filter((c) => c.parentId !== null && !mainIds.has(c.parentId));
if (orphans.length > 0) {
  console.error(
    `FAIL: ${orphans.length} subcategories point at a missing parent: ` +
      orphans.map((c) => `${c.id} -> ${c.parentId}`).join(", "),
  );
  process.exit(1);
}

if (apply) write("platform-categories.json", rebuilt);
else console.log("  categories: (dry run - pass --apply to write)");

// ---------------------------------------------------------------------------
// 2. Re-file products
// ---------------------------------------------------------------------------

interface Filed {
  id: string;
  categoryId: string;
  subcategoryId: string | null;
}

const products = read<Filed>("platform-products.json");
let changed = 0;
const orphaned: string[] = [];

for (const product of products) {
  const nextMain = CATEGORY_MOVES[product.categoryId] ?? product.categoryId;
  const nextSub = product.subcategoryId
    ? (SUBCATEGORY_MOVES[product.subcategoryId] ?? product.subcategoryId)
    : null;

  if (!mainIds.has(nextMain)) {
    // Left alone on purpose: Section 17 says a category change must never delete
    // a product, so an unmappable one keeps its row and is reported.
    orphaned.push(`${product.id} (${product.categoryId})`);
    continue;
  }

  // A subcategory is only kept when the NEW parent actually owns it; otherwise
  // the parent alone is the honest answer rather than a dangling child id.
  const owner = nextSub ? rebuilt.find((c) => c.id === nextSub)?.parentId : null;
  const sub = owner === nextMain ? nextSub : null;

  if (nextMain !== product.categoryId || sub !== product.subcategoryId) changed += 1;
  product.categoryId = nextMain;
  product.subcategoryId = sub;
}

console.log(`Products re-filed: ${changed} of ${products.length}`);
for (const note of orphaned) console.warn(`  WARN ${note} has no new home - left unchanged`);
if (apply) write("platform-products.json", products);

// ---------------------------------------------------------------------------
// 3. Re-file inventory items
// ---------------------------------------------------------------------------

const inventory = read<{ id: string; categoryId: string }>("platform-inventory-items.json");
for (const item of inventory) {
  const next = CATEGORY_MOVES[item.categoryId] ?? item.categoryId;
  if (mainIds.has(next)) item.categoryId = next;
}
console.log(`Inventory items re-filed: ${inventory.length}`);
if (apply) write("platform-inventory-items.json", inventory);

console.log(apply ? "\nMigration applied." : "\nDry run only. Re-run with --apply to write.");