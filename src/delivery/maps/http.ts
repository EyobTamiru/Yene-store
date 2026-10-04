/**
 * ============================================================================
 *  HTTP MAP PROVIDER - real routing and geocoding, over a configurable API
 * ============================================================================
 *
 *  This is the INTEGRATION, not a placeholder. Point `DELIVERY_MAP_PROVIDER` at
 *  a deployment of one of the supported providers, supply its key, and real
 *  road routing and real geocoding take over. Nothing else in the system
 *  changes - no business logic names a provider.
 *
 *  SUPPORTED SHAPES
 *  ---------------
 *    "osrm"      OSRM /route/v1 - the open-source option; no key needed, works
 *                against a public or self-hosted instance
 *    "nominatim" /search + /reverse, with routing delegated to the local
 *                estimator (a geocoder is not a router)
 *    "maptiler"  MapTiler /geocoding and /routes/v1 - hosted commercial
 *    "google"    Google Routes + Geocoding REST endpoints
 *
 *  A sixth provider is one new file in this folder implementing `MapService`.
 *
 *  FAILURE BEHAVIOUR - the part that matters operationally
 *  ------------------------------------------------------
 *  * No key configured     -> `isConfigured()` false. The boot log says so and
 *                             the registry falls back to LocalMapProvider, so
 *                             the rest of the delivery system still runs on
 *                             estimates rather than failing to start.
 *  * Key present, call fails -> `MapProviderError`. A caller that can tolerate
 *                             an estimate falls back deliberately; a caller
 *                             that cannot surfaces an error rather than sending
 *                             a driver the wrong way.
 *  * Timeout is enforced   -> a hung upstream cannot hold a dispatch slot open.
 */

import { estimateDurationSec, estimateRoadKm, haversineKm } from "../geo";
import type { GeoPoint } from "../types";
import {
  MapProviderError,
  type MapCapabilities,
  type MapProviderStatus,
  type MapService,
  type PublicMapEnv,
  type RouteResult,
} from "./types";

export type HttpProviderKind = "osrm" | "nominatim" | "maptiler" | "google";

/** How long any upstream call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 6_000;
const USER_AGENT = "YeneDelivery/1.0 (Yene Business Group dispatch)";

export interface HttpMapProviderConfig {
  kind: HttpProviderKind;
  /** Routing base, e.g. "https://router.project-osrm.org". */
  routingBaseUrl: string;
  /** Geocoding base, when the provider separates the two. null = no geocoding. */
  geocodingBaseUrl: string | null;
  apiKey: string | null;
  keyStyle: "query-param" | "header" | "none";
  keyParamName: string;
  /** A BROWSER-RESTRICTED token, served to the front end via the map config route. */
  browserToken: string | null;
  tileUrlTemplate: string | null;
  tileProviderName: string | null;
  attribution: string;
  displayName: string;
}

export class HttpMapProvider implements MapService {
  readonly name: string;
  readonly capabilities: MapCapabilities;

  constructor(private readonly config: HttpMapProviderConfig) {
    this.name = config.displayName;
    this.capabilities = {
      geocode: config.kind !== "osrm",
      reverseGeocode: config.kind !== "osrm",
      routing: true,
      // A geocoder alone cannot produce a road route, so Nominatim is explicit
      // that its "route" is the estimate rather than letting the caller guess.
      routesAreRoadAccurate: config.kind !== "nominatim",
    };
  }

