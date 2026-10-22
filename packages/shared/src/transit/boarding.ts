import { ev } from "./compile.js";
import type { TransitNetwork } from "./network.js";
import type { Boarding } from "./raptor.js";

/**
 * The vehicle being ridden on a pattern: timetabled trip `trip` (`kind` 0),
 * or a turn-up-and-go run of window `window` that leaves the pattern's first
 * stop at `start` (`kind` 1). The other kind's fields are -1.
 */
export interface RideState { kind: 0 | 1; trip: number; window: number; start: number }
/** {@link earliestBoardInto}'s answer: the vehicle and its departure `dep` at the boarding position. */
export interface BoardOut extends RideState { dep: number }

/**
 * Earliest vehicle on pattern `p` leaving position `pos` at or after `t`,
 * written into `out` (no allocation); false when none does.
 *
 * - Trips: binary search on `dep` (FIFO per pattern, plan 12/03 step 8).
 * - Windows (spec §4.1): the run starts at `max(t − r, fStart) + headway/2`,
 *   valid while that is `≤ fEnd`, and leaves `pos` `r = runOffset` later. The
 *   minimum over every window keeps the answer non-decreasing in `t`, even
 *   across a window boundary or with overlapping windows.
 * - Both kinds: the earlier departure; the trip on a tie (it has a real time).
 *
 * `tripHi` limits the trip search to `[0, tripHi)`: a rider already on trip
 * `t` only cares about the earlier trips `[0, t)`.
 */
export function earliestBoardInto(
  net: TransitNetwork,
  p: number,
  pos: number,
  t: number,
  out: BoardOut,
  tripHi = net.patterns.tripLen[p],
): boolean {
  const P = net.patterns;
  let found = false;
  const trips = tripHi;
  if (trips > 0) {
    let lo = 0;
    let hi = trips;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (P.dep[ev(net, p, mid, pos)] >= t) hi = mid;
      else lo = mid + 1;
    }
    if (lo < trips) {
      found = true;
      out.kind = 0;
      out.trip = lo;
      out.window = -1;
      out.start = -1;
      out.dep = P.dep[ev(net, p, lo, pos)];
    }
  }
  const w0 = P.freqStart[p];
  const w1 = w0 + P.freqLen[p];
  if (w1 > w0) {
    const r = P.runOffset[P.stopStart[p] + pos];
    // Best run start so far; a trip found above sets the bar (a tie keeps the trip).
    let best = found ? out.dep - r : 0;
    let bestW = -1;
    for (let w = w0; w < w1; w++) {
      const start = Math.max(t - r, P.fStart[w]) + (P.fHeadway[w] >> 1);
      if (start <= P.fEnd[w] && ((!found && bestW < 0) || start < best)) {
        best = start;
        bestW = w;
      }
    }
    if (bestW >= 0) {
      found = true;
      out.kind = 1;
      out.trip = -1;
      out.window = bestW;
      out.start = best;
      out.dep = best + r;
    }
  }
  return found;
}

/** Spec §4.1's `earliestBoard(p, s, t)` shape over {@link earliestBoardInto}. Allocates: tests and tools only. */
export function earliestBoard(net: TransitNetwork, p: number, pos: number, t: number): Boarding | null {
  const out: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  if (!earliestBoardInto(net, p, pos, t, out)) return null;
  return out.kind === 0 ? { kind: "trip", trip: out.trip } : { kind: "freq", window: out.window, board: out.dep };
}

/** Departure of `b` from position `pos` of pattern `p`. A window run dwells 0 s, so this equals {@link arrAt}. */
export function depAt(net: TransitNetwork, p: number, b: RideState, pos: number): number {
  const P = net.patterns;
  return b.kind === 0 ? P.dep[ev(net, p, b.trip, pos)] : b.start + P.runOffset[P.stopStart[p] + pos];
}

/** Arrival of `b` at position `pos` of pattern `p`. */
export function arrAt(net: TransitNetwork, p: number, b: RideState, pos: number): number {
  const P = net.patterns;
  return b.kind === 0 ? P.arr[ev(net, p, b.trip, pos)] : b.start + P.runOffset[P.stopStart[p] + pos];
}
