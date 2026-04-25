import type { LatLng } from "./route.js";

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
  /** Unused — kept for call-site compatibility. */
  polyline?: readonly LatLng[];
  /** Seconds since the trip's service-day midnight. */
  nowSec: number;
  /** Unused — kept for call-site compatibility. */
  loop?: boolean;
}

/**
 * Returns the ghost bus's position for a scheduled trip. Ghost buses must
 * never appear to move on timetable alone — they pin to the trip's origin
 * stop until either a live GTFS-RT vehicle claims the trip (in which case
 * the map hides the ghost entirely) or the trip's scheduled terminus passes
 * (in which case we return null so the next trip's ghost can take over).
 */
export function interpolateScheduledPosition(
  args: InterpolateScheduledPositionArgs,
): LatLng | null {
  const { stopTimes, stopsById, nowSec } = args;
  if (stopTimes.length < 2) return null;

  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  const firstTime = first.arrivalSeconds ?? first.departureSeconds;
  const lastTime = last.arrivalSeconds ?? last.departureSeconds;
  if (firstTime == null || lastTime == null) return null;

  if (nowSec >= lastTime) return null;

  return stopsById.get(first.stopId) ?? null;
}
