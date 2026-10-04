/**
 * ============================================================================
 *  GEOGRAPHY - distance, ETA, zones
 * ============================================================================
 *
 *  PURE MATHS. No provider, no network, no API key.
 *
 *  WHY THE MATHS LIVES HERE RATHER THAN IN A MAP SDK
 *  -------------------------------------------------
 *  A dispatch engine must rank "nearby" drivers BEFORE any routing provider
 *  answers, because ranking every candidate over a network round trip is how a
 *  dispatch loop turns into a request storm. So proximity is computed locally
 *  and exactly (haversine on a sphere), and the provider is asked only for the
 *  ONE route that will actually be driven.
 *
 *  This is also why the module is testable with no credentials at all.
 *
 *  NO CITY IS NAMED HERE
 *  ---------------------
 *  Zones are polygons an administrator draws, so a deployment anywhere inherits
 *  no geographic assumption from the code. The only fixed number is the earth.
 */

import type { DeliveryZone, GeoPoint } from "./types";

/** Mean earth radius, kilometres (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A degree of longitude at a given latitude. Keeps "km per degree" honest. */
function kmPerDegreeLongitude(latitude: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_KM * Math.cos(toRadians(latitude));
}

const kmPerDegreeLatitude = (): number => (Math.PI / 180) * EARTH_RADIUS_KM;

/**
 * Great-circle distance in kilometres.
 *
 * Haversine, not the equirectangular approximation: the approximation is wrong
 * in exactly the place that matters here - near the poles, where `cos(lat)`
 * shrinks the longitude term, and across the antimeridian. The haversine term
 * is numerically stable for the SHORT distances every dispatch decision uses.
 *
 * A malformed point yields NaN rather than throwing. This is called from a
 * ranking loop over drivers whose stored position may be absent, and one bad
 * row must not stop the other candidates being considered.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  // Clamped: floating point can push h a hair above 1 for identical points,
  // which would make Math.asin return NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is this a usable coordinate pair?
 *
 * Latitude out of range is NOT clamped or wrapped: a phone reporting 200 is
 * reporting garbage, and treating it as -160 would place a driver in the
 * wrong ocean.
 */
export function isValidPoint(point: Partial<GeoPoint> | null | undefined): point is GeoPoint {
  if (!point) return false;
  const { latitude, longitude } = point;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Road distance from straight-line distance.
 *
 * Straight-line distance UNDERSTATES a road trip, and understating it
 * understates both the fee and the ETA. 1.3 is the usual urban detour ratio; it
 * is a NAMED constant rather than a magic number because it is a modelling
 * assumption an operator should be able to see - and because a real route from
 * the provider replaces it entirely when one exists.
 */
export const ROAD_DETOUR_FACTOR = 1.3;

export function estimateRoadKm(straightLineKm: number): number {
  return Math.max(0, straightLineKm) * ROAD_DETOUR_FACTOR;
}

/** Time parked at the merchant getting the parcel ready. */
export const DEFAULT_PICKUP_BUFFER_SEC = 5 * 60;

/**
 * Seconds to cover a distance at an average speed, plus handling time.
 *
 * `averageSpeedKph` comes from the VEHICLE ROW, which is why a bicycle and a
 * truck get different ETAs for the same distance rather than one shared guess.
 */
export function estimateDurationSec(
  roadKm: number,
  averageSpeedKph: number,
  options: { pickupBufferSec?: number } = {},
): number {
  const speed = Math.max(5, averageSpeedKph);
  const travel = (Math.max(0, roadKm) / speed) * 3600;
  return Math.round(travel + (options.pickupBufferSec ?? DEFAULT_PICKUP_BUFFER_SEC));
}
// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * Is `point` inside `polygon`? Ray casting.
 *
 * The edge tests are deliberately asymmetric (`>=` on latitude, `<` on
 * longitude): that half-open convention is what stops a point sitting ON a
 * shared boundary counting twice, which would otherwise let one delivery
 * belong to two overlapping zones at once and be charged twice.
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;
  if (!isValidPoint(point)) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.latitude >= point.latitude === b.latitude >= point.latitude) continue;
    const t = (point.latitude - a.latitude) / (b.latitude - a.latitude);
    if (point.longitude < a.longitude + t * (b.longitude - a.longitude)) inside = !inside;
  }
  return inside;
}

