import type { VehiclePosition } from "../types/bus.js";
import { rawGtfsId } from "../utils/categories.js";
import { computeEta } from "../utils/eta.js";
import { dropImplausibleFixes, MAX_FIX_AGE_MS, resolveRouteAlias } from "../utils/realtime.js";
import type { LatLng } from "../utils/route.js";
import { FEED_IDS, FEED_INFO, type TransitNetwork } from "./network.js";
import type { Itinerary, Leg, LiveSnapshot } from "./plan.js";

/** Spec §4.3: only a first bus leg boarding within this of "now" is re-timed. */
export const LIVE_HORIZON_MS = 60 * 60_000;
/** Spec §4.3: a live bus is caught only if it reaches the stop this long after you can. */
export const CATCH_MARGIN_MS = 60_000;
/** A larger |delta| on a timetabled leg means a different run: ignored. */
export const MAX_LIVE_SHIFT_SEC = 20 * 60;
/** `previousArriveAt` ("Updated · was 9:12") is set only when `arriveAt` moves at least this much. */
export const UPDATED_MIN_SHIFT_MS = 60_000;

/** The two bus categories with a live feed that the routed network carries. */
export type PlannerLiveCategory = "rapid-bus-mrtfeeder" | "rapid-bus-kl";
/** Fixed order of {@link plannerRealtimeRoutes}' result. */
const LIVE_CATEGORIES: readonly PlannerLiveCategory[] = ["rapid-bus-mrtfeeder", "rapid-bus-kl"];

type Ride = Extract<Leg, { kind: "ride" }>;

/**
 * "Now" for a {@link LiveSnapshot}: the newest `asOf` over its categories,
 * or null when it has none. `retime` has no clock of its own, so it stays pure.
 */
export function liveNow(live: LiveSnapshot): number | null {
  let now: number | null = null;
  for (const c of Object.values(live.byCategory)) if (now === null || c.asOf > now) now = c.asOf;
  return now;
}

/**
 * The bus category whose live feed carries route `r`, or null. Rail and KTM
 * have none: rail is never live (spec §4.3).
 */
export function liveCategoryOf(net: TransitNetwork, r: number): PlannerLiveCategory | null {
  const c = FEED_INFO[FEED_IDS[net.routes.feed[r]]]?.category;
  return c === "rapid-bus-mrtfeeder" || c === "rapid-bus-kl" ? c : null;
}

/**
 * Index of the itinerary's first bus ride (`bus` or `feeder`) if it boards
 * within {@link LIVE_HORIZON_MS} of `now`, else -1. Only that leg is ever live.
 */
export function firstLiveLeg(legs: readonly Leg[], now: number): number {
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.kind !== "ride" || (l.mode !== "bus" && l.mode !== "feeder")) continue;
    return l.from.time - now <= LIVE_HORIZON_MS ? i : -1;
  }
  return -1;
}

/** `rawGtfsId(route_id) → label` and `label → label`: the route as a feed may name it. */
function routeAliases(net: TransitNetwork, r: number): Map<string, string> {
  const label = net.routes.label[r];
  return new Map([
    [rawGtfsId(net.routes.id[r]), label],
    [label, label],
  ]);
}

/**
 * A pattern of the ride's route and headsign that visits `from.stop` and
 * later `to.stop`, with those positions. FIFO siblings share the two stops,
 * so any match works; one whose stops in between are the leg's `via` is
 * preferred. A loop pattern (T816) is tried at each visit of `from.stop`.
 */
export function findPattern(net: TransitNetwork, leg: Ride): { pattern: number; boardPos: number; alightPos: number } | null {
  const P = net.patterns;
  const { start, len, pattern, pos } = net.stopRoutes;
  const from = leg.from.stop;
  const to = leg.to.stop;
  if (from === undefined || to === undefined) return null;
  let any: { pattern: number; boardPos: number; alightPos: number } | null = null;
  for (let j = start[from], end = j + len[from]; j < end; j++) {
    const p = pattern[j];
    if (P.route[p] !== leg.route || P.headsign[p] !== leg.headsign) continue;
    const slot = P.stopStart[p];
    let alightPos = -1;
    for (let q = pos[j] + 1; q < P.stopLen[p] && alightPos < 0; q++) if (P.stops[slot + q] === to) alightPos = q;
    if (alightPos < 0) continue;
    const hit = { pattern: p, boardPos: pos[j], alightPos };
    if (alightPos - pos[j] - 1 === leg.via.length && leg.via.every((v, k) => v.stop === P.stops[slot + pos[j] + 1 + k])) return hit;
    any ??= hit;
  }
  return any;
}

/** A live vehicle's expected boarding at a ride's first stop. */
export interface LiveBoarding {
  vehicleId: string;
  /** The fix the estimate is from (`observedAt`), epoch ms. */
  asOf: number;
  /** Expected arrival at the boarding stop, epoch ms. */
  board: number;
}