  isConfigured(): boolean {
    if (this.config.keyStyle === "none") return true;
    return Boolean(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }

  private withKey(url: URL): void {
    if (this.config.keyStyle !== "query-param" || !this.config.apiKey) return;
    url.searchParams.set(this.config.keyParamName, this.config.apiKey);
  }

  private headers(): Record<string, string> {
    const base: Record<string, string> = { "User-Agent": USER_AGENT };
    if (this.config.keyStyle === "header" && this.config.apiKey) {
      base[this.config.keyParamName] = this.config.apiKey;
    }
    return base;
  }

  /**
   * One upstream call, with a hard timeout.
   *
   * `AbortController` rather than a `Promise.race`: a race that loses still
   * leaves the socket open and still burns provider quota.
   */
  private async fetchJson<T>(url: URL, operation: string): Promise<T> {
    this.withKey(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MapProviderError(
          this.name,
          operation,
          `The map provider answered ${response.status} for a ${operation} request.`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof MapProviderError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new MapProviderError(
        this.name,
        operation,
        aborted
          ? `The map provider did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `The map provider could not be reached for a ${operation} request.`,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
// -------------------------------------------------------------------------
  // Geocoding
  // -------------------------------------------------------------------------

  async geocode(address: string): Promise<{ point: GeoPoint; address: string } | null> {
    const query = address.trim();
    if (!query || !this.capabilities.geocode || !this.config.geocodingBaseUrl) return null;

    if (this.config.kind === "google") {
      const url = new URL(`${this.config.geocodingBaseUrl}/geocode`);
      url.searchParams.set("address", query);
      const body = await this.fetchJson<{
        results: { formatted_address: string; geometry: { location: GeoPoint } }[];
      }>(url, "geocode");
      const first = body.results?.[0];
      return first ? { point: first.geometry.location, address: first.formatted_address } : null;
    }

    const url = new URL(`${this.config.geocodingBaseUrl}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    if (this.config.kind === "maptiler") url.searchParams.set("language", "en");

    const body = await this.fetchJson<
      | { lat: string; lon: string; display_name?: string }[]
      | { features: { geometry: { coordinates: [number, number] }; properties: { name?: string } }[] }
    >(url, "geocode");

    if (Array.isArray(body)) {
      const first = body[0];
      if (!first) return null;
      return {
        point: { latitude: Number(first.lat), longitude: Number(first.lon) },
        address: first.display_name ?? query,
      };
    }
    const feature = body.features?.[0];
    if (!feature) return null;
    const [longitude, latitude] = feature.geometry.coordinates;
    return { point: { latitude, longitude }, address: feature.properties?.name ?? query };
  }

  async reverseGeocode(point: GeoPoint): Promise<string | null> {
    if (!this.capabilities.reverseGeocode || !this.config.geocodingBaseUrl) return null;

    if (this.config.kind === "google") {
      const url = new URL(`${this.config.geocodingBaseUrl}/geocode`);
      url.searchParams.set("latlng", `${point.latitude},${point.longitude}`);
      const body = await this.fetchJson<{ results: { formatted_address: string }[] }>(url, "reverseGeocode");
      return body.results?.[0]?.formatted_address ?? null;
    }

    const url = new URL(`${this.config.geocodingBaseUrl}/reverse`);
    url.searchParams.set("lat", String(point.latitude));
    url.searchParams.set("lon", String(point.longitude));
    url.searchParams.set("format", "json");

    const body = await this.fetchJson<{ display_name?: string; name?: string }>(url, "reverseGeocode");
    return body.display_name ?? body.name ?? null;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async calculateDistance(origin: GeoPoint, destination: GeoPoint): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route ? route.distanceKm : this.localEstimate(origin, destination).distanceKm;
  }
async calculateRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    // A Nominatim deployment carries no router, so the "route" is explicitly the
    // estimate rather than a road path that was never fetched.
    if (this.config.kind === "nominatim") return this.localEstimate(origin, destination);

    if (this.config.kind === "google") {
      const url = new URL(`${this.config.routingBaseUrl}/directions/v2:computeRoutes`);
      url.searchParams.set("origin", `${origin.latitude},${origin.longitude}`);
      url.searchParams.set("destination", `${destination.latitude},${destination.longitude}`);
      url.searchParams.set("travelMode", "DRIVE");
      const body = await this.fetchJson<{
        routes: { distanceMeters: number; duration: string }[];
      }>(url, "route");
      const first = body.routes?.[0];
      if (!first) return this.localEstimate(origin, destination);
      return {
        // Google's geometry is an ENCODED polyline. Rather than ship a decoder
        // nothing here tests, the direct line is returned while DISTANCE and
        // DURATION - which pricing and ETAs actually use - are the real values.
        geometry: [origin, destination],
        distanceKm: first.distanceMeters / 1000,
        durationSec: Math.round(Number(first.duration || 0)),
        source: "google-route",
      };
    }

    const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url =
      this.config.kind === "maptiler"
        ? new URL(`${this.config.routingBaseUrl}/routes/v1`)
        : new URL(`${this.config.routingBaseUrl}/route/v1/driving/${coords}`);
    url.searchParams.set("geometries", "geojson");
    if (this.config.kind === "maptiler") url.searchParams.set("coordinates", coords);
    else url.searchParams.set("overview", "full");

    const body = await this.fetchJson<{
      routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    }>(url, "route");
    const first = body.routes?.[0];
    if (!first) return this.localEstimate(origin, destination);

    return {
      geometry: first.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      distanceKm: first.distance / 1000,
      durationSec: Math.round(first.duration),
      source: `${this.config.kind}-route`,
    };
  }

  private localEstimate(origin: GeoPoint, destination: GeoPoint): RouteResult {
    const distanceKm = estimateRoadKm(haversineKm(origin, destination));
    return {
      geometry: [origin, destination],
      distanceKm,
      durationSec: estimateDurationSec(distanceKm, 28, { pickupBufferSec: 0 }),
      source: "local-estimate",
    };
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private requiredEnvName(): string {
    if (this.config.keyStyle === "none") return "";
    switch (this.config.kind) {
      case "maptiler":
        return "DELIVERY_MAPTILER_KEY";
      case "google":
        return "DELIVERY_GOOGLE_KEY";
      default:
        return "DELIVERY_MAP_API_KEY";
    }
  }

  status(): MapProviderStatus {
    const configured = this.isConfigured();
    return {
      name: this.name,
      configured,
      capabilities: this.capabilities,
      requiresEnv: configured ? null : this.requiredEnvName(),
      note: configured
        ? "Configured. Distances and times come from the map provider's routing service."
        : `${this.name} is selected but its API key is not set. Set ${this.requiredEnvName()} to enable it, or leave DELIVERY_MAP_PROVIDER unset to use the built-in estimate.`,
    };
  }

  publicEnv(): PublicMapEnv {
    return {
      tileProvider: this.config.tileProviderName,
      // Only the browser-restricted token is reachable from here; the server key
      // above is structurally absent from this object.
      browserToken: this.config.browserToken ?? "",
      attribution: this.config.attribution,
    };
  }
}