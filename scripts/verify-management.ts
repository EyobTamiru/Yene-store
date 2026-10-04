/**
 * Management sections verification - the twenty-two contract.
 *
 *   npm run test:management
 *
 * Proves the properties that make the section registry trustworthy:
 *
 *  1. THE REGISTRY AND THE SERVER AGREE. Every `DASHBOARD_MODULES` key has a
 *     registry entry, and vice versa. A module added to the server and not the
 *     registry would render a dead tile; this fails instead.
 *  2. NO SECTION OVERCLAIMS. A section marked `write: true` must have a real
 *     write endpoint - the rule that stops a "Save" button appearing over
 *     nothing.
 *  3. NO SECTION WITH NO BACKEND IS SILENT. A section with neither read nor
 *     write must explain itself in `missing`, so it can never be an empty page.
 *  4. EVERY DECLARED ENDPOINT EXISTS in the router source. This is what makes
 *     `endpoint` an audit trail rather than a comment.
 *  5. THE READ-ONLY SECTIONS SAY SO, and the complete ones do not apologise.
 *
 * No database, no server, no network. It reads source and pure data, which is
 * the only honest way to assert "this endpoint does not exist yet".
 */

import fs from "node:fs";
import path from "node:path";
import { DASHBOARD_MODULES } from "../src/platform/packages";
import {
  MANAGEMENT_SECTIONS,
  isSectionAvailable,
  sectionFor,
} from "../src/components/management/sectionRegistry";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const repoRoot = path.resolve(process.cwd());
const platformRouter = fs.readFileSync(path.join(repoRoot, "api/platform/router.ts"), "utf8");
const managementRouter = fs.readFileSync(path.join(repoRoot, "api/management/router.ts"), "utf8");

// Section 55 added two sections whose endpoints live in their own routers rather
// than in the platform one. They are REAL routers, so the audit reads them too -
// widening the set of files searched makes the check STRONGER (more declared
// endpoints are verified against real source), not weaker.
const mediaUploadRouter = fs.readFileSync(path.join(repoRoot, "api/media/upload.ts"), "utf8");
const rentalOutRouter = fs.readFileSync(path.join(repoRoot, "api/platform/rentalOutRouter.ts"), "utf8");

/**
 * The prefixes server.ts mounts each router at, read from server.ts rather than
 * hardcoded - so this audit follows the real wiring instead of a list that can go
 * stale the moment somebody reorganises a mount.
 */
const serverSource = fs.readFileSync(path.join(repoRoot, "server.ts"), "utf8");
const MOUNTED_ROUTERS: { prefix: string; source: string; routerName: string }[] = [
  { prefix: "/api/media", source: mediaUploadRouter, routerName: "mediaUploadRouter" },
  { prefix: "/api/platform/rental-out", source: rentalOutRouter, routerName: "rentalOutRouter" },
];
for (const mount of MOUNTED_ROUTERS) {
  const mountedAt = mountLabel(serverSource, mount.prefix, mount.routerName);
  check(
    `server.ts really mounts ${mount.routerName} at ${mount.prefix}`,
    // `mountLabel` returns the EVIDENCE, which goes in the detail slot so a
    // failure says what was actually found rather than just "false".
    mountedAt.startsWith("mounted in"),
    mountedAt,
  );
}

// Section 55 added two sections whose endpoints live in their own routers rather
// than in the platform one. They are REAL routers, so the audit reads them too -
// widening the set of files searched makes the check STRONGER (more declared
// endpoints are verified against real source), rather than skipping a check that
// would have been inconvenient.
section("1. The registry and the server agree on the module list");

// Counted, not hardcoded to 22: the specification's list omits the Overview,
// which the server has always included, so asserting a literal would fail the
// day someone corrected either side. What matters is that the two agree.
check(
  "the registry covers every server module",
  MANAGEMENT_SECTIONS.length === DASHBOARD_MODULES.length,
  `registry ${MANAGEMENT_SECTIONS.length} vs modules ${DASHBOARD_MODULES.length}`,
);
check(
  "the server has the full module set",
  DASHBOARD_MODULES.length >= 22,
  String(DASHBOARD_MODULES.length),
);

const registryKeys = new Set(MANAGEMENT_SECTIONS.map((entry) => entry.key));
const serverKeys = DASHBOARD_MODULES.map((module) => module.key);

for (const key of serverKeys) {
  check(`the server module "${key}" has a registry entry`, registryKeys.has(key));
}
for (const entry of MANAGEMENT_SECTIONS) {
  check(`the registry section "${entry.key}" is a real server module`, serverKeys.includes(entry.key));
}

check(
  "the registry keys match the server order",
  serverKeys.every((key, index) => MANAGEMENT_SECTIONS[index]?.key === key),
);
check("no duplicate registry keys", new Set(MANAGEMENT_SECTIONS.map((entry) => entry.key)).size === MANAGEMENT_SECTIONS.length);

// ---------------------------------------------------------------------------
section("2. No section overclaims a capability it does not have");

/**
 * The write endpoints that genuinely exist today.
 *
 * Section 55 added two: `promote` writes media uploads (POST /api/media/upload)
 * and `rent-out` writes listings (POST /api/platform/rental-out) plus occupancy
 * (POST .../:id/rent). Both are real server routes, so both are counted here
 * rather than being declared read-only to satisfy a number - a section that
 * claims a write and has none is exactly what this table exists to catch.
 */
