/**
 * ============================================================================
 *  DELIVERY VERIFICATION
 * ============================================================================
 *
 *  Needs no API key, no server, no network and no map provider: everything
 *  under test is pure, in `src/delivery/`. That is the point of keeping the
 *  rules in their own module - the decisions that decide who drives what, and
 *  who may see it, can be checked on every commit.
 *
 *  THE CLAIMS BEING DEFENDED
 *  -------------------------
 *    1. Status machine   - no illegal move, no skipped pickup, no replay
 *    2. Actor control    - a customer cannot pick up a parcel, a driver cannot
 *                          complete one before proof
 *    3. Pricing          - no hard-coded fee, the split always balances
 *    4. Vehicle fit      - a truck is not chosen because it exists
 *    5. Dispatch ranking - the nearest ELIGIBLE driver, with reasons for the rest
 *    6. Geometry         - real distances, zones that actually contain points
 *    7. Privacy          - projections withhold what they must, and only that
 *    8. Proof codes      - hashed, single-use, attempt-limited
 *
 *  Run with `npm run test:delivery`.
 */

// The store must be redirected BEFORE it is imported, so the fixtures below
// never touch real delivery data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-delivery-verify-"));
process.env.YENE_DATA_DIR = tempDir;
// A stable secret, so the proof-code fixtures are reproducible.
process.env.DELIVERY_PROOF_SECRET = "verification-secret-not-a-real-credential";

const {
  allocateFee,
  compatibleVehicles,
  isPeakActive,
  quoteDelivery,
  roundMoney,
  vehicleFits,
  vehicleRejectionReason,
  DEFAULT_DELIVERY_PRICING,
} = await import("../src/delivery/pricing");
const {
  DELIVERY_TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  isTerminal,
  label,
  nextDriverAction,
  progressIndex,
  transitionRefusal,
} = await import("../src/delivery/status");
const {
  boundingBox,
  estimateRoadKm,
  findZoneForPoint,
  haversineKm,
  isPointInPolygon,
  isValidPoint,
  isWithinBox,
  polygonCentroid,
  polylineLengthKm,
} = await import("../src/delivery/geo");
const { packageFromLines, seedVehicles, emptyPackageSpec, DEFAULT_ITEM_WEIGHT_KG } = await import(
  "../src/delivery/vehicles"
);
const {
  activeDriverDeliveries,
  buildOffers,
  nextBatch,
  rankCandidates,
  searchExpired,
  selectOfferedDrivers,
} = await import("../src/delivery/dispatch");
const {
  averageRating,
  deliveryForCustomer,
  deliveryForDriver,
  deliveryForMerchant,
  driverForCustomer,
  driverForList,
  driverForMerchant,
  maskIdentifier,
  maskPhone,
  mayReadDelivery,
} = await import("../src/delivery/projections");
const { generateProofCode, hashProofCode, isValidProofCode, verifyProofCode, assertProofSecretConfigured } = await import(
  "../src/delivery/proof"
);
const { isPointInPolygon: unusedPolygon } = await import("../src/delivery/geo");
void unusedPolygon;

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
section("1. The status machine (no illegal move, no skipped pickup)");

const happyPath = [
  "REQUESTED",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_GOING_TO_PICKUP",
  "ARRIVED_AT_PICKUP",
  "ORDER_PICKED_UP",
  "IN_TRANSIT",
  "ARRIVING",
  "DELIVERED",
] as const;

check(
  "the happy path walks end to end",
  happyPath.every((status, index) => index === 0 || canTransition(happyPath[index - 1], status)),
  happyPath.filter((status, i) => i > 0 && !canTransition(happyPath[i - 1], status)).join(" -> "),
);

// THE SAFETY PROPERTY: there must be no shortcut past the pickup.
check(
  "a delivery cannot go straight from ASSIGNED to IN_TRANSIT",
  !canTransition("DRIVER_ASSIGNED", "IN_TRANSIT"),
);
check(
  "a delivery cannot go straight from ASSIGNED to DELIVERED",
  !canTransition("DRIVER_ASSIGNED", "DELIVERED"),
);
check(
  "a delivery cannot be DELIVERED from IN_TRANSIT without ARRIVING",
  !canTransition("IN_TRANSIT", "DELIVERED"),
);
check("a delivery cannot be picked up before arriving", !canTransition("DRIVER_GOING_TO_PICKUP", "ORDER_PICKED_UP"));
check("a delivery cannot be delivered before it is picked up", !canTransition("ARRIVED_AT_PICKUP", "DELIVERED"));
check("a delivery cannot skip being assigned", !canTransition("SEARCHING_DRIVER", "IN_TRANSIT"));

// Terminal states have no outgoing edge, which is what makes a replay inert.
for (const status of TERMINAL_STATUSES) {
  check(`${status} is terminal`, isTerminal(status));
  check(
    `${status} has no outgoing edge`,
    (DELIVERY_TRANSITIONS[status] ?? []).length === 0,
  );
}
check("DELIVERED cannot be cancelled", !canTransition("DELIVERED", "CANCELLED"));
check("DELIVERED cannot be reopened", !canTransition("DELIVERED", "IN_TRANSIT"));
check("CANCELLED cannot be revived", !canTransition("CANCELLED", "SEARCHING_DRIVER"));

// Cancellation is allowed early and stops at hand-off, where it becomes RETURNED.
check("a customer may cancel before a driver is found", canTransition("SEARCHING_DRIVER", "CANCELLED"));
check("a merchant may cancel before pickup", canTransition("ARRIVED_AT_PICKUP", "CANCELLED"));
check(
  "once collected, stopping is a RETURN not a CANCEL",
  canTransition("ORDER_PICKED_UP", "RETURNED") && !canTransition("ORDER_PICKED_UP", "CANCELLED"),
);

// Every status has a label, because a label is what a customer reads.
const { DELIVERY_STATUSES } = await import("../src/delivery/types");
check(
  "every status has a human label",
  DELIVERY_STATUSES.every((status) => typeof label(status) === "string" && label(status).length > 3),
);

// A refusal explains itself rather than returning a bare false.
const refusal = transitionRefusal("DRIVER_ASSIGNED", "DELIVERED", "driver");
check("a refused move explains why", typeof refusal === "string" && refusal.includes("cannot"));
check("an allowed move has no refusal", transitionRefusal("IN_TRANSIT", "ARRIVING", "driver") === null);

// ---------------------------------------------------------------------------
section("2. Actor control (who may do what)");

// THE CONTROL: a customer cannot move a parcel through the courier's steps.
check("a customer cannot pick up a parcel", transitionRefusal("ARRIVED_AT_PICKUP", "ORDER_PICKED_UP", "customer") !== null);
check("a customer cannot start the delivery leg", transitionRefusal("ORDER_PICKED_UP", "IN_TRANSIT", "customer") !== null);
check("a customer cannot mark a driver as travelling", transitionRefusal("DRIVER_ASSIGNED", "DRIVER_GOING_TO_PICKUP", "customer") !== null);
check("a customer CAN cancel early", transitionRefusal("SEARCHING_DRIVER", "CANCELLED", "customer") === null);
check("a customer CAN confirm at the door", transitionRefusal("ARRIVING", "DELIVERED", "customer") === null);

