/**
 * ============================================================================
 *  DELIVERY STORE
 * ============================================================================
 *
 *  New durable JSON collections, using the same `createJsonCollection` write
 *  strategy as every other store in this project: atomic (temp file + rename),
 *  coalesced, and fail-safe (a corrupt file starts empty rather than taking the
 *  server down).
 *
 *  PURELY ADDITIVE
 *  ----------------
 *  This project has no Prisma and no SQL. "The database" is a set of JSON files
 *  under `YENE_DATA_DIR`. Adding these files touches none of the existing ones:
 *  there is no schema to migrate, no table to lock, and nothing that has to run
 *  before the delivery system can start. Seeding is lazy - it writes the first
 *  time it is called and never overwrites what an administrator has changed.
 *
 *  WHAT IS DELIBERATELY SEPARATE
 *  -----------------------------
 *  A `Delivery` REFERENCES a Yene-Store `BusinessOrder` by id. It copies the
 *  address TEXT at request time - on purpose, because an order's address is
 *  edited freely after checkout and a courier must be sent where the parcel was
 *  addressed. It does not copy the order, the customer or the merchant, so there
 *  is no second order system to drift out of step with the first.
 *
 *  LOCATION STORAGE - THE PRIVACY DECISION
 *  ---------------------------------------
 *  `driver-locations.json` holds ONE row per driver, overwritten on every ping.
 *  A courier's whole day's track is therefore never accumulated on disk.
 *  `driver-location-samples.json` holds the route points for a LIVE delivery and
 *  is pruned the moment it closes, so a finished job leaves no movement trail.
 *  MAX_LOCATION_SAMPLES_PER_DELIVERY bounds a live one as well.
 */

import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection } from "../lib/jsonCollection";
import { DEFAULT_DELIVERY_PRICING } from "../../src/delivery/pricing";
import { seedVehicles } from "../../src/delivery/vehicles";
import type {
  Delivery,
  DriverEarning,
  DeliveryNotification,
  DeliveryOffer,
  DeliveryPricingConfig,
  DeliveryRating,
  DeliveryZone,
  DriverLocation,
  DriverLocationSample,
  DriverProfile,
  VehicleSpec,
} from "../../src/delivery/types";

export const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

/** Where driver photos and identity documents land. Never in the web root. */
export const driverUploadsDir = path.join(dataDir, "uploads", "drivers");

function collection<T>(file: string, label: string, limit = 20_000) {
  return createJsonCollection<T>(path.join(dataDir, file), label, limit);
}

const deliveries = collection<Delivery>("delivery-deliveries.json", "deliveries", 100_000);
const drivers = collection<DriverProfile>("delivery-drivers.json", "delivery-drivers", 50_000);
const vehicles = collection<VehicleSpec>("delivery-vehicles.json", "delivery-vehicles", 100);
const zones = collection<DeliveryZone>("delivery-zones.json", "delivery-zones", 500);
const offers = collection<DeliveryOffer>("delivery-offers.json", "delivery-offers", 200_000);
const ratings = collection<DeliveryRating>("delivery-ratings.json", "delivery-ratings", 100_000);
const earnings = collection<DriverEarning>("delivery-earnings.json", "delivery-earnings", 200_000);
const notifications = collection<DeliveryNotification>(
  "delivery-notifications.json",
  "delivery-notifications",
  100_000,
);
const locations = collection<DriverLocation>("driver-locations.json", "driver-locations", 100_000);
const samples = collection<DriverLocationSample>(
  "driver-location-samples.json",
  "driver-location-samples",
  200_000,
);
const pricingRows = collection<DeliveryPricingConfig>("delivery-pricing.json", "delivery-pricing", 10);

export const allDeliveries = deliveries.all;
export const allDrivers = drivers.all;
export const allVehicles = vehicles.all;
export const allZones = zones.all;
export const allOffers = offers.all;
export const allRatings = ratings.all;
export const allEarnings = earnings.all;
export const allPricingRows = pricingRows.all;
export const allNotifications = notifications.all;
export const allLocations = locations.all;
export const allLocationSamples = samples.all;

export const persistDeliveries = deliveries.touch;
export const persistDrivers = drivers.touch;
export const persistVehicles = vehicles.touch;
export const persistZones = zones.touch;
export const persistOffers = offers.touch;
export const persistRatings = ratings.touch;
export const persistEarnings = earnings.touch;
export const persistNotifications = notifications.touch;
export const persistLocations = locations.touch;
export const persistLocationSamples = samples.touch;
export const persistPricing = pricingRows.touch;

export function flushDeliveryStores(): void {
  deliveries.flush();
  drivers.flush();
  vehicles.flush();
  zones.flush();
  offers.flush();
  ratings.flush();
  earnings.flush();
  notifications.flush();
  locations.flush();
  samples.flush();
  pricingRows.flush();
}

