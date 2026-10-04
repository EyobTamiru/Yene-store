/**
 * ============================================================================
 *  VEHICLES AND PACKAGES
 * ============================================================================
 *
 *  The five vehicle classes, and how a parcel is measured so the right class can
 *  be chosen for it.
 *
 *  WHY THESE NUMBERS ARE SEED VALUES, NOT PRICES
 *  ---------------------------------------------
 *  The capacities below are PHYSICAL properties of the vehicle classes and are
 *  safe to ship. The FEES are not - see `DEFAULT_VEHICLE_PRICING`, which is
 *  seeded once into the store and thereafter owned entirely by the admin screen.
 *  Keeping the two apart means an operator repricing vans cannot accidentally
 *  shrink a bicycle's parcel capacity.
 *
 *  A TRUCK IS NOT THE DEFAULT
 *  --------------------------
 *  `compatibleVehicles` returns everything that fits, cheapest first, so the
 *  truck is offered for a heavy pallet and never for a perfume bottle. That is
 *  the requirement that vehicle compatibility be configurable rather than
 *  "pick the biggest".
 */

import type { PackageSpec, VehicleSpec, VehicleType } from "./types";
import { VEHICLE_TYPES } from "./types";

// ---------------------------------------------------------------------------
// Physical capacity + speed. Safe to ship.
// ---------------------------------------------------------------------------

interface VehicleSeed {
  name: string;
  icon: string;
  description: string;
  maxWeightKg: number;
  maxPackageSizeCm: number;
  maxItems: number;
  carriesFragile: boolean;
  averageSpeedKph: number;
}

export const VEHICLE_SEEDS: Record<VehicleType, VehicleSeed> = {
  bicycle: {
    name: "Bicycle",
    icon: "🚲",
    description: "Small, light parcels within the city centre. No motorised fuel cost.",
    maxWeightKg: 15,
    maxPackageSizeCm: 50,
    maxItems: 8,
    carriesFragile: false,
    averageSpeedKph: 15,
  },
  motorcycle: {
    name: "Motorcycle",
    icon: "🏍️",
    description: "Fast and flexible. The usual choice for small parcels in traffic.",
    maxWeightKg: 30,
    maxPackageSizeCm: 70,
    maxItems: 15,
    carriesFragile: true,
    averageSpeedKph: 30,
  },
  car: {
    name: "Car",
    icon: "🚗",
    description: "More room for bigger or heavier items, with weather protection.",
    maxWeightKg: 250,
    maxPackageSizeCm: 120,
    maxItems: 40,
    carriesFragile: true,
    averageSpeedKph: 35,
  },
  van: {
    name: "Van",
    icon: "🚐",
    description: "Bulk loads, furniture, and multi-order runs.",
    maxWeightKg: 1200,
    maxPackageSizeCm: 250,
    maxItems: 120,
    carriesFragile: true,
    averageSpeedKph: 32,
  },
  truck: {
    name: "Truck",
    icon: "🚚",
    description: "Pallets, construction materials and wholesale consignments.",
    maxWeightKg: 8000,
    maxPackageSizeCm: 400,
    maxItems: 400,
    carriesFragile: false,
    averageSpeedKph: 28,
  },
};

/**
 * The seeded FEE structure.
 *
 * Deliberately generic starting points with a rising ladder. They are written
 * ONCE into the store and are thereafter editable per vehicle in the admin
 * screen; nothing in the pricing engine reads this table.
 */
export const DEFAULT_VEHICLE_PRICING: Record<
  VehicleType,
  { baseFee: number; pricePerKm: number; minFee: number; maxFee: number | null }
> = {
  bicycle: { baseFee: 30, pricePerKm: 6, minFee: 30, maxFee: null },
  motorcycle: { baseFee: 45, pricePerKm: 9, minFee: 45, maxFee: null },
  car: { baseFee: 80, pricePerKm: 16, minFee: 80, maxFee: null },
  van: { baseFee: 130, pricePerKm: 24, minFee: 130, maxFee: null },
  truck: { baseFee: 220, pricePerKm: 34, minFee: 220, maxFee: null },
};
// ---------------------------------------------------------------------------
// Package derivation
// ---------------------------------------------------------------------------

/**
 * What a product contributes to a parcel's size and mass.
 *
 * The platform's `Product` has no weight or dimensions - they are merchant data
 * that does not exist yet. So this is an OPTIONAL extension: a merchant who has
 * filled it in gets accurate vehicle matching, and one who has not gets the
 * documented defaults below.
 *
 * THE DEFAULTS ARE STATED, NOT HIDDEN
 * ------------------------------------
 * A parcel is assumed to be 0.5 kg in a 30x20x15 cm box. That is small enough
 * that a bicycle is still offered for an unmeasured product - so an unmeasured
 * catalogue never blocks a delivery - and it is visible in the code and on the
 * driver's screen rather than being a silent "1 kg, medium box".
 */