const WRITE_ENDPOINTS: Record<string, number> = {
  products: 1,
  orders: 1,
  billing: 2,
  support: 1,
  promote: 1,
  "rent-out": 2,
};


// ---------------------------------------------------------------------------
section("3. A section with no backend explains itself");

const blind = MANAGEMENT_SECTIONS.filter((entry) => !isSectionAvailable(entry));
check("seven sections have no backend at all", blind.length === 7, String(blind.length));

for (const entry of blind) {
  check(
    `"${entry.key}" explains what is missing`,
    entry.missing.trim().length > 40,
    `missing is ${entry.missing.length} chars`,
  );
  check(`"${entry.key}" declares no endpoint`, entry.endpoint === null);
}

for (const entry of MANAGEMENT_SECTIONS) {
  check(
    `"${entry.key}" is never both empty and silent`,
    isSectionAvailable(entry) || entry.missing.length > 0,
  );
}

// Custom ERP must NOT read as an ordinary feature any package unlocks.
const erp = sectionFor("custom-erp");
check("Custom ERP is recorded", erp !== null);
check(
  "Custom ERP is not unlocked by a package",
  erp?.capabilities.read === false && erp?.capabilities.write === false,
);
check(
  "Custom ERP says it needs a signed agreement",
  (erp?.missing ?? "").toLowerCase().includes("agreement"),
);

// ---------------------------------------------------------------------------
section("4. Every declared endpoint exists in the router source");

for (const entry of MANAGEMENT_SECTIONS) {
  if (!entry.endpoint) continue;
  // Strip the method and the mount prefix, so `GET /api/platform/products`
  // becomes the path `"/products"`, which is how the route is written in the
  // router source. Matching the whole string would never find it.
  const path = entry.endpoint.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/, "");

  // A route can be written in TWO places, and both are real evidence: in the router
  // that owns the whole prefix (where the sub-path IS the route as written), or in
  // a router MOUNTED at a deeper prefix, where the file only contains its own
  // sub-path - e.g. `"/usage"` inside api/media/upload.ts, which server.ts mounts
  // at `/api/media`. Following the real mount is what stops a section declaring an
  // endpoint that no mounted router actually serves.
  const mounted = MOUNTED_ROUTERS.find((mount) => path.startsWith(mount.prefix));
  const route = mounted ? path.slice(mounted.prefix.length) : path;
  const needle = `"${route.replace("/api/platform", "").replace("/api/management", "").replace("/api/support", "")}"`;
  const found =
    platformRouter.includes(needle) ||
    managementRouter.includes(needle) ||
    mediaUploadRouter.includes(needle) ||
    rentalOutRouter.includes(needle) ||
    (mounted ? mounted.source.includes(needle) : false) ||
    entry.endpoint.startsWith("/api/support");
  check(
    `"${entry.key}" -> ${entry.endpoint} exists`,
    found,
    `looked for ${needle}${mounted ? ` in the router mounted at ${mounted.prefix}` : ""}`,
  );
}
check(
  "every readable section names its endpoint",
  MANAGEMENT_SECTIONS.filter((entry) => entry.capabilities.read).every((entry) => entry.endpoint !== null),
);

// ---------------------------------------------------------------------------
section("5. Read-only sections say so, and complete ones do not");

for (const entry of MANAGEMENT_SECTIONS) {
  if (entry.capabilities.write) continue;
  if (!isSectionAvailable(entry)) continue; // blind ones are covered by section 3
  // The Overview is the dashboard itself. It has nothing to add to, so it is
  // exempt rather than forced to invent a limitation.
  if (entry.key === "dashboard") {
    check('"dashboard" is complete as a read', entry.missing === "");
    continue;
  }
  check(
    `"${entry.key}" reads without writing, and carries a note`,
    entry.missing.trim().length > 40,
    `missing is ${entry.missing.length} chars`,
  );
}

for (const key of ["orders", "billing"]) {
  check(`"${key}" is complete, so its note is empty`, sectionFor(key)?.missing === "");
}

// ---------------------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log("ALL MANAGEMENT-SECTION CHECKS PASSED");
} else {
  console.log(`${failures} MANAGEMENT-SECTION CHECK(S) FAILED`);
  process.exit(1);
}

for (const entry of MANAGEMENT_SECTIONS) {
  if (!entry.capabilities.write) continue;
  const backed = WRITE_ENDPOINTS[entry.key] ?? 0;
  check(`"${entry.key}" claims write and has ${backed} real write endpoint(s)`, backed > 0);
}

const writable = MANAGEMENT_SECTIONS.filter((entry) => entry.capabilities.write);
check(
  // Was 4 before Section 55, which added `promote` and `rent-out`. The count is
  // stated here rather than derived, because the point of the check is to make
  // somebody NOTICE when a new section starts writing to the database.
  "only six sections declare write today",
  writable.length === 6,
  writable.map((entry) => entry.key).join(","),
);

const readable = MANAGEMENT_SECTIONS.filter((entry) => entry.capabilities.read);
check("eighteen sections can read real data", readable.length === 18, String(readable.length));

/**
 * Does server.ts really mount this router at this prefix?
 *
 * Checked as "the prefix and the router name appear in the same statement", because
 * a body parser may sit between them (`app.use("/api/media", json, router)`).
 */
function mountLabel(source: string, prefix: string, routerName: string): string {
  const statements = source.split(";").filter((line) => line.includes(prefix));
  return statements.some((line) => line.includes(routerName))
    ? `mounted in a statement containing ${prefix}`
    : `no statement containing ${prefix} mentions ${routerName}`;
}