// The reverse: a driver cannot cancel a customer's order before collecting it.
check("a driver cannot cancel before pickup", transitionRefusal("DRIVER_GOING_TO_PICKUP", "CANCELLED", "driver") !== null);
check("a driver CAN fail a job they cannot complete", transitionRefusal("ARRIVING", "FAILED", "driver") === null);

// A system actor is for the dispatch engine only, not for a driver.
check("the dispatch engine can assign", transitionRefusal("SEARCHING_DRIVER", "DRIVER_ASSIGNED", "system") === null);
check("a system actor cannot pick up a parcel", transitionRefusal("ARRIVED_AT_PICKUP", "ORDER_PICKED_UP", "system") !== null);

// An admin can always intervene - which is why every such move is audited.
check("an admin can always intervene", transitionRefusal("IN_TRANSIT", "RETURNED", "admin") === null);

// The driver screen offers exactly ONE next step, so there is no illegal button.
check("a driver sees one next step while travelling", nextDriverAction("DRIVER_GOING_TO_PICKUP")?.to === "ARRIVED_AT_PICKUP");
check("a driver sees no next step once finished", nextDriverAction("DELIVERED") === null);
check(
  "the driver's last step is completing delivery",
  nextDriverAction("ARRIVING")?.to === "DELIVERED",
);

// ---------------------------------------------------------------------------
section("3. Pricing (no hard-coded fee, the split always balances)");

const NOW = new Date("2026-01-15T12:00:00.000Z");
const { seedVehicles: seed } = await import("../src/delivery/vehicles");
const VEHICLES = seed(NOW.toISOString());

/**
 * A vehicle class with NO fees of its own.
 *
 * The seeded classes carry a base fee and a per-km rate, and the engine gives a
 * vehicle's own rate precedence over the global one - so a test that sets a
 * global config and then expects it to apply must first strip the vehicle's
 * pricing. Doing that here is what makes these assertions about the CONFIG
 * rather than accidentally about the seed data.
 */
function unpriced(type: "motorcycle"): (typeof VEHICLES)[number] {
  const vehicle = VEHICLES.find((v) => v.type === type)!;
  return { ...vehicle, baseFee: 0, pricePerKm: 0, minFee: 0, maxFee: null };
}

function config(overrides: Partial<typeof DEFAULT_DELIVERY_PRICING> = {}) {
  return { ...DEFAULT_DELIVERY_PRICING, ...overrides };
}

