/**
 * ============================================================================
 *  STORE RENTAL VERIFICATION (Sections 10 & 41)
 * ============================================================================
 *
 *  Needs no API key, no server and no network: everything under test is pure, in
 *  src/platform/rental.ts. That is the point of keeping the matching in its own
 *  module - the rules that decide who gets a shop can be checked on every commit.
 *
 *  The tests are grouped by the claim they defend:
 *
 *    1. Phone numbers   - one Ethiopian handset has many writings
 *    2. Names           - matched without destroying Ge'ez
 *    3. Matching        - ranked by strength of evidence
 *    4. Approval        - a name alone can never decide (the safety property)
 *    5. Mall units      - a counter belongs to one person at a time
 *
 *  Run with `npm run test:rental`.
 */

import {
  availableUnits,
  buildMallUnits,
  describeMatchField,
  describeUnit,
  ethiopianCarrier,
  findUnitConflicts,
  isFloorOf,
  isValidEthiopianPhone,
  maskDocumentId,
  maskEthiopianPhone,
  matchApplicants,
  nameSimilarity,
  nameTokens,
  normalizeEthiopianPhone,
  normalizePersonName,
  resolveApplicantForApproval,
  tierIsDecisive,
  unitId,
  unitsForMall,
  type MatchableApplicant,
} from "../src/platform/rental";
import type { Mall, MallUnit } from "../src/platform/types";

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

// ---------------------------------------------------------------------------
section("1. Ethiopian phone numbers (one handset, many writings)");

check("a local mobile number normalises", normalizeEthiopianPhone("0911234567") === "911234567");
check("it is the same number written +251", normalizeEthiopianPhone("+251911234567") === "911234567");
check("and with no plus", normalizeEthiopianPhone("251911234567") === "911234567");
check("and with spaces", normalizeEthiopianPhone("+251 911 234 567") === "911234567");
check("and with dashes", normalizeEthiopianPhone("0911-234-567") === "911234567");
check("and with parentheses", normalizeEthiopianPhone("(0911) 234567") === "911234567");

// The near-duplicates that would otherwise be two applicants.
check(
  "a shared prefix is not a match on its own",
  normalizeEthiopianPhone("0911") === null,
  "a partial number must never resolve"
);
check("a two-digit fragment is refused", normalizeEthiopianPhone("09") === null);
check("an empty string is refused", normalizeEthiopianPhone("") === null);
check("null is refused, not thrown", normalizeEthiopianPhone(null) === null);
check("undefined is refused, not thrown", normalizeEthiopianPhone(undefined) === null);

check("an Addis Ababa landline is accepted", normalizeEthiopianPhone("0112345678") === "112345678");
check("a Jimma landline is accepted", normalizeEthiopianPhone("+251686234567") === "686234567");

// An unallocated prefix must be refused rather than accepted as a handset.
check("an unallocated 8 prefix is refused", normalizeEthiopianPhone("0812345678") === null);

check("Safaricom is identified", ethiopianCarrier("0911234567") === "Safaricom");
check("Ethio Telecom is identified", ethiopianCarrier("0921234567") === "Ethio Telecom");
check("Airtel is identified", ethiopianCarrier("0971234567") === "Airtel");
check("a landline has no carrier", ethiopianCarrier("0112345678") === null);

check("isValidEthiopianPhone agrees with the normaliser", isValidEthiopianPhone("0911 234 567"));
check("and rejects a fragment", !isValidEthiopianPhone("0911"));

check("masking still shows the last digits", maskEthiopianPhone("0911234567").endsWith("4567"));
check("masking never returns the whole number", maskEthiopianPhone("0911234567") !== "911234567");
check("masking an absent number is empty", maskEthiopianPhone(null) === "");
check("a document shows only its last two", maskDocumentId("AB1234567890") === "••90");
check("a short document is still masked", maskDocumentId("AB12") === "••12");
check("an absent document is empty", maskDocumentId(null) === "");

// ---------------------------------------------------------------------------
section("2. Names (matched without destroying Ge'ez)");

check("case is folded", normalizePersonName("ABEBE BEKELE") === "abebe bekele");
check("separators collapse", normalizePersonName("Abebe,  Bekele") === "abebe bekele");
check("punctuation is dropped", normalizePersonName("Abebe-Bekele") === "abebe bekele");
check("extra whitespace collapses", normalizePersonName("  Abebe   Bekele  ") === "abebe bekele");
check("an empty name is empty", normalizePersonName("") === "");
check("a null name is empty", normalizePersonName(null) === "");

