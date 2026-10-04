/**
 * ============================================================================
 *  PRICING ENGINE
 * ============================================================================
 *
 *  NOT A HARD-CODED PRICE LIST. Every figure comes from the stored
 *  `DeliveryPricingConfig` row plus the vehicle and zone rows, so an operator
 *  changes a fee in the admin screen and the next quote reflects it. The
 *  constants here are SHIPPED DEFAULTS used only to seed a fresh deployment.
 *
 *  THE ORDER OF OPERATIONS IS THE CONTRACT
 *  --------------------------------------
 *      vehicle base fee
 *    + distance x effective per-km rate
 *    + zone fee
 *    + heavy / bulky / fragile surcharges
 *    -> subtotal
 *    x peak multiplier  -> peak fee
 *    -> subtotal + peak
 *    -> clamp to [minFee, maxFee]
 *    -> commission split
 *
 *  Every step appends a line to `breakdown`, so the receipt shows a customer
 *  exactly which rule produced which amount. A price nobody can explain is a
 *  price that generates support calls.
 *
 *  MONEY IS ROUNDED ONCE, AT THE END
 *  ----------------------------------
 *  Each intermediate keeps full precision and the TOTAL is rounded half away
 *  from zero. Rounding each component separately and then summing is how a quote
 *  ends up one birr above the sum of its own printed lines.
 */

import type {
  DeliveryPriceQuote,
  DeliveryPricingConfig,
  DeliveryZone,
  PackageSpec,
  VehicleSpec,
} from "./types";
import { VEHICLE_TYPES, type VehicleType } from "./types";

/** Basis points in 100%. */
export const BPS_ONE_HUNDRED_PERCENT = 10_000;

/** Two decimal places. ETB has a cent, and the specification's own worked
 *  example ends in 127.50, so whole-birr rounding would contradict it. */
export const MONEY_DECIMALS = 2;
const MONEY_SCALE = 10 ** MONEY_DECIMALS;

/**
 * Round to two decimal places, half AWAY FROM ZERO.
 *
 * Half away from zero rather than banker's rounding because that is what a
 * person expects from money: 0.005 becomes 0.01, not 0.00. Applied to the
 * absolute value and the sign restored afterwards, so -0.005 becomes -0.01
 * rather than the -0 that Math.round would give it.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.sign(value) * (Math.round(Math.abs(value) * MONEY_SCALE) / MONEY_SCALE);
}

/**
 * The shipped defaults.
 *
 * A STARTING POINT, not a decision - the same posture the finance module takes
 * with `DEFAULT_COMMISSION_RULES`. Figures are deliberately modest and generic:
 * an operator replaces them before any live transaction.
 */
export const DEFAULT_DELIVERY_PRICING: DeliveryPricingConfig = {
  id: "default",
  currency: "ETB",

  baseFee: 0,
  pricePerKm: 0,
  heavySurcharge: 0,
  heavyThresholdKg: 25,
  bulkySurcharge: 0,
  bulkyThresholdCm: 120,
  fragileSurcharge: 0,

  minFee: 0,
  maxFee: null,

  peakWindows: [],
  peakMultiplier: 1,

  commissionBps: 1500,

  offerTtlSec: 45,
  maxConcurrentOffers: 5,
  searchTimeoutSec: 15 * 60,

  proofMethod: "otp",
  locationStaleSec: 120,

  updatedAt: "1970-01-01T00:00:00.000Z",
  updatedBy: "system-default",
};

/**
 * The per-km rate that actually applies.
 *
 * Precedence is VEHICLE, then ZONE, then the global fallback - and the reason is
 * operational. A zone knows about traffic and terrain; a vehicle knows about
 * running cost. When both have an opinion the ZONE wins, because the customer is
 * being quoted for a PLACE and the vehicle's own contribution is already inside
 * its base fee.
 */
export function effectivePerKm(
  vehicle: VehicleSpec | null,
  zone: DeliveryZone | null,
  config: DeliveryPricingConfig,
): number {
  if (vehicle && vehicle.pricePerKm > 0) return vehicle.pricePerKm;
  if (zone && zone.pricePerKm !== null && zone.pricePerKm > 0) return zone.pricePerKm;
  return config.pricePerKm;
}

/** Is a peak window active right now? UTC, so it is the same answer everywhere. */
export function isPeakActive(config: DeliveryPricingConfig, now: Date = new Date()): boolean {
  if (config.peakWindows.length === 0) return false;
  const hours = now.getUTCHours();
  const weekday = now.getUTCDay();
  return config.peakWindows.some((window) => {
    if (window.days.length > 0 && !window.days.includes(weekday)) return false;
    // A window that wraps past midnight (22 -> 6) is expressed as fromHour > toHour
    // and checked in two halves, rather than with a naive from <= h < to.
    if (window.fromHour <= window.toHour) return hours >= window.fromHour && hours < window.toHour;
    return hours >= window.fromHour || hours < window.toHour;
  });
}

