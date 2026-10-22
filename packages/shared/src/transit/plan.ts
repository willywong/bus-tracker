import type { VehiclePosition } from "../types/bus.js";
import { WALKING_METERS_PER_MINUTE } from "../utils/rail.js";
import { accessStops, ACCESS_MAX_METERS, egressStops } from "./access.js";
import { excludedFeeds, patternMask } from "./modes.js";
import type { FeedId, Mode, TransitNetwork } from "./network.js";
import { MAX_RIDES } from "./raptor.js";
import { RANGE_WINDOW_SEC, rangeRaptor, type RawJourney } from "./range.js";
import { rankCandidates, summarize } from "./rank.js";
import { ReconstructError, toItinerary } from "./reconstruct.js";
import { toServiceSeconds } from "./time.js";
import { sameSpot, walkOnlyCandidate } from "./walk.js";

// Spec §4.4, verbatim. `retime` is implemented in retime.ts (14/05).

/** Spec §4.4: one end of a journey. `ref` is a stop id (`kind: "stop"`) or a station slug (`"station"`). */
export interface Place { kind: "here" | "place" | "stop" | "station"; name: string; lat: number; lng: number; ref?: string }
export interface PlanQuery {
  from: Place; to: Place;
  departAt: number;                  // epoch ms (Malaysia time is handled inside)
  walkMetersPerMin: number;          // default 80 (no setting yet)
  maxWalkMeters?: number;            // default 1000
  maxRides?: number;                 // default 4
  modes?: readonly Mode[];           // default all included feeds
}
export interface LegPoint { stop?: number; name: string; lat: number; lng: number; time: number /* epoch ms */ }
export type Timing =
  | { kind: "scheduled" }
  | { kind: "headway"; headwaySec: number }
  | { kind: "live"; vehicleId: string; asOf: number; deltaSec: number };
export type Leg =
  | { kind: "walk"; from: LegPoint; to: LegPoint; meters: number; seconds: number }
  | { kind: "ride"; mode: Mode; route: number; label: string; color: string; headsign: string;
      from: LegPoint; to: LegPoint; via: LegPoint[]; timing: Timing; tripKey?: string };
export interface Itinerary {
  id: string;                        // stable hash of the leg sequence (survives re-timing)
  departAt: number; arriveAt: number;
  legs: Leg[]; rides: number; walkMeters: number;
  tags: ("fastest" | "fewer-changes" | "less-walking")[];
  warnings: ItineraryWarning[];
  previousArriveAt?: number;         // set by retime() when times moved: "Updated · was 9:12"
}
export type ItineraryWarning = "last-service" | "long-wait" | "missed-connection";
export interface LiveSnapshot {      // one entry per polled category
  byCategory: Record<string, { asOf: number; positions: VehiclePosition[] }>;
}
export interface PlanResult { itineraries: Itinerary[]; excludedFeeds: FeedId[] } // banner from excludedFeeds, even when empty
// export function plan(net: TransitNetwork, q: PlanQuery): Generator<void, PlanResult>; // yields between rounds
// export function retime(its: Itinerary[], live: LiveSnapshot, net: TransitNetwork,
//   ctx: Pick<PlanQuery, 'to' | 'walkMetersPerMin' | 'modes'>): Itinerary[];

/** The range `plan()` searches after `departAt`: 14/00's decision kept the 40-min window. */
export const PLAN_WINDOW_SEC = RANGE_WINDOW_SEC;

/**
 * Spec §4.4: up to five ranked door-to-door itineraries leaving from
 * `q.departAt`, plus the feeds left out of `net` (for the banner, even when
 * there are none). Yields between rounds; drive it in slices, or
 * {@link planSync}. `net` must be the network of `departAt`'s Malaysia date.
 *
 * Access and egress stops (14/03), a range RAPTOR over
 * {@link PLAN_WINDOW_SEC} (skipped when both ends are one spot), the walk-only
 * option, ranking (14/02), then {@link toItinerary}. A candidate whose times
 * do not replay is an engine bug and is dropped.
 */
export function* plan(net: TransitNetwork, q: PlanQuery): Generator<void, PlanResult> {
  const t0 = toServiceSeconds(net, q.departAt);
  const mpm = q.walkMetersPerMin > 0 ? q.walkMetersPerMin : WALKING_METERS_PER_MINUTE;
  const allowed = patternMask(net, q.modes);
  const o = { walkMetersPerMin: mpm, maxWalkMeters: q.maxWalkMeters ?? ACCESS_MAX_METERS, allowed };
  const access = accessStops(net, q.from, o);
  const egress = egressStops(net, q.to, o);
  const walk = walkOnlyCandidate(q.from, q.to, t0, mpm);
  const raws: RawJourney[] = sameSpot(access, egress, q)
    ? []
    : yield* rangeRaptor(net, { access, egress, t0, maxRides: q.maxRides ?? MAX_RIDES, allowed, walkMetersPerMin: mpm, windowSec: PLAN_WINDOW_SEC });
  const cands = raws.map((r) => summarize(net, r, t0));
  if (walk) cands.push(walk);
  const itineraries: Itinerary[] = [];
  for (const r of rankCandidates(cands, t0)) {
    try {
      itineraries.push(toItinerary(net, q, r));
    } catch (e) {
      if (!(e instanceof ReconstructError)) throw e;
    }
  }
  return { itineraries, excludedFeeds: excludedFeeds(net) };
}

/** {@link plan} drained in one go: tests and scripts. */
export function planSync(net: TransitNetwork, q: PlanQuery): PlanResult {
  const steps = plan(net, q);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