// THE REGRESSION THIS FORESTALLS: \W would delete every Ge'ez syllable.
check(
  "a Ge'ez name survives normalisation",
  normalizePersonName("አበበ በቀለ") === "አበበ በቀለ",
  normalizePersonName("አበበ በቀለ")
);
check("a Ge'ez name still has its tokens", nameTokens("አበበ በቀለ").length === 2);
check(
  "two spellings of one Ge'ez name match",
  nameSimilarity("አበበ በቀለ", "አበበ  በቀለ") === 100
);

check("an exact name is 100%", nameSimilarity("Abebe Bekele", "abebe bekele") === 100);
check(
  "family-name-first order is the same person",
  nameSimilarity("Bekele Abebe", "Abebe Bekele") === 100,
  String(nameSimilarity("Bekele Abebe", "Abebe Bekele"))
);
// One shared part out of two DISTINCT two-part names. Deliberately below 50:
// `min(dice, jaccard)` means a name that shares only a common given name cannot
// score as high as one that shares most of itself, which is what keeps a short
// "Abebe" from looking like a confident match.
check(
  "one shared part of two is a partial, not a match",
  nameSimilarity("Abebe Bekele", "Abebe Girma") > 0 &&
    nameSimilarity("Abebe Bekele", "Abebe Girma") < 50,
  String(nameSimilarity("Abebe Bekele", "Abebe Girma"))
);
check(
  "a full match still outranks a partial one",
  nameSimilarity("Abebe Bekele", "Abebe Girma") < nameSimilarity("Abebe Bekele", "Abebe")
);
check("an unrelated name scores nothing", nameSimilarity("Abebe", "Zewdu") === 0);
check("an empty name never matches", nameSimilarity("", "Abebe") === 0);
check("a null name never matches", nameSimilarity(null, "Abebe") === 0);

// ---------------------------------------------------------------------------
section("3. Matching an applicant by name or phone");

/** A realistic queue: two people called Abebe, several phone formats. */
const QUEUE: Array<MatchableApplicant & { businessName: string }> = [
  { id: "RA-1", fullName: "Abebe Bekele",  phone: "0911234567", businessName: "Bekele Electronics" },
  { id: "RA-2", fullName: "Abebe Girma",   phone: "+251 922 345 678", businessName: "Girma Cafe" },
  { id: "RA-3", fullName: "Zewdu Alemu",   phone: "0945556667", businessName: "Alemu Trading" },
  { id: "RA-4", fullName: "አበበ በቀለ",    phone: "0977778888", businessName: "Yene Electronics" },
  { id: "RA-5", fullName: "Meron Tesfaye", phone: "0911000000", businessName: "Tesfaye Fashion" },
];

check("a phone number finds its applicant", matchApplicants(QUEUE, "0911234567")[0]?.record.id === "RA-1");
check("the same phone in +251 form finds them too", matchApplicants(QUEUE, "+251911234567")[0]?.record.id === "RA-1");
check("and with spaces", matchApplicants(QUEUE, "0911 234 567")[0]?.record.id === "RA-1");
check(
  "a phone written with dashes finds them",
  matchApplicants(QUEUE, "+251-911-234-567")[0]?.record.id === "RA-1"
);
check(
  "a stored +251 number is found by its local form",
  matchApplicants(QUEUE, "0922345678")[0]?.record.id === "RA-2",
  String(matchApplicants(QUEUE, "0922345678")[0]?.record.id)
);

const byPhone = matchApplicants(QUEUE, "0911234567");
check("a phone match reports the phone tier", byPhone[0]?.tier === "phone");
check("a phone match is fully confident", byPhone[0]?.confidence === 100);
check("a phone match explains itself", /Phone/.test(byPhone[0]?.reason ?? ""));

// A phone must NEVER produce more than one result, whatever the name.
check(
  "a phone never returns two people",
  matchApplicants(QUEUE, "0911234567").length === 1,
  String(matchApplicants(QUEUE, "0911234567").length)
);

const byName = matchApplicants(QUEUE, "Zewdu Alemu");
check("a full name finds its applicant", byName[0]?.record.id === "RA-3");
check("a full name reports the name tier", byName[0]?.tier === "name");
check("an exact name is 100% confident", byName[0]?.confidence === 100);