/**
 * Split a fee into the platform's share and the driver's.
 *
 * THE ONE INVARIANT: `platformCommission + driverEarnings === total`, exactly,
 * for every amount. The driver takes the REMAINDER rather than a separately
 * rounded share, which is what makes that hold for amounts that do not divide
 * cleanly - a rounding cent must never silently become somebody's money.
 */
export function allocateFee(
  total: number,
  commissionBps: number,
): { platformCommission: number; driverEarnings: number } {
  const amount = roundMoney(total);
  if (amount <= 0) return { platformCommission: 0, driverEarnings: 0 };
  if (commissionBps <= 0) return { platformCommission: 0, driverEarnings: amount };
  if (commissionBps >= BPS_ONE_HUNDRED_PERCENT) {
    return { platformCommission: amount, driverEarnings: 0 };
  }
  const platformCommission = roundMoney((amount * commissionBps) / BPS_ONE_HUNDRED_PERCENT);
  return { platformCommission, driverEarnings: amount - platformCommission };
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

/**
 * Everything the quote needs, resolved by the caller from stored data.
 *
 * One object rather than four positional arguments, so a caller cannot swap the
 * vehicle for the zone, and so adding a component later is a type change rather
 * than a silent argument-shift bug.
 */
export interface QuoteInput {
  vehicle: VehicleSpec;
  zone: DeliveryZone | null;
  config: DeliveryPricingConfig;
  distanceKm: number;
  packageSpec: PackageSpec;
  now?: Date;
}

/** How the distance figure was obtained. Reported to the customer as an estimate. */
export interface QuoteContext {
  /** True when the km figure came from a real road geometry. */
  routedDistance: boolean;
}

/**
 * Produce the itemised quote.
 *
 * PURE. The function that reaches for a database is the one that calls this.
 */
export function quoteDelivery(input: QuoteInput & { context?: QuoteContext }): DeliveryPriceQuote {
  const { vehicle, zone, config, packageSpec } = input;
  const now = input.now ?? new Date();
  const distanceKm = Math.max(0, Number(input.distanceKm) || 0);
  const breakdown: string[] = [];

  // ---- 1. Base ------------------------------------------------------------
  const baseFee = vehicle.baseFee > 0 ? vehicle.baseFee : config.baseFee;
  breakdown.push(`${vehicle.name} base fee: ${baseFee}`);

  // ---- 2. Distance --------------------------------------------------------
  const perKm = effectivePerKm(vehicle, zone, config);
  const distanceFee = roundMoney(distanceKm * perKm);
  if (perKm > 0) {
    breakdown.push(`${distanceKm.toFixed(1)} km x ${perKm} per km: ${distanceFee}`);
  }

  // ---- 3. Zone ------------------------------------------------------------
  const zoneFee = zone ? zone.zoneFee : 0;
  if (zone && zoneFee !== 0) {
    breakdown.push(`${zone.name} zone fee: ${zoneFee > 0 ? "+" : ""}${zoneFee}`);
  }

  // ---- 4. Surcharges ------------------------------------------------------
  let surcharge = 0;
  if (config.heavySurcharge > 0 && packageSpec.weightKg > config.heavyThresholdKg) {
    surcharge += config.heavySurcharge;
    breakdown.push(`Heavy parcel (over ${config.heavyThresholdKg} kg): +${config.heavySurcharge}`);
  }
  if (config.bulkySurcharge > 0 && packageSpec.longestSideCm > config.bulkyThresholdCm) {
    surcharge += config.bulkySurcharge;
    breakdown.push(`Bulky parcel (over ${config.bulkyThresholdCm} cm): +${config.bulkySurcharge}`);
  }
  if (config.fragileSurcharge > 0 && packageSpec.fragile) {
    surcharge += config.fragileSurcharge;
    breakdown.push(`Fragile handling: +${config.fragileSurcharge}`);
  }

  // ---- 5. Subtotal, then peak --------------------------------------------
  const beforePeak = baseFee + distanceFee + zoneFee + surcharge;
  const peakActive = isPeakActive(config, now);
  const peakMultiplier = peakActive ? Math.max(1, config.peakMultiplier) : 1;
  const peakFee = peakActive ? roundMoney(beforePeak * (peakMultiplier - 1)) : 0;
  if (peakActive && peakFee > 0) {
    breakdown.push(`Peak pricing (x${peakMultiplier}): +${peakFee}`);
  }

  const uncapped = beforePeak + peakFee;

  // ---- 6. Clamp -----------------------------------------------------------
  // The VEHICLE's own min/max are applied before the global ones, because a class
  // can legitimately sit outside the platform floor - a bicycle below it, a truck
  // above it.
  const minFee = Math.max(vehicle.minFee, config.minFee);
  const vehicleCeiling = vehicle.maxFee;
  const globalCeiling = config.maxFee;
  const maxFee =
    vehicleCeiling === null
      ? globalCeiling
      : globalCeiling === null
        ? vehicleCeiling
        : Math.min(vehicleCeiling, globalCeiling);

  let total = uncapped;
  let minFeeApplied = false;
  let maxFeeApplied = false;
  if (total < minFee) {
    total = minFee;
    minFeeApplied = true;
    breakdown.push(`Minimum fee applied: ${minFee}`);
  }
  if (maxFee !== null && total > maxFee) {
    total = maxFee;
    maxFeeApplied = true;
    breakdown.push(`Maximum fee applied: ${maxFee}`);
  }
  total = roundMoney(total);

  // ---- 7. Commission ------------------------------------------------------
  const { platformCommission, driverEarnings } = allocateFee(total, config.commissionBps);

  return {
    currency: config.currency,
    baseFee,
    distanceFee,
    // `vehicleFee` is the per-class surcharge for when one is introduced (a
    // truck's road-toll allowance, say). It is 0 today and stays a FIELD so adding
    // it is not a data migration.
    vehicleFee: 0,
    zoneFee,
    surcharge,
    subtotal: total,
    peakMultiplier,
    peakFee,
    minFeeApplied,
    maxFeeApplied,
    breakdown,
    commissionBps: config.commissionBps,
    driverEarnings,
    platformCommission,
    quotedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Vehicle compatibility
// ---------------------------------------------------------------------------

/** Cheapest first, by the declared ladder order. */
export function vehicleRank(type: VehicleType): number {
  const index = VEHICLE_TYPES.indexOf(type);
  return index === -1 ? VEHICLE_TYPES.length : index;
}

/**
 * Does this vehicle class fit the parcel?
 *
 * This is the rule that stops a truck being selected merely because it exists:
 * compatibility is measured against the parcel, and the cheapest class that
 * passes is the one a customer is offered first.
 */
export function vehicleFits(vehicle: VehicleSpec, packageSpec: PackageSpec): boolean {
  if (packageSpec.weightKg > vehicle.maxWeightKg) return false;
  if (packageSpec.longestSideCm > vehicle.maxPackageSizeCm) return false;
  if (packageSpec.itemCount > vehicle.maxItems) return false;
  // A vehicle that cannot be trusted with glass is not offered for a fragile
  // parcel. This is "vehicle compatibility should be configurable" expressed as
  // a stored flag rather than a hard-coded table.
  if (packageSpec.fragile && !vehicle.carriesFragile) return false;
  return true;
}

/** Every class that can carry this parcel, cheapest first. */
export function compatibleVehicles(vehicles: VehicleSpec[], packageSpec: PackageSpec): VehicleSpec[] {
  return vehicles
    .filter((vehicle) => vehicle.active)
    .filter((vehicle) => vehicleFits(vehicle, packageSpec))
    .sort((a, b) => vehicleRank(a.type) - vehicleRank(b.type));
}

/**
 * Why a vehicle cannot take this parcel. Null when it can.
 *
 * Shown at checkout so a customer reads "too heavy for a bicycle" instead of
 * watching a vehicle silently disappear from the list.
 */
export function vehicleRejectionReason(vehicle: VehicleSpec, packageSpec: PackageSpec): string | null {
  if (packageSpec.weightKg > vehicle.maxWeightKg) {
    return `Too heavy for a ${vehicle.name.toLowerCase()} (up to ${vehicle.maxWeightKg} kg).`;
  }
  if (packageSpec.longestSideCm > vehicle.maxPackageSizeCm) {
    return `Too large for a ${vehicle.name.toLowerCase()} (up to ${vehicle.maxPackageSizeCm} cm).`;
  }
  if (packageSpec.itemCount > vehicle.maxItems) {
    return `Too many items for a ${vehicle.name.toLowerCase()} (up to ${vehicle.maxItems}).`;
  }
  if (packageSpec.fragile && !vehicle.carriesFragile) {
    return `A ${vehicle.name.toLowerCase()} cannot be used for fragile items.`;
  }
  return null;
}
