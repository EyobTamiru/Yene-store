/**
 * ============================================================================
 *  LOCAL MAP PROVIDER - the default, and the one that always works
 * ============================================================================
 *
 *  This is NOT a mock. It computes real distance with the same haversine the
 *  dispatch engine uses and returns a real (straight-line) geometry. What it
 *  cannot do is know where a road is, so:
 *
 *    * `routesAreRoadAccurate` is FALSE, and the pricing engine is told so -
 *      a quote from this provider is labelled an ESTIMATE rather than being
 *      presented as a routed fare. That honesty is the whole design.
 *    * `geocode` is NOT implemented, because there is no local gazetteer. The
 *      capability flag says so at boot instead of pretending.
 *
 *  WHY SHIPP IT RATHER THAN REFUSING TO START
 *  -----------------------------------------
 *  Every other part of the delivery system - dispatch, tracking, proof,
 *  earnings - is testable and demonstrable without a paid API key, and a
 *  courier app that will not start until a procurement contract is signed is
 *  not deployable in the field. The moment `DELIVERY_MAP_PROVIDER` names a real
 *  provider with its credential set, this class stops being selected at all.
 */

import { estimateDurationSec, estimateRoadKm, haversineKm } from "../geo";
import type { GeoPoint } from "../types";
import {
  MapProviderError,
  type MapCapabilities,
  type MapService,
  type MapProviderStatus,
  type PublicMapEnv,
  type RouteResult,
} from "./types";

const CAPABILITIES: MapCapabilities = {
  geocode: false,
  reverseGeocode: false,
  routing: true,
  routesAreRoadAccurate: false,
};

/** A two-point geometry. Honest: it is the straight line, not a road. */
function directGeometry(origin: GeoPoint, destination: GeoPoint): GeoPoint[] {
  return [origin, destination];
}

export class LocalMapProvider implements MapService {
  readonly name = "Built-in (straight-line estimate)";
  readonly capabilities = CAPABILITIES;

  isConfigured(): boolean {
    // Always. That is why it is the default and why the health check reports a
    // working delivery system on a machine with no API keys at all.
    return true;
  }

  async geocode(): Promise<null> {
    // Refused, not faked. `capabilities.geocode` is false so the boot warning
    // names this before a customer ever reaches an address field.
    return null;
  }

  async reverseGeocode(): Promise<string | null> {
    return null;
  }

  /**
   * Straight-line distance, converted to a road estimate.
   *
   * Uses the shared detour factor rather than its own constant, so the number a
   * driver is shown and the number a customer is quoted cannot disagree.
   */
  async calculateDistance(origin: GeoPoint, destination: GeoPoint): Promise<number> {
    const straight = haversineKm(origin, destination);
    if (!Number.isFinite(straight)) {
      throw new MapProviderError(this.name, "distance", "One of the two locations was not a valid coordinate.");
    }
    return estimateRoadKm(straight);
  }

  /**
   * The direct line, with the detour factor applied to BOTH figures.
   *
   * Applying the factor to the distance but not the duration would produce a
   * duration that contradicts the distance printed next to it, so both go
   * through `estimate*` and stay consistent.
   */
  async calculateRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    const straight = haversineKm(origin, destination);
    if (!Number.isFinite(straight)) {
      throw new MapProviderError(this.name, "route", "One of the two locations was not a valid coordinate.");
    }
    const distanceKm = estimateRoadKm(straight);
    return {
      geometry: directGeometry(origin, destination),
      distanceKm,
      // 28 km/h is a mixed urban average used ONLY to produce an order of
      // magnitude for an unrouted estimate. A real route replaces it before it
      // is ever shown as a firm ETA.
      durationSec: estimateDurationSec(distanceKm, 28, { pickupBufferSec: 0 }),
      source: "local-estimate",
    };
  }

  status(): MapProviderStatus {
    return {
      name: this.name,
      configured: true,
      capabilities: this.capabilities,
      requiresEnv: null,
      note:
        "No map provider is configured, so distances and times are straight-line estimates. " +
        "Set DELIVERY_MAP_PROVIDER and its key to route along real roads.",
    };
  }

  publicEnv(): PublicMapEnv {
    return {
      // No tiles: the map component renders a coordinate grid rather than
      // requesting third-party tiles that were never configured.
      tileProvider: null,
      browserToken: "",
      attribution: "",
    };
  }
}