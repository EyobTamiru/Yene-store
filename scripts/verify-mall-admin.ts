/**
 * ============================================================================
 *  MALL ADMINISTRATION VERIFICATION (Sections 10 & 41)
 * ============================================================================
 *
 *  Needs no API key, no server and no database: everything under test is pure,
 *  in `src/platform/mallAdmin.ts`. That is the point of keeping occupancy and the
 *  rent roll out of the router - the arithmetic behind a landlord's dashboard can
 *  be checked on every commit.
 *
 *  The tests are grouped by the claim they defend:
 *
 *    1. Occupancy    - four buckets, and which unit lands in each
 *    2. Rent roll    - counted from LEASES, never from asking prices
 *    3. Payout       - the landlord's share, rounded to a payable figure
 *    4. Unit edits   - a rejected edit changes nothing at all
 *    5. Deletion     - refused while tenants or leases exist
 *
 *  Run with `npm run test:mall-admin`.
 */

import {
  canDeleteMall,
  landlordPayout,
  normaliseUnitEdit,
  occupancy,
  rentRoll,
} from "../src/platform/mallAdmin";
import type { Mall, MallUnit, StoreLease } from "../src/platform/types";

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

const MALL: Mall = {
  id: "mall-a",
  name: "Test Mall",
  slug: "test-mall",
  city: "Addis Ababa",
  address: "Bole Road",
  description: "",
  floors: ["GFS", "1F"],
  agreementId: null,
  visible: true,
  logoUrl: null,
  coverImageUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

let seq = 0;
/** A unit, defaulting to free-and-advertised so each test states only what it tests. */
function unit(overrides: Partial<MallUnit> = {}): MallUnit {
  seq += 1;
  return {
    id: `unit-${seq}`,
    mallId: MALL.id,
    floor: "GFS",
    number: `GFS-${String(seq).padStart(2, "0")}`,
    sizeSqm: 20,
    monthlyRentEtb: 10_000,
    status: "available",
    listable: true,
    businessId: null,
    applicationId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A lease, defaulting to active at the unit's asking price. */
function lease(target: MallUnit, overrides: Partial<StoreLease> = {}): StoreLease {
  return {
    id: `lease-${target.id}`,
    unitId: target.id,
    mallId: target.mallId,
    businessId: "biz-1",
    applicationId: "RA-1",
    monthlyRentEtb: target.monthlyRentEtb,
    depositEtb: 20_000,
    startDate: "2026-01-01",
    endDate: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
section("1. Occupancy - four buckets, and which unit lands in each");
{
  const leased = unit({ status: "leased", businessId: "biz-1" });
  const held = unit({ status: "held", applicationId: "RA-1" });
  const free = unit();
  const unlisted = unit({ listable: false });
  const units = [leased, held, free, unlisted];

  const result = occupancy(units, MALL);
  check("every unit is counted", result.total === 4);
  check("a leased counter is leased", result.leased === 1);
  check("a held counter is held, not available", result.held === 1);
  check("a free, advertised counter is available", result.available === 1);
  check("a free, unlisted counter is unlisted", result.unlisted === 1);
  check("occupancy is 25%", result.occupancyPercent === 25);
  check(
    "the four buckets account for every unit",
    result.leased + result.held + result.available + result.unlisted === result.total
  );

  // The ORDER of the checks matters, and these are the cases that prove it.
  const occupiedButUnlisted = unit({ status: "leased", businessId: "biz-2", listable: false });
  check(
    "a leased counter stays leased even if unlisted",
    occupancy([occupiedButUnlisted], MALL).leased === 1 &&
      occupancy([occupiedButUnlisted], MALL).unlisted === 0,
    "an occupied shop is not for sale"
  );

  const heldAndUnlisted = unit({ status: "held", applicationId: "RA-2", listable: false });
  check(
    "a held counter stays held even if unlisted",
    occupancy([heldAndUnlisted], MALL).held === 1 &&
      occupancy([heldAndUnlisted], MALL).unlisted === 0,
    "a pending request is a live claim"
  );

  // `businessId` is the real signal, so a row whose status drifted is still read
  // correctly rather than being reported as free stock.
  const drifted = unit({ status: "available", businessId: "biz-3" });
  check("a business id alone marks it leased", occupancy([drifted], MALL).leased === 1);

  check("a mall with no units reports no occupancy", occupancy([], MALL).occupancyPercent === null);
  check("a null mall is inert", occupancy(units, null).total === 0);
  check("a null mall has no occupancy", occupancy(units, null).occupancyPercent === null);

  const otherMall = unit({ mallId: "mall-b" });
  check("another mall's units are not counted", occupancy([otherMall], MALL).total === 0);
}

// ---------------------------------------------------------------------------
section("2. Rent roll - counted from leases, never from asking prices");
{
  const full = unit({ monthlyRentEtb: 20_000 });
  const discounted = unit({ monthlyRentEtb: 20_000 });
  const free = unit({ monthlyRentEtb: 15_000 });
  const unlisted = unit({ monthlyRentEtb: 30_000, listable: false });
  const held = unit({ monthlyRentEtb: 40_000, status: "held", applicationId: "RA-9" });

  // A counter somebody actually rents is `leased` on the UNIT, not only on the
  // lease row. Marking them here is what keeps them out of potential revenue -
  // and it is the state `markUnits` writes when a rental is approved.
  const leasedFull = { ...full, status: "leased" as const, businessId: "biz-1" };
  const leasedDiscounted = { ...discounted, status: "leased" as const, businessId: "biz-2" };
  const units = [leasedFull, leasedDiscounted, free, unlisted, held];

  const leases = [
    lease(leasedFull),
    // A negotiated discount: advertised at 20,000, agreed at 17,000.
    lease(leasedDiscounted, { monthlyRentEtb: 17_000, businessId: "biz-2" }),
    // An ended lease leaves its counter free again, so it counts as stock.
    lease(free, { active: false, monthlyRentEtb: 99_000 }),
  ];

  const roll = rentRoll(units, leases, MALL);
  check("two active leases are counted", roll.leaseCount === 2);
  check("the rent roll uses the AGREED rent, not the asking price", roll.contractedMonthlyEtb === 37_000);
  check("the asking price is reported beside it", roll.listedMonthlyEtb === 40_000);
  check("an ended lease contributes nothing", roll.contractedMonthlyEtb < 99_000);
  check("deposits are totalled", roll.depositsHeldEtb === 40_000);

  // Potential revenue is what a new tenant could be charged for RIGHT NOW: the
  // one free, advertised counter. The two leased counters are excluded because
  // their UNIT is marked leased, and the other two because they are withheld or
  // spoken for.
  check("only free, advertised counters are potential revenue", roll.potentialMonthlyEtb === 15_000);
  check("a leased counter is not potential revenue", roll.potentialMonthlyEtb < 20_000);
  check("an unlisted counter is not potential revenue", roll.potentialMonthlyEtb < 30_000);
  check("a held counter is not potential revenue", roll.potentialMonthlyEtb < 40_000);

  check("a mall with no leases collects nothing", rentRoll(units, [], MALL).contractedMonthlyEtb === 0);
  check("a null mall collects nothing", rentRoll(units, leases, null).contractedMonthlyEtb === 0);

  const orphan = lease(unit({ mallId: "mall-b" }), { monthlyRentEtb: 5_000 });
  check(
    "a lease for another mall is counted by neither mall",
    rentRoll([], [orphan], MALL).listedMonthlyEtb === 0
  );
}

// ---------------------------------------------------------------------------
section("3. Payout - the landlord's share, rounded to something payable");
{
  const roll = rentRoll([], [], MALL);
  const withRent = { ...roll, contractedMonthlyEtb: 100_000 };

  check("70% of 100,000 is 70,000", landlordPayout(withRent, 70) === 70_000);
  check("100% is the whole rent", landlordPayout(withRent, 100) === 100_000);
  check("0% is nothing", landlordPayout(withRent, 0) === 0);
  check("a share above 100 is capped", landlordPayout(withRent, 150) === 100_000);
  check("a negative share is floored", landlordPayout(withRent, -20) === 0);

  // 33% of 12,345 is 4,073.85 - a share of a birr nobody can pay.
  const awkward = { ...roll, contractedMonthlyEtb: 12_345 };
  check("a repeating share is rounded to a whole birr", landlordPayout(awkward, 33) === 4_074);
  check("and rounded, never truncated", landlordPayout(awkward, 33) > 4073);
  check("a share that divides evenly is exact", landlordPayout(withRent, 25) === 25_000);
  check("nothing collected means no payout", landlordPayout(roll, 70) === 0);
}

// ---------------------------------------------------------------------------
section("4. Unit edits - a rejected edit changes NOTHING");
{
  const ok = normaliseUnitEdit({ monthlyRentEtb: "15000" });
  check("a valid price is accepted", ok.error === null && ok.patch.monthlyRentEtb === 15_000);

  const zero = normaliseUnitEdit({ monthlyRentEtb: 0 });
  check(
    "a zero price is accepted - letting a counter go free is legitimate",
    zero.error === null && zero.patch.monthlyRentEtb === 0
  );

  const negative = normaliseUnitEdit({ monthlyRentEtb: -5 });
  check("a negative price is refused", negative.error !== null);
  check("and contributes no fields at all", Object.keys(negative.patch).length === 0);

  const notANumber = normaliseUnitEdit({ monthlyRentEtb: "free" });
  check("a non-numeric price is refused", notANumber.error !== null);
  check("and contributes no fields", Object.keys(notANumber.patch).length === 0);

  const badSize = normaliseUnitEdit({ sizeSqm: 0 });
  check("a zero size is refused", badSize.error !== null);

  const badStatus = normaliseUnitEdit({ status: "destroyed" });
  check("an unknown status is refused", badStatus.error !== null);

  check("a listable flag is accepted", normaliseUnitEdit({ listable: false }).patch.listable === false);
  check(
    "the string 'false' is honoured too, not treated as truthy",
    normaliseUnitEdit({ listable: "false" }).patch.listable === false
  );
  check("a listable flag defaults to on", normaliseUnitEdit({ listable: true }).patch.listable === true);

  // THE POINT: one bad field must not let the good ones through.
  const partial = normaliseUnitEdit({ monthlyRentEtb: 99_000, sizeSqm: -1 });
  check("a bad size voids the whole edit", partial.error !== null);
  check("so the good price is not applied either", partial.patch.monthlyRentEtb === undefined);

  const uppercased = normaliseUnitEdit({ number: "  gfs-07 " });
  check("a shop number is trimmed and uppercased", uppercased.patch.number === "GFS-07");
}

// ---------------------------------------------------------------------------
section("5. Deletion - refused while tenants or leases exist");
{
  const withStore = [{ id: "biz-1", mall: { mallId: MALL.id } }];
  const blocked = canDeleteMall(MALL, withStore, []);
  check("a mall with a store is NOT safe to delete", blocked.allowed === false);
  check("the refusal counts the stores", blocked.storeCount === 1);
  check("and says what to do about it", /still trade/.test(blocked.reason));

  const withLease = canDeleteMall(MALL, [], [lease(unit())]);
  check("a mall with an active lease is NOT safe to delete", withLease.allowed === false);
  check("the refusal counts the leases", withLease.activeLeases === 1);

  const ended = canDeleteMall(MALL, [], [lease(unit(), { active: false })]);
  check("an ended lease does not block deletion", ended.allowed === true);

  const foreignStore = canDeleteMall(MALL, [{ id: "biz-9", mall: { mallId: "mall-b" } }], []);
  check("another mall's store does not block it", foreignStore.allowed === true);

  const standalone = canDeleteMall(MALL, [{ id: "biz-1", mall: null }], []);
  check("a standalone store does not block it", standalone.allowed === true);

  const clear = canDeleteMall(MALL, [], []);
  check("an empty mall is safe to delete", clear.allowed === true);
  check("and says so", /Safe to delete/.test(clear.reason));
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) {
  console.error("\nMall administration verification FAILED.");
  process.exit(1);
}
console.log("\nMall administration verification passed.");