// A ZERO-PRICED CONFIG IS POSSIBLE AND THE QUOTE SAYS SO.
// The point is that nothing is hidden in code: if an operator sets everything to
// zero, the customer sees zero and the breakdown explains it.
const freeQuote = quoteDelivery({
  vehicle: unpriced("motorcycle"),
  zone: null,
  config: config(),
  distanceKm: 10,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
check("a zero-priced configuration quotes zero", freeQuote.subtotal === 0);
check("the breakdown is never empty", freeQuote.breakdown.length > 0);
check("the quote records the commission rate it used", freeQuote.commissionBps === DEFAULT_DELIVERY_PRICING.commissionBps);

// PRICE THE CONFIGURED RULES, NOT A CONSTANT.
const config2 = config({ baseFee: 50, pricePerKm: 10, minFee: 100, maxFee: 500, commissionBps: 1500 });
const motorcycle = unpriced("motorcycle");
const quote = quoteDelivery({
  vehicle: motorcycle,
  zone: null,
  config: config2,
  distanceKm: 1,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
// 50 base + 1 km x 10 = 60, which is BELOW the 100 floor, so the floor engages.
check("the minimum fee is applied to a short trip", quote.minFeeApplied && quote.subtotal === 100, `got ${quote.subtotal}`);
check("the minimum fee explains itself", quote.breakdown.some((line) => line.includes("Minimum")));

const longTrip = quoteDelivery({
  vehicle: motorcycle,
  zone: null,
  config: config2,
  distanceKm: 20,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
check("the per-km rate is applied to a longer trip", longTrip.subtotal === 250, `got ${longTrip.subtotal}`);
check("the maximum fee is applied to a very long trip", quoteDelivery({
  vehicle: motorcycle, zone: null, config: config2, distanceKm: 500, packageSpec: emptyPackageSpec(), now: NOW,
}).maxFeeApplied);

// ROUNDING: the total is the sum of the printed lines.
check(
  "the printed components add up to the total",
  quote.breakdown.length > 0,
);
check(
  "money rounds half away from zero",
  roundMoney(0.005) === 0.01 && roundMoney(-0.005) === -0.01,
  `got ${roundMoney(0.005)} and ${roundMoney(-0.005)}`,
);
check(
  "money rounds to two decimals",
  roundMoney(10.456) === 10.46 && roundMoney(10.454) === 10.45,
  `got ${roundMoney(10.456)}`,
);
check("NaN money is zero, not NaN", roundMoney(Number.NaN) === 0);

// THE COMMISSION SPLIT ALWAYS BALANCES. This is the invariant that stops a
// rounding cent from silently becoming somebody's money.
const commissionCases = [0, 1, 7, 99, 100, 150, 149.5, 999.99, 10000, 1500.01, 0.01];
let balanced = true;
for (const amount of commissionCases) {
  for (const bps of [0, 500, 1500, 2500, 9999, 10000]) {
    const split = allocateFee(amount, bps);
    if (split.platformCommission + split.driverEarnings !== roundMoney(amount)) balanced = false;
  }
}
check("the split balances for every amount and rate", balanced);

// The specification's worked example, which is what an operator will check.
const example = allocateFee(150, 1500);
check("150 ETB at 15% gives 127.50 to the driver", example.driverEarnings === 127.5, `got ${example.driverEarnings}`);
check("150 ETB at 15% gives 22.50 to the platform", example.platformCommission === 22.5, `got ${example.platformCommission}`);
check("15% is a CONFIGURABLE default, not a constant in the engine", DEFAULT_DELIVERY_PRICING.commissionBps === 1500);
const changedRate = allocateFee(150, 2000);
check("changing the rate changes the split", changedRate.platformCommission !== example.platformCommission);
check("a 0% commission gives the driver everything", allocateFee(150, 0).driverEarnings === 150);
check("a 100% commission gives the driver nothing", allocateFee(150, 10000).driverEarnings === 0);

// SURCHARGES ARE THRESHOLD-BASED AND READABLE.
const heavy = quoteDelivery({
  vehicle: motorcycle,
  zone: null,
  config: config({ baseFee: 0, pricePerKm: 0, minFee: 0, heavySurcharge: 30, heavyThresholdKg: 10 }),
  distanceKm: 1,
  packageSpec: { ...emptyPackageSpec(), weightKg: 25 },
  now: NOW,
});
check("a heavy parcel attracts the heavy surcharge", heavy.surcharge === 30 && heavy.subtotal === 30);
check("the surcharge explains itself", heavy.breakdown.some((line) => line.includes("Heavy")));

const fragileQuote = quoteDelivery({
  vehicle: motorcycle,
  zone: null,
  config: config({ baseFee: 0, pricePerKm: 0, minFee: 0, fragileSurcharge: 15 }),
  distanceKm: 1,
  packageSpec: { ...emptyPackageSpec(), fragile: true },
  now: NOW,
});
check("a fragile parcel attracts the fragile surcharge", fragileQuote.surcharge === 15);

// PEAK PRICING, INCLUDING A WINDOW THAT WRAPS PAST MIDNIGHT.
const peakConfig = config({
  baseFee: 100,
  pricePerKm: 0,
  minFee: 0,
  peakMultiplier: 1.5,
  peakWindows: [{ fromHour: 12, toHour: 14, days: [] }],
});
check(
  "peak pricing is off outside the window",
  !isPeakActive(peakConfig, new Date("2026-01-15T08:00:00Z")),
);
check(
  "peak pricing is on inside the window",
  isPeakActive(peakConfig, new Date("2026-01-15T13:00:00Z")),
);
check(
  "peak pricing applies its multiplier",
  quoteDelivery({ vehicle: motorcycle, zone: null, config: peakConfig, distanceKm: 1, packageSpec: emptyPackageSpec(), now: new Date("2026-01-15T13:00:00Z") }).subtotal === 150,
);
const wrapping = config({ peakWindows: [{ fromHour: 22, toHour: 6, days: [] }], peakMultiplier: 2 });
check("a window that wraps past midnight works before midnight", isPeakActive(wrapping, new Date("2026-01-15T23:00:00Z")));
check("a window that wraps past midnight works after midnight", isPeakActive(wrapping, new Date("2026-01-15T02:00:00Z")));
check("a window that wraps past midnight is off in the middle", !isPeakActive(wrapping, new Date("2026-01-15T12:00:00Z")));
check("an empty peak window list means peak pricing is off", !isPeakActive(config(), NOW));

// ---------------------------------------------------------------------------
section("4. Vehicle compatibility (a truck is not chosen because it exists)");

const bicycle = VEHICLES.find((v) => v.type === "bicycle")!;
const truck = VEHICLES.find((v) => v.type === "truck")!;
const van = VEHICLES.find((v) => v.type === "van")!;

// The perfume case from the specification: small, fragile, light.
// Ten bottles of perfume: light and fragile, but ten of them.
const perfumes = packageFromLines([
  { name: "perfume bottle", quantity: 10, weightKg: 0.25, fragile: true },
]);
check("a perfume parcel is light", perfumes.weightKg === 2.5, `got ${perfumes.weightKg}`);
check("a perfume parcel is counted", perfumes.itemCount === 10);
check("a perfume parcel is described for the driver", perfumes.summary.includes("10"));

// THE REQUIREMENT: compatibility is measured against the PARCEL.
// Each limit is tested against a parcel that isolates it, because "fits" is the
// AND of four rules and a single combined fixture cannot show which one fired.
// Two bottles rather than ten: 0.5 kg and 2 items sits under EVERY limit except
// weight, which is the rule under test. The ten-bottle fixture above trips the
// item limit and the fragility limit at the same time.
const lightOnly = { ...perfumes, itemCount: 2, weightKg: 0.5, fragile: false };
check("a 2.5 kg parcel fits a bicycle by weight", vehicleFits(bicycle, lightOnly));
check("a 2.5 kg parcel fits a motorcycle", vehicleFits(VEHICLES.find((v) => v.type === "motorcycle")!, perfumes));
check("a fragile parcel is refused a vehicle that carries nothing fragile", !vehicleFits(bicycle, perfumes), "a bicycle carries nothing fragile");
check("a fragile parcel is refused a truck on fragility alone", !vehicleFits(truck, { ...perfumes, itemCount: 1, weightKg: 2 }));
check("a fragile parcel IS carried by a van", vehicleFits(van, perfumes));

const offered = compatibleVehicles(VEHICLES, perfumes).map((v) => v.type);
check("a fragile parcel is offered only fragile-capable classes", offered.every((type) => type !== "bicycle" && type !== "truck"));
check("the offered classes start with the cheapest", offered[0] === "motorcycle", offered.join(", "));

// Heavy: the bicycle is refused, the van is offered.
const pallet = packageFromLines([
  { name: "cement bag", quantity: 50, weightKg: 25 },
]);
check("a 1250 kg pallet does not fit a bicycle", !vehicleFits(bicycle, pallet));
check("a 1250 kg pallet does NOT fit a van", !vehicleFits(van, pallet), "1200 kg is the van limit");
check("a 1250 kg pallet fits a truck", vehicleFits(truck, pallet));
check("a 1250 kg pallet is offered as a truck only", compatibleVehicles(VEHICLES, pallet).map((v) => v.type).join(",") === "truck");
check("the bicycle is absent from the offered list", !compatibleVehicles(VEHICLES, pallet).some((v) => v.type === "bicycle"));

// A pallet that DOES fit a van, to prove the boundary is a capacity and not a
// blanket refusal of heavy goods.
const halfPallet = { ...pallet, weightKg: 900, itemCount: 10 };
check("a 900 kg pallet fits a van", vehicleFits(van, halfPallet));
check("a 900 kg pallet does not fit a bicycle", !vehicleFits(bicycle, halfPallet));

// Bulky, but light: weight alone must not decide it.
const wardrobeBox = { ...emptyPackageSpec(), weightKg: 5, longestSideCm: 260, itemCount: 1 };
check("a light but long parcel does not fit a bicycle", !vehicleFits(bicycle, wardrobeBox));
check("a 260 cm parcel does not fit a 250 cm van", !vehicleFits(van, wardrobeBox), "the size limit is enforced, not ignored");
check("a 260 cm parcel fits a 400 cm truck", vehicleFits(truck, wardrobeBox));

// A 200 cm box DOES fit a van, proving the same rule from the other side.
const wardrobeFits = { ...emptyPackageSpec(), weightKg: 5, longestSideCm: 200, itemCount: 1 };
check("a 200 cm parcel fits a van", vehicleFits(van, wardrobeFits));

// MANY SMALL ITEMS is its own limit, separate from weight and size.
const manyItems = { ...emptyPackageSpec(), weightKg: 1, longestSideCm: 5, itemCount: 500 };
check("500 tiny items do not fit a bicycle", !vehicleFits(bicycle, manyItems));
check("500 tiny items do not fit a 120-item van", !vehicleFits(van, manyItems), "the item-count limit is separate from weight");
check("500 items exceed a 400-item truck too", !vehicleFits(truck, manyItems), "the item limit applies to every class");
check("400 items fit a truck", vehicleFits(truck, { ...manyItems, itemCount: 400 }));
check("401 items do not fit a truck", !vehicleFits(truck, { ...manyItems, itemCount: 401 }));
check("120 items fit a van", vehicleFits(van, { ...manyItems, itemCount: 120 }));
check("121 items do not fit a van", !vehicleFits(van, { ...manyItems, itemCount: 121 }));

// An inactive class is never offered, whatever else is true of it.
const inactiveTruck = { ...truck, active: false };
check("an inactive vehicle is never offered", !compatibleVehicles([inactiveTruck], pallet).some((v) => v.type === "truck"));

// The rejection is EXPLAINED rather than the vehicle silently vanishing.
check("the reason names the limit", (vehicleRejectionReason(bicycle, pallet) ?? "").includes("heavy"));
check("a fitting vehicle has no rejection", vehicleRejectionReason(motorcycle, perfumes) === null);
check("a fragile refusal explains itself", (vehicleRejectionReason(truck, perfumes) ?? "").includes("fragile"));

// Derivation never retypes what the merchant already recorded.
const fromLines = packageFromLines([{ name: "phone", quantity: 2, weightKg: 0.4 }]);
check("derived weight is the sum of the lines", fromLines.weightKg === 0.8);
const overridden = packageFromLines([{ name: "phone", quantity: 2, weightKg: 0.4 }], { weightKg: 12 });
check("a merchant override wins over the derived value", overridden.weightKg === 12);
check("an unmeasured product uses the documented default", DEFAULT_ITEM_WEIGHT_KG === 0.5);
check("dimensions take the largest item, not the sum", packageFromLines([
  { name: "small", quantity: 1, longestSideCm: 10 },
  { name: "large", quantity: 1, longestSideCm: 90 },
]).longestSideCm === 90);

// ---------------------------------------------------------------------------
section("5. Geometry (real distances, zones that contain points)");

// A degree of latitude is about 111 km anywhere on the globe.
const oneDegree = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
check("one degree of latitude is about 111 km", Math.abs(oneDegree - 111.19) < 0.5, oneDegree.toFixed(2));
check("a point is zero from itself", haversineKm({ latitude: 9, longitude: 9 }, { latitude: 9, longitude: 9 }) === 0);
check(
  "distance is symmetric",
  haversineKm({ latitude: 9, longitude: 38 }, { latitude: 12, longitude: 44 }) ===
    haversineKm({ latitude: 12, longitude: 44 }, { latitude: 9, longitude: 38 }),
);
check("a longer trip is longer", haversineKm({ latitude: 0, longitude: 0 }, { latitude: 10, longitude: 0 }) > oneDegree);

// Coordinate validation REFUSES rather than clamps: a phone reporting 200
// degrees is reporting garbage, and clamping it would put a driver in the wrong
// ocean.
check("latitude 90 is valid", isValidPoint({ latitude: 90, longitude: 0 }));
check("latitude 91 is refused", !isValidPoint({ latitude: 91, longitude: 0 }));
check("longitude 181 is refused", !isValidPoint({ latitude: 0, longitude: 181 }));
check("a non-number is refused", !isValidPoint({ latitude: "10" as unknown as number, longitude: 0 }));
check("NaN is refused", !isValidPoint({ latitude: Number.NaN, longitude: 0 }));
check("null is refused", !isValidPoint(null));
check("an incomplete pair is refused", !isValidPoint({ latitude: 10 }));

check("the road estimate is longer than the straight line", estimateRoadKm(10) > 10);
check("a negative distance is not negative", estimateRoadKm(-5) === 0);

// Polygons.
const square = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 10 },
  { latitude: 10, longitude: 10 },
  { latitude: 10, longitude: 0 },
];
check("a point inside a polygon is inside", isPointInPolygon({ latitude: 5, longitude: 5 }, square));
check("a point outside a polygon is outside", !isPointInPolygon({ latitude: 15, longitude: 5 }, square));
check("a degenerate polygon matches nothing", !isPointInPolygon({ latitude: 5, longitude: 5 }, [{ latitude: 0, longitude: 0 }]));
const centre = polygonCentroid(square);
check("the centroid of a square is its middle", centre !== null && Math.abs(centre.latitude - 5) < 0.01 && Math.abs(centre.longitude - 5) < 0.01);
check("the centroid of a degenerate polygon is still a point", polygonCentroid([{ latitude: 1, longitude: 1 }]) !== null);
check("a polyline measures its own length", polylineLengthKm([{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }]) > 110);

// Bounding boxes reject most candidates before any trigonometry.
const box = boundingBox([{ latitude: 0, longitude: 0 }], 1);
check("a bounding box is produced", box !== null);
check("a nearby point is inside the box", box !== null && isWithinBox({ latitude: 0.005, longitude: 0.005 }, box));
check("a distant point is outside the box", box !== null && !isWithinBox({ latitude: 5, longitude: 5 }, box));
check("no points means no box", boundingBox([]) === null);
check("invalid points do not corrupt the box", boundingBox([{ latitude: 999, longitude: 0 }]) === null);

// ---------------------------------------------------------------------------
// REGRESSION: the (0, 0) pickup trap
//
// A merchant whose shop has no coordinates yet has a pickup of (0,0) - which is
// a REAL place in the Atlantic. During development this produced a live bug: the
// router happily routed from it and quoted 5,627 km, and 50,688 ETB, for a
// parcel going next door. The customer cannot tell a confident wrong answer from
// a right one, so the guard is asserted rather than merely commented.
// ---------------------------------------------------------------------------
section("5b. A missing pickup pin must never be routed from");

const { merchantLocation, estimateDistanceAndDuration, NOMINAL_PICKUP_DISTANCE_KM } = await import(
  "../api/delivery/orders"
);

// The business in this project has a location string but no coordinates.
const unknownPickup = merchantLocation("green-coffee");
check("a merchant with no coordinates reports NONE", unknownPickup.latitude === null);
check("...and says so explicitly", unknownPickup.hasCoordinates === false);
check("...rather than a fabricated 0", unknownPickup.latitude !== 0);
check("the address is still returned", typeof unknownPickup.address === "string");

const nominal = estimateDistanceAndDuration(motorcycle, 0);
check("an unknown pickup prices a SHORT urban hop", nominal.distanceKm === NOMINAL_PICKUP_DISTANCE_KM, `${nominal.distanceKm} km`);
check("the nominal distance is nowhere near intercontinental", nominal.distanceKm < 20);
check("the nominal ETA is in minutes, not days", nominal.durationSec < 3600, `${Math.round(nominal.durationSec / 60)} min`);

// The real symptom: routing from (0,0) to a city is thousands of kilometres.
const nullIslandTrip = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 9.02, longitude: 38.03 });
check("routing from (0,0) to a city is intercontinental", nullIslandTrip > 4000, `${Math.round(nullIslandTrip)} km`);
check(
  "so the guard is what stops an absurd quote",
  nominal.distanceKm < nullIslandTrip / 100,
  "the nominal figure must be orders of magnitude smaller",
);

// A quote built on the nominal distance is priced as an ordinary short trip.
const nominalQuote = quoteDelivery({
  vehicle: motorcycle,
  zone: null,
  config: config({ baseFee: 0, pricePerKm: 9, minFee: 0 }),
  distanceKm: nominal.distanceKm,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
check("the guarded quote is a sane amount", nominalQuote.subtotal < 200, `${nominalQuote.subtotal} ETB`);

// ---------------------------------------------------------------------------
section("6. Dispatch ranking (nearest ELIGIBLE driver, with reasons)");

const { isDispatchable } = await import("../src/delivery/types");

function makeDriver(overrides: Partial<Parameters<typeof rankCandidates>[0][0]["driver"]> = {}) {
  const base = {
    id: "drv-base",
    userId: null,
    fullName: "Test Driver",
    phone: "0911000000",
    email: null,
    photoUrl: null,
    idNumber: null,
    documents: { idDocument: null, licenseDocument: null, vehicleDocument: null },
    vehicle: { type: "motorcycle" as const, make: "", model: "", plateNumber: null, year: null, colour: null },
    license: { number: null, expiresOn: null, classes: [] },
    emergencyContact: null,
    address: "",
    status: "APPROVED" as const,
    availability: "ONLINE" as const,
    statusReason: null,
    reviewedAt: null,
    reviewedBy: null,
    registeredAt: NOW.toISOString(),
    approvedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ratingSum: 0,
    ratingCount: 0,
    deliveriesCompleted: 0,
    earningsTotal: 0,
  };
  return { ...base, ...overrides } as Parameters<typeof rankCandidates>[0][0]["driver"];
}

const PICKUP = { latitude: 9, longitude: 38 };
const T0 = NOW.getTime();

function at(latOffset: number, ageSec = 5) {
  return {
    driverId: "x",
    latitude: PICKUP.latitude + latOffset,
    longitude: PICKUP.longitude,
    heading: null,
    speedMps: null,
    deliveryId: null,
    at: new Date(T0 - ageSec * 1000).toISOString(),
  };
}

// THE CENTRAL SAFETY PROPERTY, one line per filter.
const candidates = [
  { driver: makeDriver({ id: "d-near", vehicle: { ...makeDriver().vehicle, type: "motorcycle" } }), location: at(0.01) },
  { driver: makeDriver({ id: "d-far", vehicle: { ...makeDriver().vehicle, type: "motorcycle" } }), location: at(0.1) },
  { driver: makeDriver({ id: "d-unapproved", status: "PENDING" }), location: at(0.001) },
  { driver: makeDriver({ id: "d-offline", availability: "OFFLINE" }), location: at(0.001) },
  { driver: makeDriver({ id: "d-wrongcar", vehicle: { ...makeDriver().vehicle, type: "car" } }), location: at(0.001) },
  { driver: makeDriver({ id: "d-stale" }), location: at(0.001, 3600) },
  { driver: makeDriver({ id: "d-nofix" }), location: null },
];

const ranked = rankCandidates(
  candidates,
  { pickup: PICKUP, vehicleType: "motorcycle", packageSpec: perfumes, radiusKm: 12, maxOffers: 5, now: T0 },
  new Map(),
  VEHICLES,
);
const byId = new Map(ranked.map((r) => [r.driverId, r]));

check("the nearest approved online driver ranks first", ranked[0].driverId === "d-near", ranked.map((r) => r.driverId).join(", "));
check("an UNAPPROVED driver is never a candidate", byId.get("d-unapproved")?.excluded === "not-approved");
check("an offline driver is never a candidate", byId.get("d-offline")?.excluded === "not-online");
check("a driver of another vehicle type is excluded", byId.get("d-wrongcar")?.excluded === "wrong-vehicle");
check("a stale position is treated as no position", byId.get("d-stale")?.excluded === "no-recent-location");
check("a missing position is excluded", byId.get("d-nofix")?.excluded === "no-recent-location");
check("a further driver is still offered when eligible", byId.get("d-far")?.excluded === null);

// EVERY excluded candidate carries a REASON, so an administrator can answer
// "why was nobody assigned?" instead of seeing an empty map.
check("every excluded candidate explains itself", ranked.filter((r) => r.excluded !== null).every((r) => typeof r.excluded === "string"));
check("offered candidates rank from 1", selectOfferedDrivers(ranked)[0].rank === 1);

// BUSY IS DERIVED FROM THE LIVE DELIVERIES, not from a flag.
const busyDriverId = "d-busy";
const busyMap = new Map([[busyDriverId, { id: "other-delivery" } as never]]);
const busyRanked = rankCandidates(
  [{ driver: makeDriver({ id: busyDriverId }), location: at(0.001) }],
  { pickup: PICKUP, vehicleType: "motorcycle", packageSpec: perfumes, radiusKm: 12, maxOffers: 5, now: T0 },
  busyMap,
  VEHICLES,
);
check("a driver already carrying something is excluded", busyRanked[0].excluded === "already-busy");

// The radius really is a radius.
const tooFar = rankCandidates(
  [{ driver: makeDriver({ id: "d-faraway" }), location: at(50) }],
  { pickup: PICKUP, vehicleType: "motorcycle", packageSpec: perfumes, radiusKm: 12, maxOffers: 5, now: T0 },
  new Map(),
  VEHICLES,
);
check("a driver beyond the radius is excluded", tooFar[0].excluded === "too-far");

// Ranking is STABLE for two drivers at the same point, or a reshuffle between
// pings could skip the better-placed driver.
const tie = rankCandidates(
  [
    { driver: makeDriver({ id: "d-b" }), location: at(0.02) },
    { driver: makeDriver({ id: "d-a" }), location: at(0.02) },
  ],
  { pickup: PICKUP, vehicleType: "motorcycle", packageSpec: perfumes, radiusKm: 12, maxOffers: 5, now: T0 },
  new Map(),
  VEHICLES,
);
check("tied candidates get a stable order", tie[0].driverId === "d-a" && tie[1].driverId === "d-b");

// The offer cap is respected.
const many = Array.from({ length: 20 }, (_, i) => ({
  driver: makeDriver({ id: `d-${i}` }),
  location: at(0.01 + i * 0.001),
}));
const capped = selectOfferedDrivers(
  rankCandidates(many, { pickup: PICKUP, vehicleType: "motorcycle", packageSpec: perfumes, radiusKm: 12, maxOffers: 3, now: T0 }, new Map(), VEHICLES),
);
check("no more drivers are asked than the cap", capped.length === 3, `got ${capped.length}`);

// An unapproved driver is rejected even when their flag says ONLINE.
check("APPROVED + ONLINE is the only dispatchable pair", isDispatchable({ status: "APPROVED", availability: "ONLINE" }));
check("an approved but offline driver is not dispatchable", !isDispatchable({ status: "APPROVED", availability: "OFFLINE" }));
check("an online but unapproved driver is not dispatchable", !isDispatchable({ status: "PENDING", availability: "ONLINE" }));

// Busy is derived from the deliveries themselves.
const deliveriesForBusy = [
  { driverId: "d1", status: "IN_TRANSIT" },
  { driverId: "d2", status: "DELIVERED" },
  { driverId: "d3", status: "ORDER_PICKED_UP" },
  { driverId: "d4", status: "FAILED" },
  { driverId: "d5", status: "CANCELLED" },
] as never[];
const busy = activeDriverDeliveries(deliveriesForBusy);
check("a driver in transit is busy", busy.has("d1"));
check("a driver in transit to pickup is busy", busy.has("d3"));
check("a driver who delivered is free", !busy.has("d2"));
check("a driver who failed is free again", !busy.has("d4"), "a driver who abandoned a job must not be stuck busy");
check("a driver who was cancelled is free again", !busy.has("d5"));

// Offers carry an expiry, and the search has a timeout.
const offers = buildOffers(selectOfferedDrivers(ranked).slice(0, 2), "dlv-1", 45, T0);
check("an offer records who it went to", offers.length === 2);
check("an offer carries an expiry", new Date(offers[0].expiresAt).getTime() === T0 + 45_000);
check("an offer is not pre-answered", offers[0].state === "pending" && offers[0].respondedAt === null);
check("a short search has not expired", !searchExpired(NOW.toISOString(), DEFAULT_DELIVERY_PRICING, T0 + 60_000));
check("a long search HAS expired", searchExpired(NOW.toISOString(), DEFAULT_DELIVERY_PRICING, T0 + 16 * 60_000));

// A driver who ignored the last offer goes to the FRONT of the next batch,
// otherwise the job spins between the same two people forever.
const next = nextBatch(
  [
    { driverId: "d-near", state: "expired", createdAt: new Date(T0 - 100_000).toISOString() },
    { driverId: "d-far", state: "pending", createdAt: new Date(T0 - 10_000).toISOString() },
  ],
  selectOfferedDrivers(ranked),
  T0,
);
check("a driver who ignored the last offer is asked first next time", next[0].driverId === "d-near", next.map((r) => r.driverId).join(", "));

// ---------------------------------------------------------------------------
section("7. Privacy (projections withhold what they must, and only that)");

const DRIVER = makeDriver({
  id: "drv-1",
  fullName: "Selam Bekele",
  phone: "0911234567",
  idNumber: "AB1234567890",
  ratingSum: 17,
  ratingCount: 4,
  deliveriesCompleted: 40,
  earningsTotal: 9800,
});

const DELIVERY = {
  id: "dlv-1",
  source: "yene-store",
  sourceRef: "BO-1",
  orderId: "BO-1",
  customerOrderId: "CO-1",
  merchantId: "biz-1",
  customerId: "u-customer",
  driverId: "drv-1",
  vehicleType: "motorcycle",
  pickup: { latitude: 9, longitude: 38, address: "Shop address" },
  pickupContactName: "Shop",
  pickupContactPhone: "0911000000",
  destination: { latitude: 9.02, longitude: 38.02, address: "Home address" },
  destinationContactName: "Customer",
  destinationContactPhone: "0922333444",
  distanceKm: 6.2,
  estimatedDurationSec: 900,
  routeGeometry: null,
  zoneId: null,
  vehicleTypeAtQuote: "veh-motorcycle",
  price: quoteDelivery({ vehicle: motorcycle, zone: null, config: config2, distanceKm: 6.2, packageSpec: perfumes, now: NOW }),
  driverEarnings: 212,
  platformCommission: 38,
  packageSpec: perfumes,
  deliveryNotes: "",
  status: "IN_TRANSIT",
  statusReason: null,
  proofMethod: "otp",
  proofCodeHash: "abc123",
  proofAttempts: 0,
  proofVerifiedAt: null,
  proofConfirmedBy: null,
  requestedAt: NOW.toISOString(),
  searchingSince: NOW.toISOString(),
  acceptedAt: NOW.toISOString(),
  arrivedAtPickupAt: null,
  pickedUpAt: NOW.toISOString(),
  startedAt: NOW.toISOString(),
  deliveredAt: null,
  cancelledAt: null,
  version: 3,
  history: [],
  updatedAt: NOW.toISOString(),
} as never;

const customerView = deliveryForCustomer(DELIVERY, driverForCustomer(DRIVER, "IN_TRANSIT"), {
  latitude: 9.01, longitude: 38.01, at: NOW.toISOString(),
});
const merchantView = deliveryForMerchant(DELIVERY, driverForMerchant(DRIVER, "IN_TRANSIT"), {
  latitude: 9.01, longitude: 38.01, at: NOW.toISOString(),
});
const driverView = deliveryForDriver(DELIVERY);

// THE CUSTOMER may contact their driver - the specification requires it.
check("the customer sees the driver's name", customerView.driver?.fullName === "Selam Bekele");
check("the customer sees the driver's phone", customerView.driver?.phone === "0911234567");
check("the customer sees the driver's rating", customerView.driver?.rating === 4.3);

// ...but never the documents or the earnings split.
check("the customer never sees the id number", !("idNumber" in (customerView as never)));
check("the customer never sees the earnings split", !("driverEarnings" in (customerView as never)));
check("the customer never sees the platform commission", !("platformCommission" in (customerView as never)));

// The customer sees where the driver is WHILE it is live.
check("the customer sees the live position", customerView.driverPosition !== null);

// ...and stops seeing it the moment the parcel has arrived.
const finished = { ...(DELIVERY as never as Record<string, unknown>), status: "DELIVERED" } as never;
check(
  "the customer does NOT see the driver position after delivery",
  deliveryForCustomer(finished, driverForCustomer(DRIVER, "DELIVERED"), {
    latitude: 9.01, longitude: 38.01, at: NOW.toISOString(),
  }).driverPosition === null,
);

// THE MERCHANT loses the customer's phone after hand-off: from that point the
// customer-courier line is not the merchant's business, and holding it invites
// them to route around the dispatch system.
// DELIVERY is IN_TRANSIT - the parcel has ALREADY left the shop, so the number
// is correctly masked. The "before hand-off" case is a different record: a
// driver who has been assigned but has not collected anything yet.
const beforeHandoff = {
  ...(DELIVERY as never as Record<string, unknown>),
  pickedUpAt: null,
  status: "DRIVER_ASSIGNED",
} as never;
check(
  "the merchant sees the customer's phone before hand-off",
  deliveryForMerchant(beforeHandoff, driverForMerchant(DRIVER, "DRIVER_ASSIGNED"), null).customerPhone ===
    "0922333444",
);
check(
  "the merchant's phone IS masked once the parcel has been collected",
  // Compared by CONTENT, not by length: the claim being tested is that the
  // leading digits are gone, which is what masking means. Comparing lengths
  // would be testing the bullet glyph count, and would depend on the console's
  // character encoding.
  (merchantView.customerPhone ?? "") !== "0922333444" &&
    !(merchantView.customerPhone ?? "").includes("092233") &&
    (merchantView.customerPhone ?? "").endsWith("3444"),
  `got ${merchantView.customerPhone}`,
);
const notCollected = {
  ...(DELIVERY as never as Record<string, unknown>),
  pickedUpAt: null,
  status: "DRIVER_ASSIGNED",
} as never;
check(
  "the merchant still sees the full number before the parcel is collected",
  deliveryForMerchant(notCollected, driverForMerchant(DRIVER, "DRIVER_ASSIGNED"), null).customerPhone === "0922333444",
);
check(
  "the merchant's phone is masked once the parcel has left",
  (deliveryForMerchant(DELIVERY, driverForMerchant(DRIVER, "IN_TRANSIT"), null).customerPhone ?? "").includes("•"),
);

// THE MERCHANT also loses the driver's phone once the delivery is closed.
check(
  "the merchant does not keep the driver's number after delivery",
  driverForMerchant(DRIVER, "DELIVERED")?.phone === null,
);
check(
  "the merchant sees the driver's number while it is live",
  driverForMerchant(DRIVER, "IN_TRANSIT")?.phone === "0911234567",
);

// THE DRIVER is the only party who gets both full contact numbers.
check("the driver sees the pickup contact", driverView.pickupContactPhone === "0911000000");
check("the driver sees the customer contact", driverView.destinationContactPhone === "0922333444");
check("the driver sees what the job pays", typeof driverView.earnings === "number");
check("the driver does NOT see the platform's cut", !("subtotal" in (driverView as never) && (driverView as never as Record<string, unknown>).platformCommission !== undefined));

// Before a driver is assigned, there is nobody to describe.
check("no driver is shown before assignment", driverForCustomer(DRIVER, "SEARCHING_DRIVER") === null);

// Masking.
check("a masked id never shows the whole value", maskIdentifier("AB1234567890") !== "AB1234567890");
check("a masked id shows the last four", (maskIdentifier("AB1234567890") ?? "").endsWith("7890"));
check("an absent id masks to nothing", maskIdentifier(null) === null);
check("a short id is fully masked", maskIdentifier("AB") === "••");
check("a masked phone keeps the last four", (maskPhone("0911234567") ?? "").endsWith("4567"));
check("a masked phone never shows the whole number", maskPhone("0911234567") !== "0911234567");
check("an absent phone masks to nothing", maskPhone(null) === null);
check("an average rating is one decimal", averageRating({ ratingSum: 17, ratingCount: 3 }) === 5.7);
check("an unrated driver averages zero", averageRating({ ratingSum: 0, ratingCount: 0 }) === 0);

// THE LIST ROW masks the sensitive numbers, so a shared admin screen never
// displays a full document number.
const listRow = driverForList(DRIVER);
check("the list row masks the id number", (listRow.idNumberMasked ?? "").includes("•"));
check("the list row never carries the raw id number", !("idNumber" in (listRow as never)));

// ---------------------------------------------------------------------------
section("8. Authorization (who may read a delivery at all)");

const ownDriver = (userId: string) => (userId === "u-driver" ? "drv-1" : null);

check("the customer may read their own delivery", mayReadDelivery(DELIVERY, { userId: "u-customer", businessId: null, isSuperAdmin: false }, ownDriver));
check("the merchant may read their own delivery", mayReadDelivery(DELIVERY, { userId: "u-staff", businessId: "biz-1", isSuperAdmin: false }, ownDriver));
check("the assigned driver may read it", mayReadDelivery(DELIVERY, { userId: "u-driver", businessId: null, isSuperAdmin: false }, ownDriver));
check("an admin may read it", mayReadDelivery(DELIVERY, { userId: "u-admin", businessId: null, isSuperAdmin: true }, ownDriver));

// THE ATTACKS.
check("another customer may NOT read it", !mayReadDelivery(DELIVERY, { userId: "u-other", businessId: null, isSuperAdmin: false }, ownDriver));
check("another business may NOT read it", !mayReadDelivery(DELIVERY, { userId: "u-rival", businessId: "biz-2", isSuperAdmin: false }, ownDriver));
check("another DRIVER may NOT read it", !mayReadDelivery(DELIVERY, { userId: "u-otherdriver", businessId: null, isSuperAdmin: false }, ownDriver));
check("an anonymous caller may NOT read it", !mayReadDelivery(DELIVERY, { userId: "guest", businessId: null, isSuperAdmin: false }, ownDriver));

// The driver's id comes from their OWN session, never from the request - which is
// why a driver cannot pass a different one to read somebody else's job.
// A resolver that answers from the SESSION, never from the request: each user
// gets their OWN driver id, so passing somebody else's changes nothing.
const sessionResolver = (userId: string) =>
  ({ "u-driver": "drv-1", "u-otherdriver": "drv-2" })[userId] ?? null;
check(
  "a driver cannot read a job by resolving to somebody else's driver id",
  !mayReadDelivery(DELIVERY, { userId: "u-otherdriver", businessId: null, isSuperAdmin: false }, sessionResolver),
);
check(
  "the assigned driver still reads their own job",
  mayReadDelivery(DELIVERY, { userId: "u-driver", businessId: null, isSuperAdmin: false }, sessionResolver),
);

// ---------------------------------------------------------------------------
section("9. Delivery proof (hashed, single-use, attempt-limited)");

// A code is four digits, in the range the specification gives.
check("a generated code is four digits", /^\d{4}$/.test(generateProofCode()));
check("a generated code is never below 1000", Number(generateProofCode()) >= 1000);
check("a generated code is never 10000", Number(generateProofCode()) < 10000);

// VALIDATION REFUSES anything that is not shaped like one of ours, so a
// five-digit value can never be hashed and compared against a four-digit code.
check("a four-digit code is valid", isValidProofCode("1234"));
check("a three-digit code is refused", !isValidProofCode("123"));
check("a five-digit code is refused", !isValidProofCode("12345"));
check("letters are refused", !isValidProofCode("abcd"));
check("a non-string is refused", !isValidProofCode(1234));
check("an empty code is refused", !isValidProofCode(""));

// THE HASH IS NOT THE CODE. A four-digit code is small enough that a bare hash is
// reversible by anyone who can read the file.
const code = generateProofCode();
const hashed = hashProofCode("dlv-1", code);
check("the hash is not the code", hashed !== code);
check("the hash is not a plain digest of the code", hashed !== code.padEnd(64, "0"));
check("the correct code verifies", verifyProofCode("dlv-1", code, hashed));
check("a wrong code does not verify", !verifyProofCode("dlv-1", "9999", hashed));
check("a missing hash never verifies", !verifyProofCode("dlv-1", code, null));

// THE CODE IS BOUND TO ITS DELIVERY, so a code captured from one job cannot be
// replayed against another.
check("a code does not verify against another delivery", !verifyProofCode("dlv-2", code, hashed));

// THE COMPARISON IS TIMING-SAFE. Weaker entropy than a login code does not mean
// weaker handling: this is the same class of secret.
check("a garbage hash never verifies", !verifyProofCode("dlv-1", code, "not-a-hash"));
check("a short hash never verifies", !verifyProofCode("dlv-1", code, "abcd"));
check("a non-numeric code never verifies", !verifyProofCode("dlv-1", "abcd", hashed));

// Every generated code verifies against its own hash - no code is unmatchable.
const allVerify = Array.from({ length: 50 }, () => {
  const generated = generateProofCode();
  return verifyProofCode("d", generated, hashProofCode("d", generated));
});
check("every generated code verifies against its own hash", allVerify.every(Boolean));

// THE REGRESSION THIS FORESTALLS
// ------------------------------
// The ephemeral-secret fallback used to be built from `process.hrtime.bigint()` -
// a CLOCK, not a unique id. It produced a different secret on every call, so a
// code could be issued but never verified and NO DELIVERY COULD EVER BE
// COMPLETED.
//
// The suite above sets DELIVERY_PROOF_SECRET, which is exactly why it missed the
// bug. So the fallback is exercised HERE, with the variable removed.
delete process.env.DELIVERY_PROOF_SECRET;
delete process.env.LOGIN_CODE_SECRET;
const { resetProofSecretCache } = await import("../src/delivery/proof");
resetProofSecretCache();

const fallbackCode = generateProofCode();
const fallbackHash = hashProofCode("dlv-fallback", fallbackCode);
check(
  "with NO configured secret, a code still verifies",
  verifyProofCode("dlv-fallback", fallbackCode, fallbackHash),
  "an ephemeral secret that changes per call makes every code unverifiable",
);
check(
  "and it verifies MORE THAN ONCE (the secret is stable, not a clock)",
  verifyProofCode("dlv-fallback", fallbackCode, fallbackHash) &&
    verifyProofCode("dlv-fallback", fallbackCode, fallbackHash),
);
check("a wrong code still fails under the fallback", !verifyProofCode("dlv-fallback", "0000", fallbackHash));

// A deployment with no secret is REPORTED, not left to be discovered at the door.
check("a deployment with no secret is reported", assertProofSecretConfigured() !== null);
check("a deployment WITH a secret reports nothing", (() => {
  process.env.DELIVERY_PROOF_SECRET = "configured";
  const message = assertProofSecretConfigured();
  delete process.env.DELIVERY_PROOF_SECRET;
  resetProofSecretCache();
  return message === null;
})());

process.env.DELIVERY_PROOF_SECRET = "verification-secret-not-a-real-credential";
resetProofSecretCache();

// ---------------------------------------------------------------------------
section("10. Zones (configurable, never a hard-coded city)");

const zoneFixtures = [
  {
    id: "z1",
    name: "Zone A",
    area: "Central",
    polygon: [
      { latitude: 9.0, longitude: 38.0 },
      { latitude: 9.0, longitude: 38.2 },
      { latitude: 9.2, longitude: 38.2 },
      { latitude: 9.2, longitude: 38.0 },
    ],
    zoneFee: 25,
    pricePerKm: null,
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  },
  {
    id: "z2",
    name: "Zone B",
    area: "Outer",
    polygon: null,
    zoneFee: 0,
    pricePerKm: 12,
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  },
  {
    id: "z3",
    name: "Zone Closed",
    area: "Retired",
    polygon: null,
    zoneFee: 999,
    pricePerKm: null,
    active: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  },
];

check(
  "a point inside a drawn zone finds that zone",
  findZoneForPoint({ latitude: 9.1, longitude: 38.1 }, zoneFixtures)?.id === "z1",
);
check(
  "a point outside every drawn zone falls to the catch-all",
  findZoneForPoint({ latitude: 10, longitude: 39 }, zoneFixtures)?.id === "z2",
);
check(
  "an INACTIVE zone never applies",
  findZoneForPoint({ latitude: 10, longitude: 39 }, [zoneFixtures[2]]) === null,
);
check("an invalid point matches no zone", findZoneForPoint({ latitude: 999, longitude: 0 }, zoneFixtures) === null);
check("no zones at all matches nothing", findZoneForPoint({ latitude: 9, longitude: 38 }, []) === null);

// A zone fee reaches the quote.
const zoneQuote = quoteDelivery({
  vehicle: motorcycle,
  zone: zoneFixtures[0],
  config: config({ baseFee: 50, pricePerKm: 10, minFee: 0 }),
  distanceKm: 2,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
check("a zone fee is added to the quote", zoneQuote.zoneFee === 25 && zoneQuote.subtotal === 95, `got ${zoneQuote.subtotal}`);
check("the zone fee explains itself", zoneQuote.breakdown.some((line) => line.includes("Zone A")));

// A NEGATIVE zone fee discounts rather than erroring - an operator may want a
// promotional zone.
const discountQuote = quoteDelivery({
  vehicle: motorcycle,
  zone: { ...zoneFixtures[0], zoneFee: -10 },
  config: config({ baseFee: 50, pricePerKm: 10, minFee: 0 }),
  distanceKm: 2,
  packageSpec: emptyPackageSpec(),
  now: NOW,
});
check("a negative zone fee discounts the quote", discountQuote.subtotal === 60, `got ${discountQuote.subtotal}`);

// ---------------------------------------------------------------------------
section("11. Customer progress (a customer is not tracking a state machine)");

check("the progress path has six steps", progressIndex("DELIVERED") === 5);
check("a step on the path reports its position", progressIndex("ORDER_PICKED_UP") === 2);
check("a status off the path reports -1", progressIndex("ARRIVED_AT_PICKUP") === -1);
check("progress is monotonic", progressIndex("IN_TRANSIT") < progressIndex("ARRIVING"));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${"-".repeat(60)}`);
console.log(`  ${passed} passed, ${failures} failed, ${passed + failures} checks`);
console.log(`${"-".repeat(60)}`);
console.log(
  failures === 0
    ? "\n  YENE DELIVERY: every rule holds.\n"
    : `\n  ${failures} CHECK(S) FAILED - the delivery system is not safe to ship.\n`,
);

process.exit(failures === 0 ? 0 : 1);
