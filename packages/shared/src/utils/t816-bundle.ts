import type {
  BundledRoute,
  GtfsStop,
  PolylinePoint,
  T816Bundle,
} from "../types/gtfs.js";
import type { ParsedGtfs } from "./gtfs-parser.js";

export const T816_TARGET_CODES = [
  "T816",
  "T815",
  "T786",
  "PJ01",
  "PJ02",
] as const;
export type T816TargetCode = (typeof T816_TARGET_CODES)[number];

function matchesCode(
  route: ParsedGtfs["routes"][number],
  code: string,
): boolean {
  const norm = (s: string | undefined) => (s ?? "").trim().toUpperCase();
  const target = code.toUpperCase();
  return (
    norm(route.route_short_name) === target ||
    norm(route.route_long_name) === target
  );
}

export function filterToT816(
  parsed: ParsedGtfs,
  codes: readonly string[] = T816_TARGET_CODES,
  now: () => number = Date.now,
): T816Bundle {
  const matchedRoutes: BundledRoute[] = [];
  const matchedRouteIds = new Set<string>();

  for (const code of codes) {
    const r = parsed.routes.find((row) => matchesCode(row, code));
    if (!r) continue;
    const id = String(r.route_id);
    if (matchedRouteIds.has(id)) continue;
    matchedRouteIds.add(id);
    matchedRoutes.push({
      route_id: id,
      code,
      long_name: r.route_long_name,
    });
  }

  const trips = parsed.trips.filter((t) => matchedRouteIds.has(t.route_id));
  const tripIds = new Set(trips.map((t) => t.trip_id));
  const shapeIds = new Set(
    trips
      .map((t) => t.shape_id)
      .filter((s): s is string => typeof s === "string" && s.length > 0),
  );

  const stopTimes = parsed.stopTimes.filter((st) => tripIds.has(st.trip_id));
  const stopIds = new Set(stopTimes.map((st) => st.stop_id));

  const stopsById = new Map<string, GtfsStop>();
  for (const s of parsed.stops) {
    if (stopIds.has(s.stop_id)) stopsById.set(s.stop_id, s);
  }
  const stops = Array.from(stopsById.values());

  const shapes: Record<string, PolylinePoint[]> = {};
  for (const p of parsed.shapes) {
    if (!shapeIds.has(p.shape_id)) continue;
    const arr = shapes[p.shape_id] ?? (shapes[p.shape_id] = []);
    arr.push({
      lat: p.shape_pt_lat,
      lng: p.shape_pt_lon,
      seq: p.shape_pt_sequence,
    });
  }
  for (const k of Object.keys(shapes)) {
    shapes[k].sort((a, b) => a.seq - b.seq);
  }

  const serviceIds = new Set(trips.map((t) => t.service_id));
  const calendar = parsed.calendar.filter((c) => serviceIds.has(c.service_id));

  return {
    generatedAt: now(),
    routes: matchedRoutes,
    stops,
    trips,
    stopTimes,
    shapes,
    calendar,
  };
}