const manyAbebe = matchApplicants(QUEUE, "Abebe");
check("a shared given name returns several people", manyAbebe.length >= 2);
check(
  "a shared given name returns no confident answer",
  manyAbebe.every((entry) => entry.tier === "name"),
  manyAbebe.map((e) => e.tier).join(",")
);

check("an unknown name matches nobody", matchApplicants(QUEUE, "Qwerty Zzz").length === 0);
check("an empty query matches nobody", matchApplicants(QUEUE, "").length === 0);
check("a whitespace query matches nobody", matchApplicants(QUEUE, "   ").length === 0);
check("a nonsense number matches nobody", matchApplicants(QUEUE, "12").length === 0);
check("an empty queue matches nobody", matchApplicants([], "Abebe").length === 0);
check(
  "a shop name is searchable too",
  matchApplicants(QUEUE, "Alemu Trading")[0]?.record.id === "RA-3"
);

// Strongest evidence wins when one query could be read several ways.
const MIXED: Array<MatchableApplicant & { businessName: string }> = [
  { id: "weak", fullName: "0911234567", phone: "0900000000", businessName: "Named Like A Phone" },
  { id: "strong", fullName: "Someone Else", phone: "0911234567", businessName: "Real Shop" },
];
const ranked = matchApplicants(MIXED, "0911234567");
check("the phone match outranks the name match", ranked[0]?.record.id === "strong");
check("both are still returned", ranked.length === 2);
check("the strong one is the phone tier", ranked[0]?.tier === "phone");

check("only an exact tier is decisive", tierIsDecisive("phone") && tierIsDecisive("tin") && tierIsDecisive("fayda"));
check("a name is never decisive", !tierIsDecisive("name"));
check("nothing matched is not decisive", !tierIsDecisive("none"));

check("a phone query is reported as a phone", describeMatchField("0911234567", "phone") === "phone");
check("a name query is reported as a name", describeMatchField("Abebe", "name") === "name");
check("a Fayda tier is reported as Fayda", describeMatchField("AB1234567890", "fayda") === "fayda");
check("a TIN tier is reported as a TIN", describeMatchField("0012345678", "tin") === "tin");

// ---------------------------------------------------------------------------
section("4. Approval - a name alone can never decide");

// THE SAFETY PROPERTY. Each of these must REFUSE to resolve.
const ambiguous = resolveApplicantForApproval(QUEUE, "Abebe");
check("a shared given name is refused", ambiguous.match === null);
check("and is reported as ambiguous", ambiguous.ambiguous);
check("but still offers a shortlist", ambiguous.candidates.length >= 2);
check("and explains why", /matches/.test(ambiguous.reason ?? ""));

const unknown = resolveApplicantForApproval(QUEUE, "Qwerty Zzz");
check("an unknown name is refused", unknown.match === null);
check("with nothing to choose from", unknown.candidates.length === 0);
check("and says so", /No applicant/.test(unknown.reason ?? ""));

const empty = resolveApplicantForApproval(QUEUE, "");
check("an empty query is refused", empty.match === null);
check("with an explanation", (empty.reason ?? "").length > 0);

// An exact phone DOES resolve - that is the feature.
const byPhoneApproval = resolveApplicantForApproval(QUEUE, "0911234567");
check("an exact phone resolves to one person", byPhoneApproval.match?.record.id === "RA-1");
check("and is not ambiguous", !byPhoneApproval.ambiguous);
check("with no refusal reason", byPhoneApproval.reason === null);
check(
  "the same person is reached by any writing of their number",
  resolveApplicantForApproval(QUEUE, "+251 911 234 567").match?.record.id === "RA-1"
);

// A unique full name resolves too, because there is nothing to confuse it with.
const uniqueName = resolveApplicantForApproval(QUEUE, "Zewdu Alemu");
check("a unique full name resolves", uniqueName.match?.record.id === "RA-3");
check("without ambiguity", !uniqueName.ambiguous);

// A Ge'ez name resolves against the Ge'ez record, not the Latin one.
check(
  "a Ge'ez name resolves to the Ge'ez applicant",
  resolveApplicantForApproval(QUEUE, "አበበ በቀለ").match?.record.id === "RA-4",
  String(resolveApplicantForApproval(QUEUE, "አበበ በቀለ").match?.record.id)
);

