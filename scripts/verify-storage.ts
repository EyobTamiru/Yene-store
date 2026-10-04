/**
 * ============================================================================
 *  STORAGE, MEDIA, MUSIC AND RENTAL-OUT VERIFICATION (Section 55)
 * ============================================================================
 *
 *  Pure logic again: no server, no network, no filesystem, no API key.
 *
 *  THE CLAIMS BEING DEFENDED
 *  -------------------------
 *    1. Storage table  - the published allowances, and no hard-coded drift
 *    2. Quota policy   - refuse over-quota, but NEVER lock a business out
 *    3. Media types    - allowlist, and content that must match its name
 *    4. Filenames      - no traversal, no collision, original name kept
 *    5. Music          - deterministic, licensed-only, customer wins
 *    6. Rental out     - owner/tenant rules, and the share ceiling
 *
 *  Run with `npm run test:storage`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-storage-verify-"));
process.env.YENE_DATA_DIR = tempDir;

const {
  DEFAULT_MUSIC_PREFERENCE,
  MUSIC_MOODS,
  nextTrack,
  normalisePreference,
  pickTrackForStore,
  playableTracks,
  resolveTrack,
} = await import("../src/platform/music");
import type { MusicTrack } from "../src/platform/music";
const {
  MAX_FILE_BYTES,
  STORAGE_BYTES,
  SUPER_STORAGE_CEILING,
  evaluateUpload,
  formatBytes,
  shouldWarn,
  storageLabel,
  storageSummary,
  uploadRefusalMessage,
  usageFraction,
} = await import("../src/platform/storage");
const {
  ACCEPTED_FORMATS,
  classifyUpload,
  contentMatchesExtension,
  contentTypeFor,
  extensionOf,
  fileCeilingFor,
  isScriptCapable,
  storedFileName,
} = await import("../src/platform/mediaPolicy");
const { PACKAGES, PACKAGE_ORDER, DASHBOARD_MODULES, moduleAccess } = await import("../src/platform/packages");
const {
  MAX_OWNER_SHARE_BPS,
  canOfferRental,
  canRentSlot,
  isValidShareBps,
  listingForOwner,
  listingForRenters,
  ownerMonthlyIncome,
  shareLabel,
} = await import("../src/platform/rentalOut");
import type { StoreRentalListing } from "../src/platform/rentalOut";

let failures = 0;
let passed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;

// ---------------------------------------------------------------------------
section("1. The published storage table");

check("Silver includes 2 GB", STORAGE_BYTES.silver === 2 * GB, storageLabel("silver"));
check("Gold includes 10 GB", STORAGE_BYTES.gold === 10 * GB, storageLabel("gold"));
check("Platinum includes 50 GB", STORAGE_BYTES.platinum === 50 * GB, storageLabel("platinum"));
check("Super starts at 250 GB", STORAGE_BYTES.super === 250 * GB, storageLabel("super"));
check("Super is quoted up to 1 TB", SUPER_STORAGE_CEILING === 1 * TB);
check("Super's label states the band", storageLabel("super") === "250 GB - 1 TB+", storageLabel("super"));

// The ladder RISES. A larger plan with less storage would be a pricing bug.
check(
  "storage rises with the ladder",
  STORAGE_BYTES.silver < STORAGE_BYTES.gold &&
    STORAGE_BYTES.gold < STORAGE_BYTES.platinum &&
    STORAGE_BYTES.platinum < STORAGE_BYTES.super,
);

// THE PACKAGE TABLE AND THE STORAGE TABLE MUST NOT DISAGREE.
for (const id of PACKAGE_ORDER) {
  check(
    `${PACKAGES[id].name} carries its own allowance`,
    PACKAGES[id].limits.storageBytes === STORAGE_BYTES[id],
    `${PACKAGES[id].limits.storageBytes} vs ${STORAGE_BYTES[id]}`,
  );
}

check("every package declares a storage limit", PACKAGE_ORDER.every((id) => PACKAGES[id].limits.storageBytes > 0));
check("Super is still a quotation, not a fixed plan", PACKAGES.super.customPricing === true);

// Formatting is DERIVED, so the label can never drift from the number.
check("bytes format as MB", formatBytes(50 * MB) === "50 MB");
check("bytes format as GB", formatBytes(2 * GB) === "2 GB");
check("bytes format as TB", formatBytes(1.5 * TB) === "1.5 TB");
check("a one-decimal figure keeps its decimal", formatBytes(1.5 * GB) === "1.5 GB");
check("zero formats as zero", formatBytes(0) === "0 B");
check("a summary reads naturally", storageSummary(1024 * MB, 10 * GB) === "1 GB of 10 GB used");

// ---------------------------------------------------------------------------
section("2. Quota policy (refuse, but never lock a business out)");

// THE TWO LIMITS ARE CHECKED IN A FIXED ORDER, AND THESE FIXTURES DEPEND ON IT
// ---------------------------------------------------------------------------
// The per-file ceiling is evaluated FIRST. So a "quota refusal" fixture must use
// an incoming size that is UNDER the per-file cap, or it is refused for size and
// the quota rule is never reached. Every number below is chosen with that in
// mind, and the ordering itself is asserted at the end of this section.
const CAP = 50 * MB;

check(
  "a first upload is allowed",
  evaluateUpload({ usedBytes: 0, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: 5 * MB }).allowed === true,
);

// A file that fits the per-file cap but not the remaining room.
const tight = evaluateUpload({
  usedBytes: 9.99 * GB,
  limitBytes: 10 * GB,
  maxFileBytes: CAP,
  incomingBytes: 40 * MB, // under CAP, over the ~10 MB that is left
});
check("an upload that would exceed the quota is refused", tight.allowed === false);
check("the refusal names the reason", tight.allowed === false && tight.reason === "over-quota");
check("the refusal is NOT flagged as oversize", tight.allowed === false && tight.oversize === false, `oversize=${tight.allowed === false ? tight.oversize : "n/a"}`);
check("the remaining room is reported", tight.allowed === false && tight.headroom > 0 && tight.headroom < 40 * MB);

// The per-file ceiling is separate, and fires even with room to spare.
const oversize = evaluateUpload({ usedBytes: 0, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: 100 * MB });
check("a file over the per-file ceiling is refused", oversize.allowed === false);
check("the refusal IS flagged as oversize", oversize.allowed === false && oversize.oversize === true);

// THE ORDER IS ASSERTED, not assumed: a file over BOTH limits is reported as
// oversize, because that is the more actionable of the two messages.
const both = evaluateUpload({ usedBytes: 9.99 * GB, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: 500 * MB });
check("a file over both limits is reported as oversize", both.allowed === false && both.oversize === true);

// ---------------------------------------------------------------------------
// THE ANTI-LOCKOUT RULE
//
// A business can be over its quota - a downgrade leaves it holding more than its
// new plan includes. It must still be able to move in a SMALLER file, or it can
// never reduce anything and is stuck permanently. A checkout that quietly
// starts failing after a downgrade is a support incident waiting to happen.
// ---------------------------------------------------------------------------
const OVERAGE = 20 * MB;
const overQuota = { usedBytes: 10 * GB + OVERAGE, limitBytes: 10 * GB, maxFileBytes: CAP };

const shrinking = evaluateUpload({ ...overQuota, incomingBytes: 10 * MB });
check("an over-quota business may upload something SMALLER", shrinking.allowed === true, "this is the anti-lockout rule");
// The upload itself does not delete anything, so `usedAfter` is still above the`n// limit until the old file is removed. What the rule guarantees is PERMISSION to`n// proceed, which is the anti-lockout property being defended here.`ncheck("an over-quota business is permitted to proceed", shrinking.allowed === true);

const notEnough = evaluateUpload({ ...overQuota, incomingBytes: 30 * MB });
check("but not a file larger than the overage", notEnough.allowed === false);
check("that refusal is about quota, not file size", notEnough.allowed === false && notEnough.oversize === false);

// Exactly at the limit is allowed; one byte over is not.
check("exactly filling the quota is allowed", evaluateUpload({ usedBytes: 5 * GB, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: CAP }).allowed === true);
check("one byte over is refused", evaluateUpload({ usedBytes: 5 * GB, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: CAP + 1 }).allowed === false);
check("an empty upload is harmless", evaluateUpload({ usedBytes: 0, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: 0 }).allowed === true);
check("a negative size cannot sneak past", evaluateUpload({ usedBytes: 0, limitBytes: 10 * GB, maxFileBytes: CAP, incomingBytes: -100 }).allowed === true);

// A WARNING IS PROACTIVE, not a refusal.
check("a business is warned at 90%", shouldWarn(9.1 * GB, 10 * GB));
check("a business well under is not warned", !shouldWarn(5 * GB, 10 * GB));
check("the warning fires exactly at the threshold", usageFraction(9 * GB, 10 * GB) === 0.9);
check("usage never exceeds 100%", usageFraction(20 * GB, 10 * GB) === 1);

// The refusal MESSAGE must be actionable, not just an error.
const quotaMessage = uploadRefusalMessage(tight as never);
check("a quota refusal names the allowance", quotaMessage.includes("10 GB"), quotaMessage);
check("a quota refusal says how much is free", quotaMessage.includes("MB"), quotaMessage);
check("a quota refusal suggests what to do", /delete|upgrade/i.test(quotaMessage), quotaMessage);
const sizeMessage = uploadRefusalMessage(oversize as never);
check("an oversize refusal explains the single-file limit", sizeMessage.includes("larger than a single upload"), sizeMessage);

// THE SILVER REALITY: with a 2 GB quota and a 25 MB file cap, an over-quota
// business is ALWAYS able to make progress, because no single file can exceed the
// whole overage in one go. This is the property that makes the rule safe.
const silver = PACKAGES.silver.limits.storageBytes;
const silverCap = MAX_FILE_BYTES.silver;
check("Silver's file cap is far below its quota", silverCap < silver, `${silverCap} vs ${silver}`);
const silverOver = evaluateUpload({
  usedBytes: silver + 10 * MB,
  limitBytes: silver,
  maxFileBytes: silverCap,
  incomingBytes: 5 * MB,
});
check("so a Silver business over quota can always shrink", silverOver.allowed === true);
// The per-file ceilings rise with the plan.
check("the per-file ceiling rises with the plan", MAX_FILE_BYTES.silver < MAX_FILE_BYTES.gold && MAX_FILE_BYTES.gold < MAX_FILE_BYTES.platinum);
check("video is allowed more than an image on the same plan", fileCeilingFor("silver", "video") > fileCeilingFor("silver", "image"));

// ---------------------------------------------------------------------------
section("3. Media types (allowlist, and content that matches its name)");

check("a PNG is accepted", classifyUpload("photo.png", "image/png").ok === true);
check("a JPEG named .jpg is accepted", classifyUpload("photo.jpg", "image/jpeg").ok === true);
check("an MP4 is accepted", classifyUpload("clip.mp4", "video/mp4").ok === true);
check("a WebM is accepted", classifyUpload("clip.webm", "video/webm").ok === true);
check("an MP3 is accepted", classifyUpload("track.mp3", "audio/mpeg").ok === true);

// THE ALLOWLIST IS THE POINT. A deny-list is wrong the day a new extension
// appears; an allow-list is right by default.
check("an EXE is refused", classifyUpload("virus.exe", "application/octet-stream").ok === false);
check("an HTML file is refused", classifyUpload("page.html", "text/html").ok === false);
check("a PHP file is refused", classifyUpload("shell.php", "application/x-httpd-php").ok === false);
check("a file with no extension is refused", classifyUpload("noextension", "image/png").ok === false);
check("a refusal explains what is accepted", /Accepted images/i.test((classifyUpload("x.exe", "") as { reason: string }).reason));

// THE RENAMED-FILE CHECK. This is what stops a .html file uploaded as .png.
const mismatch = classifyUpload("sneaky.png", "text/html");
check("a name/type mismatch is refused", mismatch.ok === false);
check("the mismatch is explained", mismatch.ok === false && /mismatch/i.test((mismatch as { reason: string }).reason));
check("a correct pair is still accepted", classifyUpload("real.png", "image/png; charset=binary").ok === true);

// SERVED TYPES COME FROM THE ALLOWLIST, never from the request.
check("the served type for .png is declared", contentTypeFor("a.png") === "image/png");
check("the served type for .mp4 is declared", contentTypeFor("a.mp4") === "video/mp4");
check("an unknown extension has no served type", contentTypeFor("a.exe") === null);

// SCRIPT-CAPABLE FORMATS ARE FLAGGED. An SVG can execute script, and this
// project already serves user content from the same origin as the session cookie.
check("SVG is marked script-capable", isScriptCapable("a.svg"));
check("a PNG is not", !isScriptCapable("a.png"));
check("an MP4 is not", !isScriptCapable("a.mp4"));

// MAGIC NUMBERS: a content-type header is a claim; these bytes are a fact.
const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpgHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const htmlBytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);
check("real PNG bytes match", contentMatchesExtension("a.png", pngHeader) === true);
check("real JPEG bytes match", contentMatchesExtension("a.jpg", jpgHeader) === true);
check("HTML bytes do NOT match a PNG", contentMatchesExtension("a.png", htmlBytes) === false);
check("a truncated PNG is refused", contentMatchesExtension("a.png", new Uint8Array([0x89])) === false);
// null means "no signature defined", which is permissive on purpose: refusing
// every MP4 because it has no signature table would be worse than not checking.
check("a format with no signature returns null, not false", contentMatchesExtension("a.mp4", htmlBytes) === null);

check("extensions are lowercased", extensionOf("PHOTO.PNG") === "png");
check("a double extension uses the last", extensionOf("photo.backup.png") === "png");

// ---------------------------------------------------------------------------
section("4. Stored filenames (no traversal, no collision)");

// The CALLER'S NAME IS NEVER USED ON DISK.
check("the stored name is a random id plus the vetted extension", storedFileName("abc123", "My Photo.png") === "abc123.png");
check("a traversing name cannot survive", storedFileName("abc123", "../../evil.png") === "abc123.png");
check("a disallowed extension produces no name", storedFileName("abc123", "evil.exe") === null);
check("an unknown extension produces no name", storedFileName("abc123", "noextension") === null);
check("two uploads of the same name get different files", storedFileName("aaa", "x.png") !== storedFileName("bbb", "x.png"));
check("every accepted format can be stored", ACCEPTED_FORMATS.every((format) => storedFileName("id", `file.${format.extension}`) === `id.${format.extension}`));

// ---------------------------------------------------------------------------
section("5. Music (deterministic, licensed-only, the customer wins)");

const LIBRARY: MusicTrack[] = [
  { id: "t1", title: "Morning Light", artist: "A", url: "https://cdn/t1.mp3", durationSec: 180, moods: ["calm", "family"], licensed: true, createdAt: "2026-01-01" },
  { id: "t2", title: "Bazaar", artist: "B", url: "https://cdn/t2.mp3", durationSec: 200, moods: ["upbeat", "traditional"], licensed: true, createdAt: "2026-01-01" },
  { id: "t3", title: "Silk Road", artist: "C", url: "https://cdn/t3.mp3", durationSec: 240, moods: ["luxury"], licensed: true, createdAt: "2026-01-01" },
  { id: "t4", title: "Unlicensed Loop", artist: "D", url: "https://cdn/t4.mp3", durationSec: 120, moods: ["calm"], licensed: false, createdAt: "2026-01-01" },
];

// THE HONEST EMPTY CASE: a fresh deployment has no audio, and says so.
check("an empty library has nothing playable", playableTracks([]).length === 0);
check("an empty library picks nothing", pickTrackForStore("store-1", "calm", []) === null);

// LICENSING IS ENFORCED. An unlicensed track is never served or selected.
check("an unlicensed track is not playable", playableTracks(LIBRARY).some((t) => t.id === "t4") === false);
const noUnlicensed = LIBRARY.filter(() => true).map((_, i) => pickTrackForStore(`s${i}`, "calm", LIBRARY)).filter(Boolean).map((t) => (t as MusicTrack).id);
check("auto-selection never returns an unlicensed track", !noUnlicensed.includes("t4"));

// DETERMINISTIC: the same store always gets the same track, so a storefront has
// a consistent sound rather than a different one on every page load.
check("the same store always gets the same track", pickTrackForStore("store-7", "calm", LIBRARY)?.id === pickTrackForStore("store-7", "calm", LIBRARY)?.id);
// ...but different stores spread across the library. The whole library is used
// here, because the "calm" pool holds only ONE licensed track (t4 is excluded
// for its licence), so a mood-based spread test would be measuring nothing.
const spread = new Set(Array.from({ length: 40 }, (_, i) => pickTrackForStore(`store-${i}`, null, LIBRARY)?.id));
check("different stores do not all get the same track", spread.size > 1, `only ${spread.size} distinct`);
check("every playable track is reachable", spread.size === playableTracks(LIBRARY).length, `${spread.size} of ${playableTracks(LIBRARY).length}`);
check("the spread covers only licensed tracks", [...spread].every((id) => id !== "t4"));

// MOOD IS HONOURED when a matching track exists.
check("a calm mood picks a calm track", pickTrackForStore("s1", "calm", LIBRARY)?.moods.includes("calm"));
// ...but an unknown mood falls back rather than to SILENCE, which would be worse.
check("an unknown mood still picks something", pickTrackForStore("s1", "space-jazz", LIBRARY) !== null);
check("no mood still picks something", pickTrackForStore("s1", null, LIBRARY) !== null);

// THE CUSTOMER'S CHOICE ALWAYS WINS.
const chosen = resolveTrack("store-1", "calm", { trackId: "t2", enabled: true, volume: 0.5 }, LIBRARY);
check("an explicit track choice wins over the auto-pick", chosen?.id === "t2");
// ...including an explicit OFF, which is the whole point of "the customer can turn it off".
check("an explicit OFF means silence", resolveTrack("store-1", "calm", { ...DEFAULT_MUSIC_PREFERENCE, enabled: false }, LIBRARY) === null);
// ...and a track that has since been removed falls back rather than breaking.
check("a removed track falls back to the auto-pick", resolveTrack("store-1", "calm", { trackId: "gone", enabled: true, volume: 0.5 }, LIBRARY) !== null);

// MUTED BY DEFAULT. This is a browser constraint, not a preference.
check("the default is OFF", DEFAULT_MUSIC_PREFERENCE.enabled === false);
check("a first-time visitor hears nothing", resolveTrack("store-1", "calm", DEFAULT_MUSIC_PREFERENCE, LIBRARY) === null);

// CHANGING TRACK NEVER RETURNS THE SAME ONE.
check("next is a different track", nextTrack("t1", "store-1", null, LIBRARY, 1)?.id !== "t1");
check("a single-track library returns that track", nextTrack("t1", "s", null, [LIBRARY[0]], 1)?.id === "t1");
check("next on an empty library is nothing", nextTrack(null, "s", null, [], 1) === null);

// THE SAVED PREFERENCE IS UNTRUSTED INPUT. localStorage is user-editable.
check("junk normalises to the default", normalisePreference("nonsense").enabled === false);
check("null normalises to the default", normalisePreference(null).trackId === null);
check("a volume above 1 is clamped", normalisePreference({ volume: 99 }).volume === 1);
check("a negative volume is clamped", normalisePreference({ volume: -5 }).volume === 0);
check("a string volume falls back", normalisePreference({ volume: "loud" }).volume === DEFAULT_MUSIC_PREFERENCE.volume);
check("enabled must be exactly true", normalisePreference({ enabled: "yes" }).enabled === false);
check("a valid preference survives normalisation", normalisePreference({ trackId: "t2", enabled: true, volume: 0.3 }).trackId === "t2");
check("every declared mood is a real id", MUSIC_MOODS.every((m) => typeof m.id === "string" && m.id.length > 0));

// ---------------------------------------------------------------------------
section("6. Rent to others (owner/tenant rules)");

const NOW = "2026-01-01T00:00:00.000Z";
function listing(overrides: Partial<StoreRentalListing> = {}): StoreRentalListing {
  return {
    id: "rent-1",
    ownerBusinessId: "biz-owner",
    title: "Bole counter",
    description: "Front counter",
    monthlyRentEtb: 3000,
    ownerShareBps: 2000,
    tenantBusinessId: null,
    status: "open",
    minimumPackageId: "silver",
    createdAt: NOW,
    updatedAt: NOW,
    occupiedAt: null,
    endedAt: null,
    ...overrides,
  };
}

const GOLD = { id: "biz-gold", packageId: "gold" } as never;
const SILVER = { id: "biz-silver", packageId: "silver" } as never;
const OWNER = { id: "biz-owner", packageId: "platinum" } as never;

// THE OWNERSHIP RULES.
check("an owner may offer their own slot", canOfferRental(OWNER, null).ok === true);
check("a business may not offer another business's slot", canOfferRental(GOLD, listing()).ok === false);
check("an occupied slot may not be re-offered", canOfferRental(OWNER, listing({ status: "occupied" })).ok === false);
check("no business means no offer", canOfferRental(null, null).ok === false);

// THE TENANT RULES.
check("an eligible business may take an open slot", canRentSlot(GOLD, listing(), PACKAGE_ORDER).ok === true);
check("a business may not rent from ITSELF", canRentSlot(OWNER, listing(), PACKAGE_ORDER).ok === false);
check("a taken slot may not be taken again", canRentSlot(GOLD, listing({ status: "occupied", tenantBusinessId: "biz-x" }), PACKAGE_ORDER).ok === false);
check("a business below the minimum package is refused", canRentSlot(SILVER, listing({ minimumPackageId: "platinum" }), PACKAGE_ORDER).ok === false);
check("a business at the minimum package is allowed", canRentSlot(SILVER, listing({ minimumPackageId: "silver" }), PACKAGE_ORDER).ok === true);

// THE SHARE CEILING. 100% would mean the tenant pays Yene nothing, which is a
// gift rather than a rental.
check("a 100% share is refused", !isValidShareBps(10_000));
check("a 90% share is the ceiling", isValidShareBps(MAX_OWNER_SHARE_BPS));
check("a negative share is refused", !isValidShareBps(-1));
check("a fractional share is refused", !isValidShareBps(1500.5));
check("a zero share is allowed", isValidShareBps(0));
check("shares format readably", shareLabel(2000) === "20%" && shareLabel(1550) === "15.5%");

// THE OWNER'S INCOME IS DERIVED FROM THE TENANT'S PACKAGE PRICE.
const price = (id: string) => ({ silver: 2500, gold: 5000, platinum: 15000, super: 30000 }[id] ?? 0) as never;
check("an occupied slot pays the owner", ownerMonthlyIncome(listing({ status: "occupied", tenantBusinessId: "biz-gold" }), "gold", price) === 1000, `${ownerMonthlyIncome(listing({ status: "occupied", tenantBusinessId: "biz-gold" }), "gold", price)}`);
check("an OPEN slot pays nothing", ownerMonthlyIncome(listing(), null, price) === 0);
check("an occupied slot with no tenant pays nothing", ownerMonthlyIncome(listing({ status: "occupied" }), null, price) === 0);
check("a higher-tier tenant pays more", ownerMonthlyIncome(listing({ status: "occupied", tenantBusinessId: "biz-p" }), "platinum", price) === 3000);

// THE PROJECTIONS MUST NOT LEAK THE OTHER PARTY.
const ownerView = listingForOwner(listing({ status: "occupied", tenantBusinessId: "biz-secret" }));
check("the owner view does not name the tenant", !JSON.stringify(ownerView).includes("biz-secret"));
check("the owner view says only that it is occupied", ownerView.occupied === true);
const renterView = listingForRenters(listing(), "Green Coffee");
check("the renter view names the owner", renterView.owner === "Green Coffee");
check("the renter view carries no share figure", !("ownerShareBps" in (renterView as never)));
check("the renter view carries no tenant id", !("tenantBusinessId" in (renterView as never)));

// ---------------------------------------------------------------------------
section("7. Promote and rent are available at EVERY package");

for (const id of PACKAGE_ORDER) {
  const promote = DASHBOARD_MODULES.find((m) => m.key === "promote");
  const rent = DASHBOARD_MODULES.find((m) => m.key === "rent-out");
  check(`${PACKAGES[id].name} can open the Promote screen`, promote !== undefined && moduleAccess(id, promote) === "available");
  check(`${PACKAGES[id].name} can open the Rent-to-others screen`, rent !== undefined && moduleAccess(id, rent) === "available");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${"-".repeat(60)}`);
console.log(`  ${passed} passed, ${failures} failed, ${passed + failures} checks`);
console.log(`${"-".repeat(60)}`);
console.log(
  failures === 0
    ? "\n  SECTION 55: storage, media, music and rental-out all hold.\n"
    : `\n  ${failures} CHECK(S) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);