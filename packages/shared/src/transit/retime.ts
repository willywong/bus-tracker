import { WALKING_METERS_PER_MINUTE } from "../utils/rail.js";
import { egressStops } from "./access.js";
import { earliestBoardInto, type BoardOut } from "./boarding.js";
import { itineraryId } from "./ids.js";
import { findPattern, firstLiveLeg, liveBoarding, liveNow, UPDATED_MIN_SHIFT_MS } from "./live.js";
import { patternMask } from "./modes.js";
import type { TransitNetwork } from "./network.js";
import type { Itinerary, Leg, LegPoint, LiveSnapshot, Place, PlanQuery } from "./plan.js";
import { CHANGE_SEC, MAX_RIDES } from "./raptor.js";
import { rangeRaptor, type RawJourney } from "./range.js";
import { summarize } from "./rank.js";
import { legWarnings, ReconstructError, toLegs } from "./reconstruct.js";
import { serviceDayStartMs, toEpochMs } from "./time.js";

type Walk = Extract<Leg, { kind: "walk" }>;
type Ride = Extract<Leg, { kind: "ride" }>;
/** What `retime` needs of the query that produced its itineraries. */
export type RetimeContext = Pick<PlanQuery, "to" | "walkMetersPerMin" | "modes">;

/**
 * Spec §4.3 / §4.4: `plan()`'s itineraries re-timed with live bus positions.
 *
 * `its` must be `plan()` output, never an earlier `retime` result: the caller
 * keeps the scheduled list and its query, and passes
 * `ctx = { to, walkMetersPerMin, modes }` from that query. "Now" is
 * {@link liveNow}; an empty snapshot returns `its` itself. For each itinerary:
 * 1. Its first `bus`/`feeder` ride boarding within `LIVE_HORIZON_MS`; none
 *    (or rail only) → unchanged. Rail is never live.
 * 2. You can be at its stop at `reachAt`: the previous leg's end; after an
 *    access walk, `max(now, walk start) + walk`; with no leg before it, now.
 * 3. {@link liveBoarding} picks the live bus; none → unchanged.
 * 4. That ride shifts by `delta` (whole seconds) and becomes
 *    `{ kind: 'live', vehicleId, asOf, deltaSec }`. Legs before it stay.
 * 5. Later legs follow from its new arrival: a walk starts when you get there,
 *    a headway ride re-boards (+ `CHANGE_SEC` after a ride), and a timetabled
 *    ride that is still caught ends the shift. A missed one (or a headway
 *    window that has closed) is a broken transfer.
 * 6. A broken transfer re-plans the rest once from that ride's stop
 *    ({@link planTail}); with no tail, the rest is left scheduled and the
 *    itinerary gets `'missed-connection'`.
 * 7. `previousArriveAt` = the planned `arriveAt` when it moved by at least
 *    `UPDATED_MIN_SHIFT_MS`.
 * `id`, `rides`, `walkMeters` and `warnings` are recomputed from the new legs
 * (same legs → same `id`). Order and `tags` stay as planned.
 */
export function retime(its: Itinerary[], live: LiveSnapshot, net: TransitNetwork, ctx: RetimeContext): Itinerary[] {
  const now = liveNow(live);
  if (now === null) return its;
  return its.map((it) => retimeOne(it, live, net, ctx, now));
}

function retimeOne(it: Itinerary, live: LiveSnapshot, net: TransitNetwork, ctx: RetimeContext, now: number): Itinerary {
  const i = firstLiveLeg(it.legs, now);
  if (i < 0) return it;
  const ride = it.legs[i] as Ride;
  const hit = liveBoarding(net, ride, live, now, reachAt(it.legs, i, now));
  if (hit === null) return it;

  const delta = Math.round((hit.board - ride.from.time) / 1000) * 1000;
  const shift = (p: LegPoint): LegPoint => ({ ...p, time: p.time + delta });
  const legs = it.legs.slice();
  legs[i] = {
    ...ride,
    from: shift(ride.from),
    to: shift(ride.to),
    via: ride.via.map(shift),
    timing: { kind: "live", vehicleId: hit.vehicleId, asOf: hit.asOf, deltaSec: delta / 1000 },
  };

  let ready = legs[i].to.time;
  let rode = true;
  let broken = -1;
  let brokenReady = 0;
  for (let j = i + 1; j < legs.length; j++) {
    const l = legs[j];
    if (l.kind === "walk") {
      legs[j] = { ...l, from: { ...l.from, time: ready }, to: { ...l.to, time: ready + l.seconds * 1000 } } satisfies Walk;
      ready = legs[j].to.time;
      rode = false;
      continue;
    }
    const need = ready + (rode ? CHANGE_SEC * 1000 : 0);
    if (l.timing.kind === "headway") {
      const again = reboardHeadway(net, l, need);
      if (again !== null) {
        legs[j] = again;
        ready = again.to.time;
        rode = true;
        continue;
      }
    } else if (need <= l.from.time) {
      break;
    }
    broken = j;
    brokenReady = need;
    break;
  }

  let missed = false;
  if (broken >= 0) {
    let ridesSoFar = 0;
    for (let j = 0; j < broken; j++) if (legs[j].kind === "ride") ridesSoFar++;
    const tail = planTail(net, (legs[broken] as Ride).from.stop!, brokenReady, ctx, MAX_RIDES - ridesSoFar);
    if (tail === null) missed = true;
    else legs.splice(broken, legs.length - broken, ...tail);
  }

  let rides = 0;
  let walkMeters = 0;
  for (const l of legs) {
    if (l.kind === "ride") rides++;
    else walkMeters += l.meters;
  }
  const warnings = legWarnings(net, legs);
  if (missed) warnings.push("missed-connection");
  const out: Itinerary = {
    ...it,
    id: itineraryId(net, legs),
    departAt: legs[0].from.time,
    arriveAt: legs[legs.length - 1].to.time,
    legs,
    rides,
    walkMeters,
    tags: [...it.tags],
    warnings,
  };
  if (Math.abs(out.arriveAt - it.arriveAt) >= UPDATED_MIN_SHIFT_MS) out.previousArriveAt = it.arriveAt;
  return out;
}