// Two people with the SAME name and DIFFERENT phones: the name is ambiguous, the
// phones are not. This is the case that would hand a shop to the wrong person.
const TWINS: Array<MatchableApplicant & { businessName: string }> = [
  { id: "first",  fullName: "Abebe Bekele", phone: "0911000001", businessName: "Shop One" },
  { id: "second", fullName: "Abebe Bekele", phone: "0911000002", businessName: "Shop Two" },
];
check("identical names are ambiguous", resolveApplicantForApproval(TWINS, "Abebe Bekele").ambiguous);
check("their names resolve to nobody", resolveApplicantForApproval(TWINS, "Abebe Bekele").match === null);
check(
  "but each phone resolves to its own person",
  resolveApplicantForApproval(TWINS, "0911000001").match?.record.id === "first" &&
    resolveApplicantForApproval(TWINS, "0911000002").match?.record.id === "second"
);
check("and the shortlist holds both", resolveApplicantForApproval(TWINS, "Abebe").candidates.length === 2);

// The Fayda / TIN tiers are only reachable when a record carries them, which a
// rental application does not - so a search box never mistakes one for another.
const WITH_DOCS: Array<MatchableApplicant> = [
  { id: "doc", fullName: "Abebe Bekele", phone: "0911000009", faydaId: "AB1234567890", tinNumber: "0012345678" },
];
check("a Fayda ID finds its record", matchApplicants(WITH_DOCS, "AB1234567890")[0]?.tier === "fayda");
check("in any case", matchApplicants(WITH_DOCS, "ab1234567890")[0]?.tier === "fayda");
check("a TIN finds its record", matchApplicants(WITH_DOCS, "0012345678")[0]?.tier === "tin");
// A NAME query must never be promoted to the Fayda tier. The tiers describe the
// evidence, not the result: "Abebe Bekele" is not a Fayda ID however well it
// matches, and letting it read as one would misrepresent the check performed.
check("a name query stays a name tier", matchApplicants(WITH_DOCS, "Abebe Bekele")[0]?.tier === "name");
check("and is still the right person", matchApplicants(WITH_DOCS, "Abebe Bekele")[0]?.record.id === "doc");
check("and resolves", resolveApplicantForApproval(WITH_DOCS, "AB1234567890").match?.record.id === "doc");

// ---------------------------------------------------------------------------
section("5. Mall units - a counter belongs to one person at a time");

