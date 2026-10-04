/**
 * ============================================================================
 *  MAP PROVIDER REGISTRY
 * ============================================================================
 *
 *  The ONE place a provider is chosen. Business logic asks for `mapService()`
 *  and never learns which provider answered.
 *
 *  SELECTED ONCE PER PROCESS, then cached. A provider choice is configuration,
 *  not a request parameter, so nothing in a request body can change it and no
 *  caller can aim a deployment at a different upstream.
 *
 *  THE FALLBACK IS THE POINT
 *  -------------------------
 *  A provider that is selected but NOT configured falls back to
 *  `LocalMapProvider`, and the reason is returned by `mapStatus()` so the boot
 *  log and the admin screen both say "you selected a provider and it is missing
 *  its key". Silently running on estimates while an operator believes they are
 *  on road routing would be the worst available outcome.
 */

import { HttpMapProvider, type HttpMapProviderConfig, type HttpProviderKind } from "./http";
import { LocalMapProvider } from "./local";
import type { MapProviderStatus, MapService, PublicMapEnv } from "./types";

const KINDS: readonly HttpProviderKind[] = ["osrm", "nominatim", "maptiler", "google"];

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Build the configuration for a named provider from the environment.
 *
 * Every base URL is overridable (`DELIVERY_ROUTING_BASE_URL`,
 * `DELIVERY_GEOCODING_BASE_URL`, `DELIVERY_TILE_URL`), which is what makes a
 * self-hosted OSRM or an internal Nominatim a supported DEPLOYMENT rather than
 * a fork. The defaults are public, key-free endpoints.
 */
function buildHttpConfig(kind: HttpProviderKind): HttpMapProviderConfig {
  const shared = {
    kind,
    apiKey: null,
    keyStyle: "none" as const,
    keyParamName: "key",
    browserToken: null,
    tileUrlTemplate: null,
    tileProviderName: null,
    attribution: "",
  };

  switch (kind) {
    case "osrm":
      return {
        ...shared,
        displayName: "OSRM (OpenStreetMap routing)",
        routingBaseUrl: readEnv("DELIVERY_ROUTING_BASE_URL") ?? "https://router.project-osrm.org",
        geocodingBaseUrl: readEnv("DELIVERY_GEOCODING_BASE_URL"),
        attribution: "Map data (c) OpenStreetMap contributors",
      };
    case "nominatim":
      return {
        ...shared,
        displayName: "Nominatim (OpenStreetMap geocoding)",
        routingBaseUrl: readEnv("DELIVERY_ROUTING_BASE_URL") ?? "https://router.project-osrm.org",
        geocodingBaseUrl:
          readEnv("DELIVERY_GEOCODING_BASE_URL") ?? "https://nominatim.openstreetmap.org",
        attribution: "Map data (c) OpenStreetMap contributors",
      };
case "maptiler":
      return {
        kind,
        apiKey: readEnv("DELIVERY_MAPTILER_KEY"),
        keyStyle: "query-param",
        keyParamName: "key",
        browserToken: readEnv("DELIVERY_MAPTILER_BROWSER_KEY"),
        tileUrlTemplate:
          readEnv("DELIVERY_TILE_URL") ?? "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png",
        tileProviderName: "maptiler",
        attribution:
          readEnv("DELIVERY_TILE_ATTRIBUTION") ??
          "(c) MapTiler, (c) OpenStreetMap contributors",
        displayName: "MapTiler",
        routingBaseUrl: readEnv("DELIVERY_ROUTING_BASE_URL") ?? "https://api.maptiler.com",
        geocodingBaseUrl:
          readEnv("DELIVERY_GEOCODING_BASE_URL") ?? "https://api.maptiler.com/geocoding",
      };
    case "google":
      return {
        kind,
        apiKey: readEnv("DELIVERY_GOOGLE_KEY"),
        keyStyle: "query-param",
        keyParamName: "key",
        browserToken: readEnv("DELIVERY_GOOGLE_BROWSER_KEY"),
        tileUrlTemplate:
          readEnv("DELIVERY_TILE_URL") ?? "https://maps.googleapis.com/maps/api/staticmap",
        tileProviderName: "google",
        attribution: readEnv("DELIVERY_TILE_ATTRIBUTION") ?? "(c) Google",
        displayName: "Google Maps Platform",
        routingBaseUrl: readEnv("DELIVERY_ROUTING_BASE_URL") ?? "https://routes.googleapis.com",
        geocodingBaseUrl:
          readEnv("DELIVERY_GEOCODING_BASE_URL") ??
          "https://maps.googleapis.com/maps/api/geocode/json",
      };
  }
}

let cached: MapService | null = null;
let cachedStatus: MapProviderStatus | null = null;
let cachedPublicEnv: PublicMapEnv | null = null;

/** The configured provider, or the local estimator when it is unusable. */
export function mapService(): MapService {
  if (cached) return cached;

  const requested = readEnv("DELIVERY_MAP_PROVIDER")?.toLowerCase() ?? "";
  const local = new LocalMapProvider();

  if (requested && (KINDS as readonly string[]).includes(requested)) {
    const provider = new HttpMapProvider(buildHttpConfig(requested as HttpProviderKind));
    if (provider.isConfigured()) {
      cached = provider;
      cachedStatus = provider.status();
      cachedPublicEnv = provider.publicEnv();
      return provider;
    }
    // Selected but unusable: fall back, and record WHY so it can be reported.
    cached = local;
    cachedStatus = provider.status();
    cachedPublicEnv = local.publicEnv();
    return provider;
  }

  if (requested) {
    // An unrecognised name is a configuration error, not a silent downgrade.
    cached = local;
    cachedStatus = {
      ...local.status(),
      note:
        `DELIVERY_MAP_PROVIDER is "${requested}", which is not a provider this build knows ` +
        `(${KINDS.join(", ")}, or unset for the built-in estimate). The built-in estimate is in use.`,
    };
    cachedPublicEnv = local.publicEnv();
    return cached;
  }

  cached = local;
  cachedStatus = local.status();
  cachedPublicEnv = local.publicEnv();
  return cached;
}

export function mapStatus(): MapProviderStatus {
  mapService();
  return cachedStatus!;
}

/**
 * The only map configuration the browser may see.
 *
 * Served by `GET /api/delivery/map/config`. Holds a browser token and an
 * attribution string; never the server key, because each provider's
 * `publicEnv()` returns a hand-listed object rather than spreading its config.
 */
export function publicMapEnv(): PublicMapEnv {
  mapService();
  return cachedPublicEnv!;
}

/** Test seam: drop the cached selection so a suite can re-read the environment. */
export function resetMapServiceCache(): void {
  cached = null;
  cachedStatus = null;
  cachedPublicEnv = null;
}

export { LocalMapProvider } from "./local";
export { HttpMapProvider } from "./http";
export * from "./types";