/** The centre of a polygon. Used to place a zone on a map and to label it. */
export function polygonCentroid(polygon: GeoPoint[]): GeoPoint | null {
  if (polygon.length === 0) return null;

  const mean = (): GeoPoint => {
    const sum = polygon.reduce(
      (acc, p) => ({
        latitude: acc.latitude + p.latitude,
        longitude: acc.longitude + p.longitude,
      }),
      { latitude: 0, longitude: 0 },
    );
    return { latitude: sum.latitude / polygon.length, longitude: sum.longitude / polygon.length };
  };
  if (polygon.length < 3) return mean();

  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    const cross = a.longitude * b.latitude - b.longitude * a.latitude;
    area += cross;
    x += (a.longitude + b.longitude) * cross;
    y += (a.latitude + b.latitude) * cross;
  }
  // Degenerate (collinear points): fall back to the vertex mean rather than
  // dividing by ~0 and reporting NaN as a zone's centre.
  if (Math.abs(area) < 1e-12) return mean();

  area *= 0.5;
  return { longitude: x / (6 * area), latitude: y / (6 * area) };
}

// ---------------------------------------------------------------------------
// Bounding boxes - reject most candidates without doing any trigonometry
// ---------------------------------------------------------------------------

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function boundingBox(points: GeoPoint[], padKm = 0): BoundingBox | null {
  const valid = points.filter(isValidPoint);
  if (valid.length === 0) return null;
  const latitudes = valid.map((p) => p.latitude);
  const longitudes = valid.map((p) => p.longitude);
  const midLat = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const latPad = padKm / kmPerDegreeLatitude();
  // The 0.01 floor stops cos(90°) = 0 producing an infinite longitude pad.
  const lonPad = padKm / Math.max(0.01, kmPerDegreeLongitude(midLat));
  return {
    minLat: Math.min(...latitudes) - latPad,
    maxLat: Math.max(...latitudes) + latPad,
    minLon: Math.min(...longitudes) - lonPad,
    maxLon: Math.max(...longitudes) + lonPad,
  };
}

export function isWithinBox(point: GeoPoint, box: BoundingBox): boolean {
  if (!isValidPoint(point)) return false;
  return (
    point.latitude >= box.minLat &&
    point.latitude <= box.maxLat &&
    point.longitude >= box.minLon &&
    point.longitude <= box.maxLon
  );
}

/**
 * The zone a destination falls in.
 *
 * A zone with NO polygon is treated as a catch-all rather than as matching
 * nothing, because an operator who creates "Zone A" without drawing it means
 * "applies for now" - and refusing to price a delivery inside a configured
 * zone is the worse failure. With several catch-alls the FIRST active one
 * wins, and the ordering is stated here rather than inherited from whatever
 * order the rows happen to be stored in.
 */
export function findZoneForPoint(point: GeoPoint, zones: DeliveryZone[]): DeliveryZone | null {
  if (!isValidPoint(point)) return null;
  const active = zones.filter((zone) => zone.active);

  const drawn = active.find(
    (zone) => zone.polygon && zone.polygon.length >= 3 && isPointInPolygon(point, zone.polygon),
  );
  if (drawn) return drawn;

  return active.find((zone) => !zone.polygon || zone.polygon.length < 3) ?? null;
}

/** Every zone containing a point, nearest-centre first. For a multi-zone quote. */
export function zonesForPoint(point: GeoPoint, zones: DeliveryZone[]): DeliveryZone[] {
  if (!isValidPoint(point)) return [];
  return zones
    .filter((zone) => zone.active)
    .map((zone) => ({ zone, centre: zone.polygon ? polygonCentroid(zone.polygon) : null }))
    .filter(({ zone, centre }) => {
      if (zone.polygon && zone.polygon.length >= 3) return isPointInPolygon(point, zone.polygon);
      return centre === null;
    })
    .sort((a, b) => {
      if (!a.centre && !b.centre) return 0;
      if (!a.centre) return 1;
      if (!b.centre) return -1;
      return haversineKm(point, a.centre) - haversineKm(point, b.centre);
    })
    .map(({ zone }) => zone);
}

/** Total length of a polyline, for a route the provider actually returned. */
export function polylineLengthKm(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/** Seconds remaining until an ISO timestamp, floored at zero. */
export function secondsUntil(iso: string, now = Date.now()): number {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.floor((target - now) / 1000));
}