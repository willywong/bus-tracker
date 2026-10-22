import { secondsToClockHHMM } from "../utils/gtfs-time.js";
import { earliestBoardInto, type BoardOut } from "./boarding.js";
import { ev } from "./compile.js";
import { itineraryId } from "./ids.js";
import { MODES, type TransitNetwork } from "./network.js";
import type { Itinerary, ItineraryWarning, Leg, LegPoint, Place, PlanQuery } from "./plan.js";
import { CHANGE_SEC } from "./raptor.js";
import { latestLeave, type Candidate, type Ranked } from "./rank.js";
import { serviceDayStartMs, toServiceSeconds } from "./time.js";
import { walkedMeters } from "./walk.js";

/** `'last-service'` when the next vehicle after a ride's leaves more than this later (or never). */
export const LAST_SERVICE_GAP_SEC = 3600;
/** `'long-wait'` when a ride leaves more than this after the leg before it ends. */
export const LONG_WAIT_SEC = 900;

/** A raw journey whose times do not replay forward: an engine bug. {@link plan} drops the candidate. */
export class ReconstructError extends Error {
  override name = "ReconstructError";
}

type Walk = Extract<Leg, { kind: "walk" }>;
type Ride = Extract<Leg, { kind: "ride" }>;

/**
 * A ranked candidate's legs with epoch-ms times (spec §4.4), timed forward
 * from its latest leave (14/02):
 * - access and egress walks between the places and their stops, left out at
 *   0 s (a snapped end);
 * - rides on the recorded vehicle: a trip's timetable (`scheduled`, with its
 *   `tripKey`), or the recorded window's run boarded at the clock
 *   (`headway`), with every stop in between in `via`;
 * - transfer walks, metres the straight line × 1.25;
 * - consecutive walks merged (first `from`, last `to`, summed).
 * Walk-only is one walk from `cand.leave`. Throws {@link ReconstructError}
 * when a vehicle leaves before the clock reaches it (+ `CHANGE_SEC` after a
 * ride at the same stop).
 */
export function toLegs(net: TransitNetwork, cand: Candidate, from: Place, to: Place): Leg[] {
  const day = serviceDayStartMs(net.meta.serviceDate);
  const ms = (sec: number) => day + sec * 1000;
  const placePoint = (p: Place, sec: number): LegPoint => ({ name: p.name, lat: p.lat, lng: p.lng, time: ms(sec) });
  const stopPoint = (s: number, sec: number): LegPoint => ({
    stop: s,
    name: net.stops.name[s],
    lat: net.stops.lat[s],
    lng: net.stops.lon[s],
    time: ms(sec),
  });

  const raw = cand.raw;
  if (raw === null) {
    return [{ kind: "walk", from: placePoint(from, cand.leave), to: placePoint(to, cand.arrive), meters: cand.walkMeters, seconds: cand.walkSec }];
  }

  const P = net.patterns;
  const legs: Leg[] = [];
  let t = latestLeave(net, raw);
  let rode = false;
  for (const l of raw.legs) {
    if (l.kind === "access") {
      if (l.seconds > 0) legs.push({ kind: "walk", from: placePoint(from, t), to: stopPoint(l.stop, t + l.seconds), meters: l.meters, seconds: l.seconds });
      t += l.seconds;
    } else if (l.kind === "walk") {
      const a = { lat: net.stops.lat[l.from], lng: net.stops.lon[l.from] };
      const b = { lat: net.stops.lat[l.to], lng: net.stops.lon[l.to] };
      legs.push({ kind: "walk", from: stopPoint(l.from, t), to: stopPoint(l.to, t + l.seconds), meters: Math.round(walkedMeters(a, b)), seconds: l.seconds });
      t += l.seconds;
      rode = false;
    } else {
      const p = l.pattern;
      const slot = P.stopStart[p];
      const ready = t + (rode ? CHANGE_SEC : 0);
      let board: number;
      let arrAt: (pos: number) => number;
      let timing: Ride["timing"];
      if (l.trip >= 0) {
        board = P.dep[ev(net, p, l.trip, l.boardPos)];
        arrAt = (pos) => P.arr[ev(net, p, l.trip, pos)];
        timing = { kind: "scheduled" };
      } else {
        // Spec §4.1, as earliestBoard: the run starts at max(ready − r, fStart) + headway/2.
        const w = l.window;
        const start = Math.max(ready - P.runOffset[slot + l.boardPos], P.fStart[w]) + (P.fHeadway[w] >> 1);
        if (start > P.fEnd[w]) throw new ReconstructError(`toLegs: window ${w} of pattern ${p} has ended at ${secondsToClockHHMM(ready)}`);
        board = start + P.runOffset[slot + l.boardPos];
        arrAt = (pos) => start + P.runOffset[slot + pos];
        timing = { kind: "headway", headwaySec: P.fHeadway[w] };
      }
      const r = P.route[p];
      const stopAt = (pos: number) => P.stops[slot + pos];
      if (board < ready) {
        throw new ReconstructError(
          `toLegs: ${net.routes.label[r]} boards at ${secondsToClockHHMM(board)} at ${net.stops.id[stopAt(l.boardPos)]}, ready at ${secondsToClockHHMM(ready)}`,
        );
      }
      const via: LegPoint[] = [];
      for (let pos = l.boardPos + 1; pos < l.alightPos; pos++) via.push(stopPoint(stopAt(pos), arrAt(pos)));
      const alight = arrAt(l.alightPos);
      const ride: Ride = {
        kind: "ride",
        mode: MODES[net.routes.mode[r]],
        route: r,
        label: net.routes.label[r],
        color: net.routes.color[r],
        headsign: P.headsign[p],
        from: stopPoint(stopAt(l.boardPos), board),
        to: stopPoint(stopAt(l.alightPos), alight),
        via,
        timing,
      };
      if (l.trip >= 0) ride.tripKey = P.tripKey[P.tripStart[p] + l.trip];
      legs.push(ride);
      t = alight;
      rode = true;
    }
  }
  const e = raw.egress;
  if (e.seconds > 0) legs.push({ kind: "walk", from: stopPoint(e.stop, t), to: placePoint(to, t + e.seconds), meters: e.meters, seconds: e.seconds });
  return mergeWalks(legs);
}