const MALL: Mall = {
  id: "mall-test",
  name: "Test Mall",
  slug: "test-mall",
  city: "Addis Ababa",
  address: "Bole Road",
  description: "",
  floors: ["GFS", "1F"],
  agreementId: "MALL-TEST-2026",
  visible: true,
  logoUrl: null,
  coverImageUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const units = buildMallUnits(MALL, 3, "2026-01-01T00:00:00.000Z");
check("units are built for every floor", units.length === 6);
check("each unit is named for its floor", units[0].number === "GFS-01" && units[3].number === "1F-01");
check("every unit has a stable id", units[0].id === unitId(MALL.id, "GFS-01"));
check("the id is deterministic", unitId(MALL.id, "gfs-01") === unitId(MALL.id, "GFS-01"));
check("every unit starts available", units.every((unit) => unit.status === "available"));
check("every unit has a rent", units.every((unit) => unit.monthlyRentEtb > 0));
check("every unit has a size", units.every((unit) => unit.sizeSqm > 0));
check("building twice is idempotent", buildMallUnits(MALL, 3).length === buildMallUnits(MALL, 3).length);

// The building is rebuilt from mall.floors, so adding a floor extends it.
const WIDER = { ...MALL, floors: ["B1", "GFS", "1F", "2F", "3F"] };
check("a mall with five floors has five blocks", buildMallUnits(WIDER, 2).length === 10);

check("a null mall groups nothing", unitsForMall(units, null).length === 0);
check("a null mall offers nothing", availableUnits(units, null).length === 0);
check(
  "units are listed in the mall's own floor order",
  unitsForMall(units, MALL).map((u) => u.number).join(",") === "GFS-01,GFS-02,GFS-03,1F-01,1F-02,1F-03",
  unitsForMall(units, MALL).map((u) => u.number).join(",")
);

// A basement sorts before "1F" and before "GFS" as plain strings, so an
// alphabetical sort would walk the building backwards.
const BASEMENTS = { ...MALL, floors: ["B1", "GFS", "1F", "2F", "3F"] };
check(
  "a basement is walked first, not alphabetically",
  unitsForMall(buildMallUnits(BASEMENTS, 1), BASEMENTS)[0].number === "B1-01",
  unitsForMall(buildMallUnits(BASEMENTS, 1), BASEMENTS)[0].number
);
check(
  "and the ground floor comes before the first floor",
  unitsForMall(buildMallUnits(BASEMENTS, 1), BASEMENTS).map((u) => u.number).join(",") ===
    "B1-01,GFS-01,1F-01,2F-01,3F-01"
);
check("every unit is available at first", availableUnits(units, MALL).length === 6);

// --- A pending application HOLDS its counter. This is the point of the model.
const held: MallUnit[] = units.map((unit) =>
  unit.number === "GFS-02" ? { ...unit, status: "held", applicationId: "RA-pending" } : unit,
);
check("a held counter is not offered", !availableUnits(held, MALL).some((u) => u.number === "GFS-02"));
check("everything else still is", availableUnits(held, MALL).length === 5);
check("holding is reported as a conflict", findUnitConflicts(held, MALL, ["GFS-02"]).length === 1);
check("its neighbours are not", findUnitConflicts(held, MALL, ["GFS-01", "GFS-03"]).length === 0);

// --- A leased counter is equally gone.
const leased: MallUnit[] = units.map((unit) =>
  unit.number === "1F-01" ? { ...unit, status: "leased", businessId: "biz-1" } : unit,
);
check("a leased counter is not offered", !availableUnits(leased, MALL).some((u) => u.number === "1F-01"));
check("leasing is reported as a conflict", findUnitConflicts(leased, MALL, ["1F-01"]).length === 1);

// --- Releasing a hold puts it back on the market. This is what rejection does.
// Annotated `MallUnit[]` because an inline `status: "available"` widens to
// `string`, which is not assignable to the `MallUnitStatus` union.
const released: MallUnit[] = held.map((unit) =>
  unit.number === "GFS-02" ? { ...unit, status: "available" as const, applicationId: null } : unit,
);
check("a released counter returns", availableUnits(released, MALL).length === 6);
check("and is no longer a conflict", findUnitConflicts(released, MALL, ["GFS-02"]).length === 0);

// --- Case and spacing must not produce two claims on one counter.
check("a free counter is not a conflict", findUnitConflicts(units, MALL, ["GFS-01"]).length === 0);
check("lowercase is the same counter", findUnitConflicts(held, MALL, ["gfs-02"]).length === 1);
check("with spaces too", findUnitConflicts(held, MALL, [" GFS-02 "]).length === 1);

// --- A counter the building does not have is refused, not accepted.
check("a non-existent counter is refused", findUnitConflicts(units, MALL, ["GFS-99"]).length === 1);
check("and it is reported as unknown", findUnitConflicts(units, MALL, ["GFS-99"])[0].sizeSqm === 0);
check("describeUnit says so", /not a unit/.test(describeUnit(findUnitConflicts(units, MALL, ["GFS-99"])[0])));
check("a real unit describes itself", /m2/.test(describeUnit(units[0])));

// --- Only the clashing counter is reported, so the message is actionable.
const mixed = findUnitConflicts(held, MALL, ["GFS-01", "GFS-02"]);
check("only the clash is reported", mixed.length === 1 && mixed[0].number === "GFS-02");

check("no rooms requested means no conflict", findUnitConflicts(units, MALL, []).length === 0);
check("a null mall finds no conflict", findUnitConflicts(units, null, ["GFS-01"]).length === 0);

// --- Floors come from the mall, not from the applicant.
check("a real floor is accepted", isFloorOf(MALL, "1F"));
check("in any case", isFloorOf(MALL, "1f"));
check("a floor the mall lacks is refused", !isFloorOf(MALL, "9F"));
check("an empty floor is refused", !isFloorOf(MALL, ""));
check("a null floor is refused", !isFloorOf(MALL, null));
check("a null mall refuses every floor", !isFloorOf(null, "1F"));

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) {
  console.error("\nStore rental verification FAILED.");
  process.exit(1);
}
console.log("\nStore rental verification passed.");