/** How many route points one live delivery may retain. */
export const MAX_LOCATION_SAMPLES_PER_DELIVERY = 400;

/** A short, non-guessable id. Prefix first so a log line stays readable. */
export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Seeding - lazy, additive, never overwriting an operator's change
// ---------------------------------------------------------------------------

/**
 * The five vehicle classes, written the first time they are asked for.
 *
 * Idempotent by construction: a vehicle whose id already exists is left exactly
 * as it is, including pricing an administrator has since edited. Re-running this
 * on every boot is therefore safe, which is what lets `server.ts` call it
 * unconditionally.
 */
export function ensureVehicles(): VehicleSpec[] {
  if (allVehicles().length > 0) return allVehicles();
  const now = new Date().toISOString();
  const seeded = seedVehicles(now);
  allVehicles().push(...seeded);
  persistVehicles();
  return seeded;
}

/**
 * The pricing configuration: one row, created from the shipped defaults.
 *
 * A stored row ALWAYS wins. This runs only when the collection is empty, so an
 * operator's changes can never be reverted by a restart.
 */
export function pricingConfig(): DeliveryPricingConfig {
  const existing = allPricingRows()[0];
  if (existing) return existing;
  const seeded: DeliveryPricingConfig = { ...DEFAULT_DELIVERY_PRICING };
  allPricingRows().push(seeded);
  persistPricing();
  return seeded;
}

export function savePricingConfig(config: DeliveryPricingConfig): void {
  const list = allPricingRows();
  list[0] = config;
  persistPricing();
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function deliveryById(id: string): Delivery | null {
  return allDeliveries().find((entry) => entry.id === id) ?? null;
}

export function driverById(id: string): DriverProfile | null {
  return allDrivers().find((entry) => entry.id === id) ?? null;
}

/** The driver record bound to a Yene-Store user, if they have one. */
export function driverForUser(userId: string): DriverProfile | null {
  return allDrivers().find((entry) => entry.userId === userId) ?? null;
}

/** By phone, for a driver signing in with a number rather than an account. */
export function driverByPhone(phone: string): DriverProfile | null {
  const digits = phone.replace(/\D/g, "");
  return allDrivers().find((entry) => entry.phone.replace(/\D/g, "") === digits) ?? null;
}

export function vehicleById(id: string): VehicleSpec | null {
  return allVehicles().find((entry) => entry.id === id) ?? null;
}

export function vehicleByType(type: string): VehicleSpec | null {
  return allVehicles().find((entry) => entry.type === type) ?? null;
}

export function zoneById(id: string): DeliveryZone | null {
  return allZones().find((entry) => entry.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Driver locations - one live row per driver
// ---------------------------------------------------------------------------

/**
 * Record a driver's position. OVERWRITES rather than appending.
 *
 * This is the privacy control that keeps a courier's off-duty movements off the
 * disk: there is exactly one row per driver, so the store can never answer
 * "where was this person last Tuesday".
 */
export function saveDriverLocation(location: DriverLocation): void {
  const list = allLocations();
  const index = list.findIndex((entry) => entry.driverId === location.driverId);
  if (index === -1) list.push(location);
  else list[index] = location;
  persistLocations();
}

export function driverLocation(driverId: string): DriverLocation | null {
  return allLocations().find((entry) => entry.driverId === driverId) ?? null;
}

export function locationsForDrivers(driverIds: string[]): Map<string, DriverLocation> {
  const wanted = new Set(driverIds);
  const map = new Map<string, DriverLocation>();
  for (const location of allLocations()) {
    if (wanted.has(location.driverId)) map.set(location.driverId, location);
  }
  return map;
}

/**
 * Append a route point for a live delivery, bounded.
 *
 * When the cap is reached the OLDEST point is dropped rather than refusing the
 * new one, so the track always shows the driver's most recent movement.
 */
export function appendLocationSample(sample: DriverLocationSample): void {
  const list = allLocationSamples();
  list.push(sample);
  const forThisDelivery = list.filter((entry) => entry.deliveryId === sample.deliveryId);
  if (forThisDelivery.length > MAX_LOCATION_SAMPLES_PER_DELIVERY) {
    const excess = forThisDelivery.length - MAX_LOCATION_SAMPLES_PER_DELIVERY;
    const doomed = new Set(forThisDelivery.slice(0, excess).map((entry) => entry.id));
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (doomed.has(list[i].id)) list.splice(i, 1);
    }
  }
  persistLocationSamples();
}

/**
 * Forget a delivery's movement trail. Called the moment a delivery closes.
 *
 * A finished job leaves no route history on disk, which is both the privacy
 * answer and the storage answer.
 */
export function pruneSamplesForDelivery(deliveryId: string): number {
  const list = allLocationSamples();
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].deliveryId === deliveryId) list.splice(i, 1);
  }
  const removed = before - list.length;
  if (removed > 0) persistLocationSamples();
  return removed;
}