/**
 * The live bus a rider who can be at `ride.from` by `reachAt` would board, or
 * null (spec §4.3):
 * 1. the ride's category in `live`, skipped when missing or older than
 *    `MAX_FIX_AGE_MS` against `now`;
 * 2. its vehicles on the ride's route (`resolveRouteAlias` over the raw GTFS
 *    route id and the label), minus implausible fixes;
 * 3. `computeEta` over the pattern's stop chain as the polyline (`loop` when
 *    it ends where it starts), so `board = observedAt + minutesToStop`;
 * 4. accepted when `board ≥ reachAt + CATCH_MARGIN_MS` and, on a timetabled
 *    leg, `|board − from.time| ≤ MAX_LIVE_SHIFT_SEC`. A nearer bus that fails
 *    this is set aside and the next approaching one is tried.
 */
export function liveBoarding(net: TransitNetwork, ride: Ride, live: LiveSnapshot, now: number, reachAt: number): LiveBoarding | null {
  const category = liveCategoryOf(net, ride.route);
  if (category === null) return null;
  const feed = live.byCategory[category];
  if (!feed || now - feed.asOf > MAX_FIX_AGE_MS) return null;
  const aliases = routeAliases(net, ride.route);
  const label = net.routes.label[ride.route];
  let vehicles: VehiclePosition[] = dropImplausibleFixes(
    feed.positions.filter((v) => resolveRouteAlias(v.routeId, aliases) === label),
    now,
  );
  if (vehicles.length === 0) return null;
  const found = findPattern(net, ride);
  if (found === null) return null;

  const P = net.patterns;
  const slot = P.stopStart[found.pattern];
  const n = P.stopLen[found.pattern];
  const at = (s: number): LatLng => ({ lat: net.stops.lat[s], lng: net.stops.lon[s] });
  const polyline: LatLng[] = [];
  const others = new Set<number>();
  const boardStop = P.stops[slot + found.boardPos];
  for (let q = 0; q < n; q++) {
    const s = P.stops[slot + q];
    polyline.push(at(s));
    if (s !== boardStop) others.add(s);
  }
  const loop = n > 1 && P.stops[slot] === P.stops[slot + n - 1];
  const stop = at(boardStop);
  const intermediateCandidates = [...others].map(at);

  while (vehicles.length > 0) {
    const eta = computeEta({ vehicles, stop, polyline, intermediateCandidates, loop });
    if (eta.minutesToStop === null || eta.vehicleId === null) return null;
    const id = eta.vehicleId;
    const v = vehicles.find((x) => x.vehicleId === id)!;
    const board = v.observedAt + eta.minutesToStop * 60_000;
    const caught = board >= reachAt + CATCH_MARGIN_MS;
    const sameRun = ride.timing.kind !== "scheduled" || Math.abs(board - ride.from.time) <= MAX_LIVE_SHIFT_SEC * 1000;
    if (caught && sameRun) return { vehicleId: id, asOf: v.observedAt, board };
    vehicles = vehicles.filter((x) => x.vehicleId !== id);
  }
  return null;
}

/** One live bus category the planner needs, in `buildRealtimePlan`'s per-category shape. */
export interface PlannerFeedRoutes {
  category: PlannerLiveCategory;
  /** Realtime `trip.route_id` (raw GTFS id, or the label) → route label. */
  aliases: Map<string, string>;
  /** Route labels, in first-seen order. */
  routes: string[];
}

/**
 * The live feeds `retime` could use for `its`: each itinerary's first bus leg
 * (the {@link firstLiveLeg} rule against `now`), grouped by category. Klang
 * Valley has two live bus categories, so the result has at most two entries,
 * feeder first.
 */
export function plannerRealtimeRoutes(its: readonly Itinerary[], net: TransitNetwork, now: number): PlannerFeedRoutes[] {
  const by = new Map<PlannerLiveCategory, PlannerFeedRoutes>();
  for (const it of its) {
    const i = firstLiveLeg(it.legs, now);
    if (i < 0) continue;
    const r = (it.legs[i] as Ride).route;
    const category = liveCategoryOf(net, r);
    if (category === null) continue;
    let e = by.get(category);
    if (!e) by.set(category, (e = { category, aliases: new Map(), routes: [] }));
    for (const [k, v] of routeAliases(net, r)) e.aliases.set(k, v);
    const label = net.routes.label[r];
    if (!e.routes.includes(label)) e.routes.push(label);
  }
  const out = LIVE_CATEGORIES.flatMap((c) => (by.has(c) ? [by.get(c)!] : []));
  if (out.length > LIVE_CATEGORIES.length) throw new Error("plannerRealtimeRoutes: more than two live bus categories");
  return out;
}
