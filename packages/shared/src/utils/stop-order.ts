import type {
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
  T816Bundle,
} from "../types/gtfs.js";

export interface RepresentativeTrip {
  tripId: string;
  shapeId: string | null;
  directionId: 0 | 1 | undefined;
}

/**
 * Picks a representative trip for a route bundle using the same heuristic as
 * `getRoutePolyline` in the mobile app: group trips by `shape_id`, pick the
 * most-common shape; break ties by preferring `direction_id === 0`. Trips with
 * no `shape_id` are considered only when every trip in the bundle lacks one.
 *
 * Returns `null` only when the bundle has no trips at all.
 */
export function pickRepresentativeTrip(
  bundle: Pick<T816Bundle, "trips">,
): RepresentativeTrip | null {
  const trips = bundle.trips;
  if (trips.length === 0) return null;

  const withShape = trips.filter(
    (t): t is GtfsTrip & { shape_id: string } =>
      typeof t.shape_id === "string" && t.shape_id.length > 0,
  );
  const pool = withShape.length > 0 ? withShape : trips;

  if (withShape.length === 0) {
    const t = pool[0];
    return {
      tripId: t.trip_id,
      shapeId: t.shape_id ?? null,
      directionId: t.direction_id,
    };
  }

  const byShape = new Map<string, GtfsTrip[]>();
  for (const t of withShape) {
    const arr = byShape.get(t.shape_id!) ?? [];
    arr.push(t);
    byShape.set(t.shape_id!, arr);
  }

  let bestShape: string | null = null;
  let bestCount = -1;
  let bestHasDir0 = false;
  for (const [shapeId, group] of byShape) {
    const count = group.length;
    const hasDir0 = group.some((t) => t.direction_id === 0);
    if (
      count > bestCount ||
      (count === bestCount && hasDir0 && !bestHasDir0)
    ) {
      bestShape = shapeId;
      bestCount = count;
      bestHasDir0 = hasDir0;
    }
  }

  const winning = byShape.get(bestShape!)!;
  const preferred = winning.find((t) => t.direction_id === 0) ?? winning[0];
  return {
    tripId: preferred.trip_id,
    shapeId: preferred.shape_id ?? null,
    directionId: preferred.direction_id,
  };
}

/**
 * Returns the bundle's stops in route-sequence order using the given trip as
 * the reference. Loop routes that revisit the same stop keep only the first
 * visit (lowest `stop_sequence`). Stops that aren't in the reference trip's
 * `stop_times` fall through to the tail in alphabetical order — in normal
 * bundles this tail is empty since `bundle.stops` is derived from
 * `bundle.stopTimes`.
 *
 * When `tripId` is null, returns a pure alphabetical sort.
 */
export function orderStopsByTrip(
  bundle: Pick<T816Bundle, "stops" | "stopTimes">,
  tripId: string | null,
): GtfsStop[] {
  const byName = (a: GtfsStop, b: GtfsStop) =>
    a.stop_name.localeCompare(b.stop_name);

  if (!tripId) return [...bundle.stops].sort(byName);

  const tripTimes: GtfsStopTime[] = bundle.stopTimes
    .filter((st) => st.trip_id === tripId)
    .sort((a, b) => a.stop_sequence - b.stop_sequence);

  const orderByStopId = new Map<string, number>();
  for (const st of tripTimes) {
    if (!orderByStopId.has(st.stop_id)) {
      orderByStopId.set(st.stop_id, orderByStopId.size);
    }
  }

  const stopById = new Map<string, GtfsStop>();
  for (const s of bundle.stops) stopById.set(s.stop_id, s);

  const ordered: GtfsStop[] = [];
  const seen = new Set<string>();
  for (const [stopId] of orderByStopId) {
    const s = stopById.get(stopId);
    if (!s || seen.has(stopId)) continue;
    ordered.push(s);
    seen.add(stopId);
  }

  const tail = bundle.stops.filter((s) => !seen.has(s.stop_id)).sort(byName);
  return [...ordered, ...tail];
}
