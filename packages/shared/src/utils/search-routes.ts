import type { ParsedGtfs } from "./gtfs-parser.js";

export interface RouteSearchHit {
  code: string;
  long_name?: string;
  /** First stop along a representative trip for this route. */
  origin?: string;
  /** Last stop along a representative trip for this route. */
  destination?: string;
  /**
   * Stop near the middle of a representative trip. Useful for circular routes
   * where origin and destination collapse to the same stop — the UI can fall
   * back to "via {midpoint}" instead of a confusing "to {same origin}".
   * Only populated when the midpoint is distinct from origin and destination.
   */
  midpoint?: string;
  matchedStops?: { stop_id: string; stop_name: string }[];
}

interface InternalHit {
  route_id: string;
  code: string;
  long_name?: string;
  rank: number;
  origin?: string;
  destination?: string;
  midpoint?: string;
  matchedStops?: { stop_id: string; stop_name: string }[];
}

function normalize(s: string | undefined): string {
  return (s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "");
}

export function searchRoutes(
  parsed: ParsedGtfs,
  query: string,
  limit: number = 25,
): RouteSearchHit[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  const byId = new Map<string, InternalHit>();

  const upsert = (hit: InternalHit) => {
    const existing = byId.get(hit.route_id);
    if (!existing || hit.rank < existing.rank) {
      byId.set(hit.route_id, hit);
    }
  };

  // Pass 1 & 2: route short/long name.
  for (const r of parsed.routes) {
    const shortN = normalize(r.route_short_name);
    const longN = normalize(r.route_long_name);
    const display = (r.route_short_name || r.route_long_name || "").trim();
    if (!display) continue;

    if (shortN === q) {
      upsert({
        route_id: String(r.route_id),
        code: display,
        long_name: r.route_long_name,
        rank: 0,
      });
      continue;
    }
    if (shortN.includes(q) || longN.includes(q)) {
      upsert({
        route_id: String(r.route_id),
        code: display,
        long_name: r.route_long_name,
        rank: 1,
      });
    }
  }

  // Pass 3: stop-name match. Build join only if needed (non-empty unmatched set
  // or for enriching). We always attempt this pass but skip routes that already
  // matched at rank 0 — those beat any stop match.
  const routeById = new Map<string, ParsedGtfs["routes"][number]>();
  for (const r of parsed.routes) routeById.set(String(r.route_id), r);

  const matchingStopIds = new Set<string>();
  const stopById = new Map<string, ParsedGtfs["stops"][number]>();
  for (const s of parsed.stops) {
    stopById.set(s.stop_id, s);
    if (normalize(s.stop_name).includes(q)) {
      matchingStopIds.add(s.stop_id);
    }
  }

  if (matchingStopIds.size > 0) {
    // trip_id → route_id
    const tripRouteId = new Map<string, string>();
    for (const t of parsed.trips) tripRouteId.set(t.trip_id, t.route_id);

    // route_id → matched stops (dedup via stop_id)
    const routeStops = new Map<string, Map<string, { stop_id: string; stop_name: string }>>();
    for (const st of parsed.stopTimes) {
      if (!matchingStopIds.has(st.stop_id)) continue;
      const routeId = tripRouteId.get(st.trip_id);
      if (!routeId) continue;
      let m = routeStops.get(routeId);
      if (!m) {
        m = new Map();
        routeStops.set(routeId, m);
      }
      if (!m.has(st.stop_id)) {
        const s = stopById.get(st.stop_id);
        if (s) m.set(st.stop_id, { stop_id: s.stop_id, stop_name: s.stop_name });
      }
    }

    for (const [routeId, stopsMap] of routeStops) {
      const matchedStops = Array.from(stopsMap.values()).slice(0, 3);
      const existing = byId.get(routeId);
      if (existing) {
        if (!existing.matchedStops) existing.matchedStops = matchedStops;
        continue;
      }
      const r = routeById.get(routeId);
      if (!r) continue;
      const display = (r.route_short_name || r.route_long_name || "").trim();
      if (!display) continue;
      upsert({
        route_id: routeId,
        code: display,
        long_name: r.route_long_name,
        rank: 2,
        matchedStops,
      });
    }
  }

  const hits = Array.from(byId.values());
  hits.sort((a, b) => (a.rank - b.rank) || a.code.localeCompare(b.code));
  const top = hits.slice(0, limit);

  // Enrich with origin/destination. Pick one representative trip per matched
  // route, then scan stop_times once tracking min/max stop_sequence per trip.
  if (top.length > 0) {
    const matchedRouteIds = new Set(top.map((h) => h.route_id));
    const firstTripByRoute = new Map<string, string>();
    for (const t of parsed.trips) {
      if (!matchedRouteIds.has(t.route_id)) continue;
      if (!firstTripByRoute.has(t.route_id)) {
        firstTripByRoute.set(t.route_id, t.trip_id);
      }
    }

    const tripIds = new Set(firstTripByRoute.values());
    // Collect every stop of each representative trip so we can derive both
    // endpoints and a midpoint. Retaining all stops (rather than only min/max)
    // costs O(stopTimes) memory but gives us the "via" hint for loop routes.
    const stopsByTrip = new Map<string, Array<{ seq: number; id: string }>>();
    for (const st of parsed.stopTimes) {
      if (!tripIds.has(st.trip_id)) continue;
      let arr = stopsByTrip.get(st.trip_id);
      if (!arr) {
        arr = [];
        stopsByTrip.set(st.trip_id, arr);
      }
      arr.push({ seq: st.stop_sequence, id: st.stop_id });
    }

    for (const h of top) {
      const tripId = firstTripByRoute.get(h.route_id);
      if (!tripId) continue;
      const stops = stopsByTrip.get(tripId);
      if (!stops || stops.length === 0) continue;
      stops.sort((a, b) => a.seq - b.seq);

      const firstStop = stopById.get(stops[0].id);
      const lastStop = stopById.get(stops[stops.length - 1].id);
      if (firstStop) h.origin = firstStop.stop_name;
      if (lastStop) h.destination = lastStop.stop_name;

      // Expose a midpoint only when it adds information — distinct from both
      // endpoints and the trip has enough stops for "middle" to mean something.
      if (stops.length >= 3) {
        const midStop = stopById.get(stops[Math.floor(stops.length / 2)].id);
        const midName = midStop?.stop_name;
        if (
          midName &&
          midName !== firstStop?.stop_name &&
          midName !== lastStop?.stop_name
        ) {
          h.midpoint = midName;
        }
      }
    }
  }

  return top.map((h) => ({
    code: h.code,
    long_name: h.long_name,
    origin: h.origin,
    destination: h.destination,
    midpoint: h.midpoint,
    matchedStops: h.matchedStops,
  }));
}
