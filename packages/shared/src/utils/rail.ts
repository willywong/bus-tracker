import { RAIL_STATIONS } from "../data/rail-stations.js";
import { haversineMeters } from "./outlier.js";

/** Rail mode as shown to riders. Derived from the feed's route `category`. */
export type RailMode = "LRT" | "MRT" | "Monorail" | "BRT" | "KTM";

/** One rail line serving a station, with its official branding. */
export interface RailLine {
  /** Short badge label, e.g. "MRT KG", "LRT KJ", "Monorail MR", "BRT". */
  code: string;
  mode: RailMode;
  /** Full line name from the feed, e.g. "MRT Kajang Line". */
  name: string;
  /** Line colour, '#RRGGBB'. */
  color: string;
  /** Text colour to draw on top of `color`, '#RRGGBB'. */
  textColor: string;
}

/**
 * One physical station. Interchanges (separate per-line stops in the feed,
 * with no parent_station) are merged into a single entry listing every line.
 */
export interface RailStation {
  /** Stable slug of the station name, e.g. "phileo-damansara". */
  id: string;
  /** Display name in title case, e.g. "Phileo Damansara". */
  name: string;
  lat: number;
  lng: number;
  /** rapid-rail-kl GTFS stop_ids merged into this station, e.g. ["KG12"]. */
  stopIds: readonly string[];
  lines: readonly RailLine[];
}

export interface NearbyRailStation {
  station: RailStation;
  distanceMeters: number;
}

export interface NearbyRailStationsOptions {
  /** Straight-line search radius in metres (inclusive). Default 400. */
  radiusMeters?: number;
  /** Maximum number of stations returned. Default 3. */
  limit?: number;
  /** Station list to search. Defaults to the bundled RAIL_STATIONS. */
  stations?: readonly RailStation[];
}

export const DEFAULT_RAIL_RADIUS_METERS = 400;
export const DEFAULT_RAIL_LIMIT = 3;
/** Typical urban walking pace used for `walkingMinutes`. */
export const WALKING_METERS_PER_MINUTE = 80;

/**
 * Rail stations within `radiusMeters` (straight line) of `point`, nearest
 * first, capped at `limit`.
 */
export function nearbyRailStations(
  point: { lat: number; lng: number },
  opts: NearbyRailStationsOptions = {},
): NearbyRailStation[] {
  const radius = opts.radiusMeters ?? DEFAULT_RAIL_RADIUS_METERS;
  const limit = opts.limit ?? DEFAULT_RAIL_LIMIT;
  const stations = opts.stations ?? RAIL_STATIONS;
  if (limit <= 0 || !(radius >= 0)) return [];
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return [];

  const hits: NearbyRailStation[] = [];
  for (const station of stations) {
    const distanceMeters = haversineMeters(point, station);
    if (distanceMeters <= radius) hits.push({ station, distanceMeters });
  }
  hits.sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      a.station.name.localeCompare(b.station.name),
  );
  return hits.slice(0, limit);
}

/**
 * Compact walking distance: "120 m" (rounded to 10 m) below 1 km, then
 * "1.2 km", and whole kilometres from 10 km.
 */
export function formatWalkingDistance(meters: number): string {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0;
  const rounded = Math.round(m / 10) * 10;
  if (rounded < 1000) return `${rounded} m`;
  const km = m / 1000;
  if (km < 9.95) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Approximate walking time in whole minutes (~80 m/min, rounded up). */
export function walkingMinutes(meters: number): number {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0;
  return Math.ceil(m / WALKING_METERS_PER_MINUTE);
}
