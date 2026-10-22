import { haversineMeters } from "../utils/outlier.js";
import { ev, stopsNear } from "./compile.js";
import { stationIndexById, stationMembers, stopIndexById } from "./lookup.js";
import type { TransitNetwork } from "./network.js";
import type { Place } from "./plan.js";
import type { StopTime } from "./raptor.js";
import { accessWalkSeconds, DETOUR } from "./walk.js";

/** Spec §4.1: access and egress stops lie within this straight-line radius. */
export const ACCESS_MAX_METERS = 1000;
/** Spec §4.1: at most this many access (or egress) stops. */
export const ACCESS_MAX_STOPS = 25;

export interface AccessOptions {
  walkMetersPerMin: number;
  /** Straight-line radius (default {@link ACCESS_MAX_METERS}). */
  maxWalkMeters?: number;
  /** Default {@link ACCESS_MAX_STOPS}; snapped stops count. */
  maxStops?: number;
  /** Per pattern: 1 if it may be ridden (`patternMask`). */
  allowed: Uint8Array;
}

/** The stops `place` itself is: its stop, or its station's member stops. */
function snapped(net: TransitNetwork, place: Place): number[] {
  if (place.ref === undefined) return [];
  if (place.kind === "stop") {
    const s = stopIndexById(net, place.ref);
    return s >= 0 ? [s] : [];
  }
  if (place.kind === "station") {
    const st = stationIndexById(net, place.ref);
    return st >= 0 ? stationMembers(net, st) : [];
  }
  return [];
}

/**
 * The most a vehicle on pattern `p` takes from position `a` to `b` (`a < b`),
 * over its trips (`times` = `dep` or `arr`) and its windows' template.
 */
function maxLag(net: TransitNetwork, p: number, a: number, b: number, times: Int32Array): number {
  const P = net.patterns;
  let lag = -Infinity;
  for (let t = 0; t < P.tripLen[p]; t++) lag = Math.max(lag, times[ev(net, p, t, b)] - times[ev(net, p, t, a)]);
  if (P.freqLen[p] > 0) lag = Math.max(lag, P.runOffset[P.stopStart[p] + b] - P.runOffset[P.stopStart[p] + a]);
  return lag;
}

/** A chosen stop's place on one pattern, with its walk. */
interface Seat { pos: number; seconds: number }

/**
 * Spec §4.1's stops for one end, nearest first:
 * 1. The stops a stop or station place snaps to, at 0 s and 0 m. A ref the
 *    network lacks (stale) snaps to nothing.
 * 2. Then stops within `maxWalkMeters` straight line, nearest first (tie:
 *    stop index), up to `maxStops` in all. A stop serving no allowed pattern
 *    is skipped. So is one that a closer chosen stop C dominates on every
 *    allowed pattern it serves, so one bus corridor cannot crowd out the rail
 *    station behind it. With walks `sC ≤ sX`, C dominates X on pattern p
 *    when every vehicle (trip, or the windows' template) gives:
 *    - access: C upstream of X and `dep(X) − dep(C) ≤ sX − sC`. Anything
 *      caught at X is caught at C, leaving no earlier, and rides on past X.
 *    - egress: C downstream of X and `arr(C) − arr(X) ≤ sX − sC`. Anything
 *      that reaches X goes on to C, arriving no later.
 *    Otherwise X is kept: boarding (or alighting) between C and X, or a
 *    vehicle slower than the walk, can make X the better stop.
 *
 * `meters` is the walked estimate (straight line × 1.25, rounded) and
 * `seconds` its walk at `walkMetersPerMin`.
 */
function endStops(net: TransitNetwork, place: Place, o: AccessOptions, egress: boolean): StopTime[] {
  const maxStops = o.maxStops ?? ACCESS_MAX_STOPS;
  const { start, len, pattern, pos } = net.stopRoutes;
  const times = egress ? net.patterns.arr : net.patterns.dep;
  /** Chosen stops per allowed pattern. */
  const seats = new Map<number, Seat[]>();
  const dominated = (p: number, x: number, sX: number): boolean => {
    for (const c of seats.get(p) ?? []) {
      if (egress ? c.pos <= x : c.pos >= x) continue;
      const lag = egress ? maxLag(net, p, x, c.pos, times) : maxLag(net, p, c.pos, x, times);
      if (lag <= sX - c.seconds) return true;
    }
    return false;
  };
  /** True if `stop` serves an allowed pattern no chosen stop dominates it on. */
  const useful = (stop: number, seconds: number): boolean => {
    for (let j = start[stop], end = j + len[stop]; j < end; j++) {
      if (o.allowed[pattern[j]] === 1 && !dominated(pattern[j], pos[j], seconds)) return true;
    }
    return false;
  };
  const choose = (stop: number, seconds: number): void => {
    for (let j = start[stop], end = j + len[stop]; j < end; j++) {
      const p = pattern[j];
      if (o.allowed[p] !== 1) continue;
      let list = seats.get(p);
      if (!list) seats.set(p, (list = []));
      list.push({ pos: pos[j], seconds });
    }
  };

  const out: StopTime[] = [];
  const taken = new Set<number>();
  for (const stop of snapped(net, place)) {
    if (out.length >= maxStops) return out;
    out.push({ stop, seconds: 0, meters: 0 });
    taken.add(stop);
    choose(stop, 0);
  }

  const near = stopsNear(net, place.lat, place.lng, o.maxWalkMeters ?? ACCESS_MAX_METERS)
    .filter((stop) => !taken.has(stop))
    .map((stop) => ({ stop, d: haversineMeters(place, { lat: net.stops.lat[stop], lng: net.stops.lon[stop] }) }))
    .sort((a, b) => a.d - b.d || a.stop - b.stop);
  for (const { stop, d } of near) {
    if (out.length >= maxStops) break;
    const meters = Math.round(d * DETOUR);
    const seconds = accessWalkSeconds(meters, o.walkMetersPerMin);
    if (!useful(stop, seconds)) continue;
    choose(stop, seconds);
    out.push({ stop, seconds, meters });
  }
  return out;
}

/** Access stops for `from`: walk there, then board. See {@link endStops}. */
export function accessStops(net: TransitNetwork, place: Place, o: AccessOptions): StopTime[] {
  return endStops(net, place, o, false);
}

/** Egress stops for `to`: alight there, then walk. Same rules as {@link accessStops}, with the vehicle's direction reversed. */
export function egressStops(net: TransitNetwork, place: Place, o: AccessOptions): StopTime[] {
  return endStops(net, place, o, true);
}
