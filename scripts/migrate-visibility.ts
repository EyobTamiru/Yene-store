/**
 * One-off data migration: give every existing mall unit a `listable` flag.
 *
 * WHY A MIGRATION RATHER THAN A DEFAULT AT READ TIME
 * -------------------------------------------------
 * `listable` was added after the first `platform-mall-units.json` had already
 * been written, so every row saved before it has no such key. The code treats a
 * missing key as `true` (`listable !== false`), so behaviour is already correct -
 * but a checkbox reading `undefined` renders UNCHECKED in React, which would show
 * an advertised counter as unlisted until somebody touched it. Writing the flag
 * into the rows makes the stored data say what the code already assumes.
 *
 * Idempotent: rows that already carry the flag are left exactly as they are, so
 * running this twice cannot overwrite an administrator's hide.
 *
 * Run with `npm run migrate:listable`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "data", "platform-mall-units.json");
const DATA_DIR = join(process.cwd(), "data");

interface Unit {
  id: string;
  mallId: string;
  floor: string;
  number: string;
  listable?: boolean;
}

const rows = JSON.parse(readFileSync(FILE, "utf8")) as Unit[];
let added = 0;
let alreadySet = 0;

for (const unit of rows) {
  if (unit.listable === true || unit.listable === false) {
    alreadySet += 1;
    continue;
  }
  // A row with no flag was written before the feature existed, so it was on the
  // market. Defaulting to `true` restores that, which is what the reader
  // already assumes.
  unit.listable = true;
  added += 1;
}

writeFileSync(FILE, JSON.stringify(rows), "utf8");
console.log(`platform-mall-units.json: ${added} flag(s) added, ${alreadySet} already set, ${rows.length} total.`);

/**
 * The same treatment for the malls themselves, which gained `visible` at the
 * same time. A mall with no `visible` key is shown, which is what it was.
 */
const MALLS = join(DATA_DIR, "platform-malls.json");
const malls = JSON.parse(readFileSync(MALLS, "utf8")) as { id: string; visible?: boolean }[];
let mallsAdded = 0;
for (const mall of malls) {
  if (mall.visible === true || mall.visible === false) continue;
  mall.visible = true;
  mallsAdded += 1;
}
writeFileSync(MALLS, JSON.stringify(malls), "utf8");
console.log(`platform-malls.json: ${mallsAdded} flag(s) added, ${malls.length} total.`);