export const DEFAULT_ITEM_WEIGHT_KG = 0.5;
export const DEFAULT_ITEM_SIZE_CM = { longest: 30, girth: 35 };

/** One order line's physical contribution. */
export interface MeasurableLine {
  name: string;
  quantity: number;
  weightKg?: number | null;
  longestSideCm?: number | null;
  girthCm?: number | null;
  fragile?: boolean | null;
}

/** What a merchant may add on top of the derived values. */
export interface PackageOverrides {
  weightKg?: number | null;
  longestSideCm?: number | null;
  girthCm?: number | null;
  fragile?: boolean | null;
  handlingNotes?: string[];
  summary?: string;
}

/**
 * Derive a `PackageSpec` from order lines.
 *
 * This is what removes "make merchants re-enter information already available
 * in the order": the weight, the item count and the fragility all come from the
 * lines, and the merchant's form can only ever RAISE or clarify them.
 */
export function packageFromLines(
  lines: MeasurableLine[],
  overrides: PackageOverrides = {},
): PackageSpec {
  let weightKg = 0;
  let itemCount = 0;
  let longestSideCm = 0;
  let girthCm = 0;
  let fragile = false;

  for (const line of lines) {
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (quantity === 0) continue;
    itemCount += quantity;
    weightKg += (Number(line.weightKg) || DEFAULT_ITEM_WEIGHT_KG) * quantity;
    // Dimensions take the LARGEST item, not the sum: a parcel is one box, and
    // adding the sides of every product would make a 12-bottle order look like
    // furniture.
    longestSideCm = Math.max(longestSideCm, Number(line.longestSideCm) || DEFAULT_ITEM_SIZE_CM.longest);
    girthCm = Math.max(girthCm, Number(line.girthCm) || DEFAULT_ITEM_SIZE_CM.girth);
    if (line.fragile) fragile = true;
  }

  // An override is authoritative when present, so a merchant measuring a
  // pallet does not have to fight the derived per-item figures.
  const finalWeight = overrides.weightKg != null ? Math.max(0, overrides.weightKg) : round1(weightKg);
  const finalLongest = overrides.longestSideCm != null ? Math.max(0, overrides.longestSideCm) : longestSideCm;
  const finalGirth = overrides.girthCm != null ? Math.max(0, overrides.girthCm) : girthCm;
  const finalFragile = overrides.fragile === true || fragile;

  const notes = (overrides.handlingNotes ?? []).map((note) => note.trim()).filter(Boolean).slice(0, 10);

  return {
    weightKg: finalWeight,
    itemCount,
    longestSideCm: finalLongest,
    girthCm: finalGirth,
    fragile: finalFragile,
    handlingNotes: notes,
    summary: overrides.summary?.trim() || describePackage(lines, itemCount, finalWeight, finalFragile),
  };
}

/** One decimal place, so 0.30000000000000004 never reaches a driver screen. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "10 x perfume, 2.5 kg, fragile" - what a driver actually reads. */
function describePackage(
  lines: MeasurableLine[],
  itemCount: number,
  weightKg: number,
  fragile: boolean,
): string {
  if (lines.length === 0) return "No items";
  const parts = lines.slice(0, 3).map((line) => `${line.quantity} x ${truncate(line.name, 28)}`);
  if (lines.length > 3) parts.push(`+${lines.length - 3} more`);
  const summary = `${itemCount} item${itemCount === 1 ? "" : "s"} (${parts.join(", ")}), ${weightKg} kg`;
  return fragile ? `${summary}, fragile` : summary;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** A safe empty package, for a delivery with no order lines behind it. */
export function emptyPackageSpec(): PackageSpec {
  return {
    weightKg: DEFAULT_ITEM_WEIGHT_KG,
    itemCount: 1,
    longestSideCm: DEFAULT_ITEM_SIZE_CM.longest,
    girthCm: DEFAULT_ITEM_SIZE_CM.girth,
    fragile: false,
    handlingNotes: [],
    summary: "1 parcel",
  };
}

/** Build the initial vehicle rows. Idempotent per deployment, not per import. */
export function seedVehicles(now: string): VehicleSpec[] {
  return VEHICLE_TYPES.map((type) => {
    const seed = VEHICLE_SEEDS[type];
    const pricing = DEFAULT_VEHICLE_PRICING[type];
    return {
      id: `veh-${type}`,
      type,
      name: seed.name,
      icon: seed.icon,
      description: seed.description,
      active: true,
      maxWeightKg: seed.maxWeightKg,
      maxPackageSizeCm: seed.maxPackageSizeCm,
      maxItems: seed.maxItems,
      carriesFragile: seed.carriesFragile,
      baseFee: pricing.baseFee,
      pricePerKm: pricing.pricePerKm,
      minFee: pricing.minFee,
      maxFee: pricing.maxFee,
      peakMultiplier: 1,
      averageSpeedKph: seed.averageSpeedKph,
      createdAt: now,
      updatedAt: now,
    };
  });
}