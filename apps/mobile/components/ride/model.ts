/**
 * On-board mode: given the stops from where you boarded to where you get
 * off, and where you (or your bus) are now, how many stops are left. Pure,
 * so the rules are testable without a device.
 */

export interface RideStop {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
}

export type RidePhase = 'riding' | 'next-is-yours' | 'arrived';

export interface RideProgress {
  /** Index in the ride sequence of the last stop reached or passed. */
  passedIndex: number;
  /** Stops still to reach, counting your own. 0 once you're there. */
  stopsToGo: number;
  /** The next stop the bus will reach (your stop when one is left). */
  nextStop: RideStop | null;
  phase: RidePhase;
  /** Rough distance left along the stop chain, metres. */
  remainingMeters: number;
}

/** Within this of a stop counts as being at it. */
export const AT_STOP_METERS = 50;
/** How far ahead of the last known stop we look; stops can't be skipped faster than this. */
const LOOKAHEAD_STOPS = 8;
/** Average feeder-bus speed including dwell, for the "about N min" estimate. */
export const RIDE_METERS_PER_MINUTE = 300;

/**
 * Stops you can ride to from `boardStopId`, in the order the bus serves
 * them. Feeder routes are mostly loops back to their hub, so on a loop the
 * stops before yours follow on (ending at the hub where the trip ends).
 */
export function rideDestinations(
  ordered: readonly RideStop[],
  boardStopId: string,
  isLoop: boolean,
): RideStop[] {
  const i = ordered.findIndex((s) => s.stopId === boardStopId);
  if (i < 0) return [];
  const after = ordered.slice(i + 1);
  if (!isLoop) return after;
  // The loop ends back at the hub (index 0); you can't ride past it.
  return ordered.length > 0 && i > 0 ? [...after, ordered[0]] : after;
}

/** The ride sequence: boarding stop, then each stop up to and including the destination. */
export function rideSequence(
  ordered: readonly RideStop[],
  boardStopId: string,
  destStopId: string,
  isLoop: boolean,
): RideStop[] {
  const board = ordered.find((s) => s.stopId === boardStopId);
  if (!board) return [];
  const dests = rideDestinations(ordered, boardStopId, isLoop);
  const j = dests.findIndex((s) => s.stopId === destStopId);
  if (j < 0) return [];
  return [board, ...dests.slice(0, j + 1)];
}

/**
 * Advances along `seq` from `lastPassed` (never backwards, so loops and GPS
 * jitter can't undo progress). The nearest stop in the look-ahead window
 * anchors the position; you've passed it once you're nearer the following
 * stop than it is.
 */
export function advanceRide(
  seq: readonly RideStop[],
  position: { lat: number; lng: number } | null,
  lastPassed: number,
): RideProgress {
  const end = seq.length - 1;
  let passed = Math.max(0, Math.min(lastPassed, end));

  if (position && end > 0) {
    let nearest = passed;
    let best = Infinity;
    const stop = Math.min(end, passed + LOOKAHEAD_STOPS);
    for (let i = passed; i <= stop; i++) {
      const d = meters(position, seq[i]);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    let reached: number;
    if (best <= AT_STOP_METERS) {
      reached = nearest;
    } else if (nearest < end && meters(position, seq[nearest + 1]) < meters(seq[nearest], seq[nearest + 1])) {
      reached = nearest; // between nearest and the next one
    } else {
      reached = nearest - 1; // still approaching nearest
    }
    passed = Math.max(passed, reached);
  }

  const stopsToGo = Math.max(0, end - passed);
  const nextStop = stopsToGo > 0 ? seq[passed + 1] : null;
  let remainingMeters = 0;
  if (stopsToGo > 0) {
    remainingMeters = position ? meters(position, seq[passed + 1]) : meters(seq[passed], seq[passed + 1]);
    for (let i = passed + 1; i < end; i++) remainingMeters += meters(seq[i], seq[i + 1]);
  }
  return {
    passedIndex: passed,
    stopsToGo,
    nextStop,
    phase: stopsToGo === 0 ? 'arrived' : stopsToGo === 1 ? 'next-is-yours' : 'riding',
    remainingMeters: Math.round(remainingMeters),
  };
}

/** Minutes left, rounded up, from {@link RideProgress.remainingMeters}. */
export function rideMinutes(remainingMeters: number): number {
  return Math.max(0, Math.ceil(remainingMeters / RIDE_METERS_PER_MINUTE));
}

/** Loop if the route's line starts and ends within ~300 m. */
export function isLoopRoute(polyline: readonly { lat: number; lng: number }[]): boolean {
  if (polyline.length < 2) return false;
  return meters(polyline[0], polyline[polyline.length - 1]) <= 300;
}

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