/** When you can be at `legs[i]`'s stop (spec §4.3 "after you can"). */
function reachAt(legs: readonly Leg[], i: number, now: number): number {
  if (i === 0) return now;
  const prev = legs[i - 1];
  if (i === 1 && prev.kind === "walk") return Math.max(now, prev.from.time) + prev.seconds * 1000;
  return prev.to.time;
}

/**
 * A headway ride boarded again from `readyMs` on its window run (spec §4.1:
 * `max(t − r, fStart) + headway/2`), every time rebuilt; null when no window
 * of its pattern still runs.
 */
function reboardHeadway(net: TransitNetwork, ride: Ride, readyMs: number): Ride | null {
  const found = findPattern(net, ride);
  if (found === null) return null;
  const P = net.patterns;
  const p = found.pattern;
  const slot = P.stopStart[p];
  const t = Math.ceil((readyMs - serviceDayStartMs(net.meta.serviceDate)) / 1000);
  const out: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  // tripHi 0: windows only, so the leg stays a headway leg.
  if (!earliestBoardInto(net, p, found.boardPos, t, out, 0)) return null;
  const at = (pos: number): LegPoint => {
    const s = P.stops[slot + pos];
    return { stop: s, name: net.stops.name[s], lat: net.stops.lat[s], lng: net.stops.lon[s], time: toEpochMs(net, out.start + P.runOffset[slot + pos]) };
  };
  const via: LegPoint[] = [];
  for (let pos = found.boardPos + 1; pos < found.alightPos; pos++) via.push(at(pos));
  return {
    ...ride,
    from: { ...ride.from, time: at(found.boardPos).time },
    to: { ...ride.to, time: at(found.alightPos).time },
    via,
    timing: { kind: "headway", headwaySec: P.fHeadway[out.window] },
  };
}

/**
 * The rest of a journey after a broken transfer: one RAPTOR run (window 0)
 * from `stop`, ready at `readyMs`, to `ctx.to`'s egress stops at
 * `ctx.walkMetersPerMin` over `ctx.modes`, with at most `maxRides` rides.
 * The earliest arrival (then fewer rides) as legs, or null when none.
 *
 * It shares the network's RAPTOR workspace with `plan()`: do not call
 * `retime` while a `plan()` generator on the same network is suspended.
 */
export function planTail(net: TransitNetwork, stop: number, readyMs: number, ctx: RetimeContext, maxRides: number): Leg[] | null {
  if (maxRides < 1) return null;
  const mpm = ctx.walkMetersPerMin > 0 ? ctx.walkMetersPerMin : WALKING_METERS_PER_MINUTE;
  const allowed = patternMask(net, ctx.modes);
  const egress = egressStops(net, ctx.to, { walkMetersPerMin: mpm, allowed });
  if (egress.length === 0) return null;
  const t0 = Math.ceil((readyMs - serviceDayStartMs(net.meta.serviceDate)) / 1000);
  const steps = rangeRaptor(net, { access: [{ stop, seconds: 0, meters: 0 }], egress, t0, windowSec: 0, maxRides, allowed, walkMetersPerMin: mpm });
  let step = steps.next();
  while (!step.done) step = steps.next();
  let best: RawJourney | null = null;
  for (const raw of step.value) if (best === null || raw.arrive < best.arrive || (raw.arrive === best.arrive && raw.rides < best.rides)) best = raw;
  if (best === null) return null;
  const from: Place = { kind: "stop", name: net.stops.name[stop], lat: net.stops.lat[stop], lng: net.stops.lon[stop], ref: net.stops.id[stop] };
  try {
    return toLegs(net, summarize(net, best, t0), from, ctx.to);
  } catch (e) {
    if (e instanceof ReconstructError) return null;
    throw e;
  }
}
