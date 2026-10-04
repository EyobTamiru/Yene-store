/**
 * ============================================================================
 *  DELIVERY MAP
 * ============================================================================
 *
 *  PROVIDER-AGNOSTIC BY CONSTRUCTION
 *  ---------------------------------
 *  This component draws markers and a route from COORDINATES. It does not know
 *  which provider produced them, and it never asks one directly. That is what
 *  makes the "swap the map provider" requirement real rather than aspirational:
 *  changing `DELIVERY_MAP_PROVIDER` changes the geometry arriving here, and
 *  nothing in this file changes at all.
 *
 *  WHY THERE ARE NO TILES BY DEFAULT
 *  --------------------------------
 *  With no tile provider configured, this renders a GRID rather than requesting
 *  third-party tiles that were never configured - and, importantly, rather than
 *  pretending to be a map. The markers, the route and the geometry are all
 *  real; the background is plainly not street data, so nobody mistakes the
 *  position for a rendered map they could navigate by.
 *
 *  The courier is a MARKER, never a simulated track. There is no interpolation
 *  between pings: the marker sits exactly where the last real GPS fix said, and
 *  a stale position is shown as "position unavailable" rather than as a
 *  confidently-drawn dot somewhere they left hours ago.
 */

import { useMemo } from "react";

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  /** Which visual treatment to draw. */
  kind: "pickup" | "destination" | "driver" | "driver-idle";
  /** A short line under the label - a plate, a name. */
  detail?: string;
}

interface Props {
  markers: MapMarker[];
  /** A real road polyline when the provider returned one. */
  route?: { latitude: number; longitude: number }[] | null;
  /** Attribution that MUST be displayed when tiles are shown. */
  attribution?: string;
  className?: string;
  /** Shown instead of the map when there is nothing to plot. */
  emptyMessage?: string;
}

const VIEW_HEIGHT = 320;
const PADDING = 34;

/**
 * Fit the markers into the viewport.
 *
 * A map that shows one marker at the centre of the ocean is not useful, so the
 * bounds are the MARKERS, not a fixed zoom. A single marker gets a small fixed
 * window so it does not divide by zero.
 */
function bounds(markers: MapMarker[]) {
  if (markers.length === 0) return null;
  const lats = markers.map((m) => m.latitude);
  const lons = markers.map((m) => m.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // A single marker, or two markers on the same spot, would otherwise collapse
  // the scale to zero and every projection would divide by it.
  const latSpan = Math.max(maxLat - minLat, 0.004);
  const lonSpan = Math.max(maxLon - minLon, 0.004);
  return {
    centreLat: (minLat + maxLat) / 2,
    centreLon: (minLon + maxLon) / 2,
    latSpan,
    lonSpan,
  };
}

export function DeliveryMap({ markers, route, attribution, className = "", emptyMessage }: Props) {
  const view = useMemo(() => bounds(markers), [markers]);

  if (!view) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border border-yene-line-soft bg-yene-raised p-8 text-center ${className}`}
        style={{ height: VIEW_HEIGHT }}
      >
        <p className="text-[13px] text-yene-muted">{emptyMessage ?? "No location to show yet."}</p>
      </div>
    );
  }

  // Equirectangular projection scaled to fit the markers, with the longitude
  // axis corrected by cos(latitude) so the aspect ratio is not stretched.
  const width = 520;
  const height = VIEW_HEIGHT;
  const lonScale = Math.cos((view.centreLat * Math.PI) / 180);
  const project = (latitude: number, longitude: number) => {
    const x = width / 2 + ((longitude - view.centreLon) * lonScale) / view.lonSpan * (width - PADDING * 2);
    const y = height / 2 - ((latitude - view.centreLat) / view.latSpan) * (height - PADDING * 2);
    return { x: Math.round(Math.min(width - 12, Math.max(12, x))), y: Math.round(Math.min(height - 12, Math.max(12, y))) };
  };

  const points = markers.map((marker) => ({ marker, ...project(marker.latitude, marker.longitude) }));
  const routePath = (route ?? [])
    .map((point) => project(point.latitude, point.longitude))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-yene-line-soft bg-yene-surface ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        style={{ height: VIEW_HEIGHT }}
        role="img"
        aria-label={describe(markers)}
      >
        <defs>
          {/* A plainly non-cartographic grid, so nobody mistakes this for
              rendered street data when no tile provider is configured. */}
          <pattern id="yene-delivery-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0 L0 0 0 32" fill="none" stroke="var(--color-yene-line-soft)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="var(--color-yene-raised)" />
        <rect width={width} height={height} fill="url(#yene-delivery-grid)" />

        {routePath && (
          <polyline
            points={routePath}
            fill="none"
            stroke="var(--color-yene-accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="7 5"
            opacity="0.75"
          />
        )}

        {points.map(({ marker, x, y }) => (
          <g key={marker.id}>
            <circle cx={x} cy={y} r={markerRadius(marker.kind)} fill={markerColour(marker.kind)} />
            <circle cx={x} cy={y} r={markerRadius(marker.kind) + 3} fill="none" stroke={markerColour(marker.kind)} strokeWidth="1.5" opacity="0.35" />
            <text x={x} y={y - markerRadius(marker.kind) - 9} textAnchor="middle" className="fill-[var(--color-yene-text)]" style={{ fontSize: 11, fontWeight: 600 }}>
              {marker.label}
            </text>
            {marker.detail && (
              <text x={x} y={y + markerRadius(marker.kind) + 14} textAnchor="middle" className="fill-[var(--color-yene-faint)]" style={{ fontSize: 10 }}>
                {marker.detail}
              </text>
            )}
          </g>
        ))}
      </svg>

      {attribution && (
        <p className="absolute bottom-1 right-2 text-[10px] text-yene-faint">{attribution}</p>
      )}
    </div>
  );
}

function markerRadius(kind: MapMarker["kind"]): number {
  return kind === "driver" ? 9 : 7;
}

function markerColour(kind: MapMarker["kind"]): string {
  switch (kind) {
    case "pickup":
      return "var(--color-yene-info)";
    case "destination":
      return "var(--color-yene-accent)";
    case "driver":
      return "var(--color-yene-warn)";
    default:
      return "var(--color-yene-faint)";
  }
}

/** A text description, so the map is not invisible to a screen reader. */
function describe(markers: MapMarker[]): string {
  if (markers.length === 0) return "Delivery map with no markers";
  const driver = markers.find((m) => m.kind === "driver");
  const parts = markers.map((m) => m.label);
  if (driver) parts.push(`The delivery person is at ${driver.latitude}, ${driver.longitude}`);
  return `Delivery map showing ${parts.join(", ")}`;
}
