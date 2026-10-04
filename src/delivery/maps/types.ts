/**
 * ============================================================================
 *  MAP SERVICE ABSTRACTION
 * ============================================================================
 *
 *  The interface business logic codes against. It is NOT a map SDK import, and
 *  no provider name appears in any file outside this folder. That is the whole
 *  point: swapping Google for Mapbox for OSRM for MapLibre is a change to one
 *  file and one environment variable, not a search-and-replace through the
 *  dispatch engine.
 *
 *  FIVE CONCERNS, NOT ONE
 *  ----------------------
 *  Geocoding, reverse geocoding, routing, distance and location are separate
 *  capabilities because real providers draw the line in different places. A
 *  provider that cannot geocode says so by omitting the method (below the
 *  capability line) rather than by throwing at runtime from a dispatch loop.
 *
 *  CREDENTIALS
 *  -----------
 *  A server key is read from the environment by the provider and never leaves
 *  the server. A browser key, when a provider needs one, is served through
 *  `GET /api/delivery/map/config`, which reads it from the environment at
 *  request time rather than being compiled into the bundle. The browser never
 *  sees a value that is not in `publicEnv`.
 */

import type { GeoPoint } from "../types";

/** An address, with the point it resolved to. */
export interface GeocodeResult {
  point: GeoPoint;
  address: string;
  /** A wider box the result covers, when the provider returns one. */
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
}

/** A route the driver will actually drive. */
export interface RouteResult {
  /** The road polyline. Never empty - a failed route is an error, not a point. */
  geometry: GeoPoint[];
  distanceKm: number;
  durationSec: number;
  /** The provider's own reference, for an audit trail. */
  source: string;
}

/**
 * What a provider may support.
 *
 * A provider advertises its capabilities and `mapService()` warns at boot when
 * a deployment asks for something the configured provider cannot do, instead of
 * discovering it through a failed customer request.
 */
export interface MapCapabilities {
  geocode: boolean;
  reverseGeocode: boolean;
  routing: boolean;
  /** Whether a computed route is trustworthy enough to price from. */
  routesAreRoadAccurate: boolean;
}

export interface MapService {
  /** The name shown on the admin screen. e.g. "OSRM (OpenStreetMap)". */
  readonly name: string;
  readonly capabilities: MapCapabilities;
  /** True when the provider has the credentials it needs to actually work. */
  isConfigured(): boolean;

  geocode(address: string): Promise<GeocodeResult | null>;
  reverseGeocode(point: GeoPoint): Promise<string | null>;
  calculateDistance(origin: GeoPoint, destination: GeoPoint): Promise<number>;
  calculateRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null>;
}

/**
 * Thrown by a provider that is configured but failed.
 *
 * Distinct from "no key": a caller can fall back to the local estimate on a
 * network error, but must NOT silently fall back on a missing credential.
 */
export class MapProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MapProviderError";
  }
}

/**
 * Settings that may safely reach a browser.
 *
 * Deliberately a hand-listed subset. A provider's browser config is built by
 * its own `publicEnv()` returning ONLY the fields named here, so adding a secret
 * to a provider's configuration cannot leak it by accident - the type has to
 * change first.
 */
export interface PublicMapEnv {
  /** e.g. "maplibre" | "google" | "leaflet". Null when no tiles are shown. */
  tileProvider: string | null;
  /** A browser-restricted token. Empty when the provider needs none. */
  browserToken: string;
  /** Attribution text that MUST be displayed when tiles are shown. */
  attribution: string;
}

/** The admin-facing description of the configured provider. */
export interface MapProviderStatus {
  name: string;
  configured: boolean;
  capabilities: MapCapabilities;
  /** The environment variable that must be set, or null when nothing is needed. */
  requiresEnv: string | null;
  /** A sentence an administrator can act on. Never a stack trace. */
  note: string;
}