/** Consecutive walks as one: the first `from`, the last `to`, metres and seconds summed. */
function mergeWalks(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const l of legs) {
    const prev = out[out.length - 1];
    if (l.kind === "walk" && prev?.kind === "walk") {
      out[out.length - 1] = { kind: "walk", from: prev.from, to: l.to, meters: prev.meters + l.meters, seconds: prev.seconds + l.seconds } satisfies Walk;
    } else {
      out.push(l);
    }
  }
  return out;
}

/**
 * Earliest departure after `afterSec` from a ride leg's boarding stop on any
 * pattern of its route and headsign that goes on to its alighting stop, or
 * null. A loop pattern (T816) is tried at every visit of the boarding stop.
 */
function nextDeparture(net: TransitNetwork, leg: Ride, afterSec: number): number | null {
  const P = net.patterns;
  const { start, len, pattern, pos } = net.stopRoutes;
  const from = leg.from.stop!;
  const to = leg.to.stop!;
  const out: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  let best: number | null = null;
  for (let j = start[from], end = j + len[from]; j < end; j++) {
    const p = pattern[j];
    if (P.route[p] !== leg.route || P.headsign[p] !== leg.headsign) continue;
    const slot = P.stopStart[p];
    let goesOn = false;
    for (let q = pos[j] + 1; q < P.stopLen[p] && !goesOn; q++) goesOn = P.stops[slot + q] === to;
    if (!goesOn || !earliestBoardInto(net, p, pos[j], afterSec, out)) continue;
    if (best === null || out.dep < best) best = out.dep;
  }
  return best;
}

/**
 * Spec §4.4's planner warnings for `legs`, each once, in this order:
 * - `'last-service'`: after some ride's vehicle, the next on its route and
 *   headsign leaves more than {@link LAST_SERVICE_GAP_SEC} later, or never
 *   (the next trip; for a headway leg, the window's end decides);
 * - `'long-wait'`: some ride leaves more than {@link LONG_WAIT_SEC} after the
 *   leg before it ends. Under latest leave the first ride's wait is ≤ 60 s,
 *   so in practice this flags transfers.
 * `'missed-connection'` is only set by `retime` (14/05).
 */
export function legWarnings(net: TransitNetwork, legs: readonly Leg[]): ItineraryWarning[] {
  let last = false;
  let wait = false;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.kind !== "ride") continue;
    if (i > 0 && l.from.time - legs[i - 1].to.time > LONG_WAIT_SEC * 1000) wait = true;
    if (!last) {
      const board = toServiceSeconds(net, l.from.time);
      const next = nextDeparture(net, l, board + 1);
      last = next === null || next - board > LAST_SERVICE_GAP_SEC;
    }
  }
  const out: ItineraryWarning[] = [];
  if (last) out.push("last-service");
  if (wait) out.push("long-wait");
  return out;
}

/**
 * A ranked candidate as spec §4.4's {@link Itinerary}: its {@link toLegs},
 * totals and warnings from those legs, and the ranking's tags.
 * `previousArriveAt` is left for `retime`.
 */
export function toItinerary(net: TransitNetwork, q: PlanQuery, r: Ranked): Itinerary {
  const legs = toLegs(net, r.cand, q.from, q.to);
  let rides = 0;
  let walkMeters = 0;
  for (const l of legs) {
    if (l.kind === "ride") rides++;
    else walkMeters += l.meters;
  }
  return {
    id: itineraryId(net, legs),
    departAt: legs[0].from.time,
    arriveAt: legs[legs.length - 1].to.time,
    legs,
    rides,
    walkMeters,
    tags: [...r.tags],
    warnings: legWarnings(net, legs),
  };
}
