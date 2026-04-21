import {
  pointAlongRoute,
  polylineLength,
  projectOntoRoute,
  type LatLng,
} from "./route.js";

export interface ScheduledStopTime {
  stopId: string;
  stopSequence: number;
  /** Seconds since service-day midnight. Null if missing from the feed. */
  arrivalSeconds: number | null;
  /** Seconds since service-day midnight. Null if missing from the feed. */
  departureSeconds: number | null;
}

export interface InterpolateScheduledPositionArgs {
  /** stop_times rows for one trip, sorted by `stop_sequence` ascending. */
  stopTimes: readonly ScheduledStopTime[];
  /** Lookup from `stop_id` to LatLng. Stops missing from the map yield null. */
  stopsById: ReadonlyMap<string, LatLng>;
  polyline: readonly LatLng[];
  /** Seconds since the trip's service-day midnight. */
  nowSec: number;
  /** True for loop routes (e.g. T816); forward motion wraps modulo polyline length. */
  loop?: boolean;
}

/**
 * Estimates where a scheduled bus would be right now along its route polyline,
 * using only timetable data. Returns null when the trip hasn't started, has
 * ended, or when required stops are missing from the lookup.
 *
 * Position is interpolated linearly in time between consecutive stops, then
 * mapped onto the polyline by linear interpolation between each stop's
 * projected distance-from-start. While the bus is dwelling at a stop
 * (`arrival < departure`), the position snaps to that stop.
 */
export function interpolateScheduledPosition(
  args: InterpolateScheduledPositionArgs,
): LatLng | null {
  const { stopTimes, stopsById, polyline, nowSec, loop = false } = args;
  if (stopTimes.length < 2 || polyline.length < 2) return null;

  const norm = stopTimes.map((s) => ({
    stopId: s.stopId,
    arr: s.arrivalSeconds ?? s.departureSeconds,
    dep: s.departureSeconds ?? s.arrivalSeconds,
  }));

  const first = norm[0];
  const last = norm[norm.length - 1];
  if (first.arr == null || last.arr == null) return null;
  // Before the trip departs origin, pin to the origin stop so the ghost
  // marker shows "next bus starts here" instead of vanishing during the
  // pre-departure window (up to one headway under normal service).
  if (nowSec < first.arr) return stopsById.get(first.stopId) ?? null;
  // Past the terminus the vehicle is out of service.
  if (nowSec >= last.arr) return null;

  for (const s of norm) {
    if (
      s.arr != null &&
      s.dep != null &&
      s.arr < s.dep &&
      nowSec >= s.arr &&
      nowSec < s.dep
    ) {
      return stopsById.get(s.stopId) ?? null;
    }
  }

  for (let i = 0; i < norm.length - 1; i++) {
    const a = norm[i];
    const b = norm[i + 1];
    if (a.dep == null || b.arr == null) continue;
    if (nowSec < a.dep || nowSec >= b.arr) continue;

    const stopA = stopsById.get(a.stopId);
    const stopB = stopsById.get(b.stopId);
    if (!stopA || !stopB) return null;

    const span = b.arr - a.dep;
    const t = span > 0 ? (nowSec - a.dep) / span : 0;

    const projA = projectOntoRoute(stopA, polyline);
    const projB = projectOntoRoute(stopB, polyline);
    const total = polylineLength(polyline);
    const posA = total - projA.remainingMeters;
    let posB = total - projB.remainingMeters;
    // For a loop route, if B projects "before" A on the polyline, the bus
    // crosses the seam from end → start; treat B as one lap further on.
    if (loop && posB < posA) posB += total;
    const target = posA + (posB - posA) * t;
    return pointAlongRoute(polyline, target, { loop });
  }

  return null;
}
