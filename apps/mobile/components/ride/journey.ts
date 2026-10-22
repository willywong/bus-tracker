import {
  HEADWAY_ONLY_MAX_SEC,
  itineraryId,
  retime,
  type Itinerary,
  type LatLng,
  type Leg,
  type LegPoint,
  type LiveSnapshot,
  type RetimeContext,
  type TransitNetwork,
} from '@bus-tracker/shared';

import type { BusActivityProps } from '@/activities/BusArrivalActivity';
import { railHeadsign } from '@/components/itinerary/model';
import { formatStopName } from '@/components/map/format';
import { mins, type HeroValue } from '@/components/trip/model';

import { advanceRide, AT_STOP_METERS, type RideStop } from './model';

/**
 * Go mode (spec §8, 15/06): an itinerary followed leg by leg. Which leg
 * you're on and how far along it, from your position and the clock; the
 * Live Activity's props and the sheet's copy for it; how far you are from
 * the route. Pure, so the rules run under `tsx --test`.
 */

type Ride = Extract<Leg, { kind: 'ride' }>;

export type JourneyPhase = 'walking' | 'waiting' | 'riding' | 'next-is-yours' | 'leg-done' | 'arrived';

export interface JourneyProgress {
  legIndex: number;
  phase: JourneyPhase;
  /** Within the current leg's stop sequence (`legSequence`). */
  passedIndex: number;
  /** Ride legs: stops still to reach, counting the alight stop. Null on a walk. */
  stopsToGo: number | null;
  /** Progress from the clock (rail, or no position): say "about". */
  approximate: boolean;
  nextStop: RideStop | null;
  /** When the current leg is due to end (its `to.time`), epoch ms. */
  legEndsAt: number;
}

/** A walk shorter than this is a snap to the stop (as the chips and the timeline): done at once. */
const SNAP_WALK_SEC = 30;
/** With no position, a walk counts as done this long after it was due to end. */
export const WALK_GRACE_MS = 2 * 60_000;
/** On a bus leg, still this close to the boarding stop (and not past it) is waiting. */
const WAIT_RADIUS_M = 100;
/** A live time older than this is shown as scheduled: never a frozen "live". */
export const LIVE_FRESH_MS = 3 * 60_000;
/** Further than this from the route is off it (spec §8)... */
export const OFF_ROUTE_METERS = 400;
/** ...for at least this long, so one wild fix doesn't count. */
export const OFF_ROUTE_CONFIRM_MS = 30_000;

const isBus = (l: Ride) => l.mode === 'bus' || l.mode === 'feeder';
const isRail = (l: Ride) => !isBus(l);
const isSnap = (l: Leg) => l.kind === 'walk' && l.seconds < SNAP_WALK_SEC;
const minutesUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / 60_000));
const stopsLabel = (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`;
const everyMinutes = (headwaySec: number) => Math.max(1, Math.round(headwaySec / 60));

/** The leg's stops in order: from, the stops passed on the way, to. Bus stop names display-cased. */
export function legSequence(leg: Leg): RideStop[] {
  const pts = leg.kind === 'ride' ? [leg.from, ...leg.via, leg.to] : [leg.from, leg.to];
  const bus = leg.kind === 'ride' && isBus(leg);
  return pts.map((p, i) => toStop(p, bus ? formatStopName(p.name) : p.name, i));
}

function toStop(p: LegPoint, name: string, i: number): RideStop {
  return { stopId: p.stop != null ? String(p.stop) : `p${i}`, name, lat: p.lat, lng: p.lng };
}

/**
 * A leg end's display name: bus stops display-cased (as the timeline), rail
 * and places as they are. A walk's end takes the case of the ride it meets.
 */
export function pointName(it: Itinerary, i: number, end: 'from' | 'to'): string {
  const l = it.legs[i];
  if (!l) return '';
  const p = l[end];
  const adj = l.kind === 'ride' ? l : end === 'to' ? it.legs[i + 1] : it.legs[i - 1];
  return adj?.kind === 'ride' && isBus(adj) ? formatStopName(p.name) : p.name;
}

/** The first leg at or after `i` that isn't a snap walk; `legs.length` when none. */
function nextLeg(it: Itinerary, i: number): number {
  while (i < it.legs.length && isSnap(it.legs[i])) i++;
  return i;
}

const isLastLeg = (it: Itinerary, i: number) => nextLeg(it, i + 1) >= it.legs.length;

/** The next ride after leg `i`, or null. */
function rideAfter(it: Itinerary, i: number): Ride | null {
  for (let j = i + 1; j < it.legs.length; j++) {
    const l = it.legs[j];
    if (l.kind === 'ride') return l;
  }
  return null;
}

/**
 * One step of the journey, on each fix and on a timer:
 * - **Walk:** done within `AT_STOP_METERS` of its end, or `WALK_GRACE_MS`
 *   after its end time with no position. A walk into a rail leg also ends by
 *   the clock (stations are where GPS fails, and rail runs by the clock). A
 *   snap walk (under 30 s) is done at once.
 * - **Bus:** `advanceRide` over the leg's stops (`position` is your phone's
 *   fix, or the live bus's once boarded). With no position it goes by the
 *   clock, as rail does, and says "about".
 * - **Rail:** the last stop whose time has passed, ignoring GPS. Always "about".
 * - A ride is `waiting` until it leaves the boarding stop, then `riding`,
 *   then `next-is-yours` with one stop left (`advanceRide`'s rule).
 * A completed leg reports `leg-done` once (`arrived` when it's the last);
 * the next step moves to the following leg. Never goes backwards.
 */
export function advanceJourney(
  it: Itinerary,
  prev: JourneyProgress | null,
  position: LatLng | null,
  now: number,
): JourneyProgress {
  const n = it.legs.length;
  if (prev?.phase === 'arrived') return prev;
  let i: number;
  let passed = 0;
  if (!prev) i = nextLeg(it, 0);
  else if (prev.phase === 'leg-done') i = nextLeg(it, prev.legIndex + 1);
  else {
    // A retime can shorten the legs; never past the last one.
    i = Math.min(prev.legIndex, n - 1);
    passed = prev.passedIndex;
  }
  if (n === 0) return { legIndex: 0, phase: 'arrived', passedIndex: 0, stopsToGo: null, approximate: false, nextStop: null, legEndsAt: now };
  if (i >= n) return completed(it, n - 1, true, false);
  return evaluate(it, i, passed, position, now);
}

function completed(it: Itinerary, i: number, last: boolean, approximate: boolean): JourneyProgress {
  const leg = it.legs[i];
  return {
    legIndex: i,
    phase: last ? 'arrived' : 'leg-done',
    passedIndex: legSequence(leg).length - 1,
    stopsToGo: leg.kind === 'ride' ? 0 : null,
    approximate,
    nextStop: null,
    legEndsAt: leg.to.time,
  };
}

function evaluate(it: Itinerary, i: number, lastPassed: number, position: LatLng | null, now: number): JourneyProgress {
  const leg = it.legs[i];
  const last = isLastLeg(it, i);

  if (leg.kind === 'walk') {
    const next = it.legs[i + 1];
    const byClock = now >= leg.to.time + WALK_GRACE_MS && (!position || (next?.kind === 'ride' && isRail(next)));
    const there = position != null && meters(position, leg.to) <= AT_STOP_METERS;
    if (isSnap(leg) || there || byClock) return completed(it, i, last, !there);
    return {
      legIndex: i,
      phase: 'walking',
      passedIndex: 0,
      stopsToGo: null,
      approximate: !position,
      nextStop: toStop(leg.to, pointName(it, i, 'to'), 1),
      legEndsAt: leg.to.time,
    };
  }

  const seq = legSequence(leg);
  const end = seq.length - 1;
  const byClock = isRail(leg) || !position;
  let passed: number;
  if (byClock) {
    const pts = [leg.from, ...leg.via, leg.to];
    passed = Math.max(0, Math.min(lastPassed, end));
    while (passed < end && pts[passed + 1].time <= now) passed++;
  } else {
    passed = advanceRide(seq, position, lastPassed).passedIndex;
  }
  const stopsToGo = end - passed;
  if (stopsToGo <= 0) return completed(it, i, last, byClock);
  const waiting = passed === 0 && (byClock ? now < leg.from.time : meters(position!, seq[0]) <= WAIT_RADIUS_M);
  return {
    legIndex: i,
    phase: waiting ? 'waiting' : stopsToGo === 1 ? 'next-is-yours' : 'riding',
    passedIndex: passed,
    stopsToGo,
    approximate: byClock,
    nextStop: seq[passed + 1] ?? null,
    legEndsAt: leg.to.time,
  };
}

/**
 * Metres from `position` to the nearest segment of any of `paths` (a lone
 * point counts as itself). Infinity with no paths. Flat-earth over a few km.
 */
export function offRouteMeters(position: LatLng, paths: readonly (readonly LatLng[])[]): number {
  const ky = 110_540;
  const kx = 111_320 * Math.cos((position.lat * Math.PI) / 180);
  const xy = (p: LatLng) => [(p.lng - position.lng) * kx, (p.lat - position.lat) * ky] as const;
  let best = Infinity;
  for (const path of paths) {
    if (path.length === 1) {
      const [x, y] = xy(path[0]);
      best = Math.min(best, Math.hypot(x, y));
      continue;
    }
    for (let k = 0; k + 1 < path.length; k++) {
      const [ax, ay] = xy(path[k]);
      const [bx, by] = xy(path[k + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      // The point nearest the origin (your position) on a→b.
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/**
 * Off route once every reading for `OFF_ROUTE_CONFIRM_MS` has been further
 * than `OFF_ROUTE_METERS`: `since` is when that began, null while on route.
 */
export function offRouteStep(since: number | null, distance: number, now: number): { since: number | null; off: boolean } {
  if (!(distance > OFF_ROUTE_METERS)) return { since: null, off: false };
  const s = since ?? now;
  return { since: s, off: now - s >= OFF_ROUTE_CONFIRM_MS };
}

/**
 * The route from leg `from` on, as lines to measure against: walks along
 * Apple's path when one was loaded (`walkPaths`, by leg index), rides
 * stop to stop.
 */
export function journeyPaths(
  it: Itinerary,
  from: number,
  walkPaths?: Readonly<Record<number, readonly LatLng[]>>,
): LatLng[][] {
  const out: LatLng[][] = [];
  for (let i = Math.max(0, from); i < it.legs.length; i++) {
    const l = it.legs[i];
    const ends = (a: LegPoint, b: LegPoint, mid: readonly LatLng[]) =>
      [a, ...mid, b].map((p) => ({ lat: p.lat, lng: p.lng }));
    if (l.kind === 'walk') out.push(ends(l.from, l.to, walkPaths?.[i] ?? []));
    else out.push(ends(l.from, l.to, l.via));
  }
  return out;
}

/**
 * Live only while it's true: a live leg whose fix is older than
 * `LIVE_FRESH_MS`, or whose feed isn't polled (`liveSkipped`), reads as
 * scheduled. Same object when nothing changes.
 */
export function honestTiming(it: Itinerary, now: number, liveSkipped: boolean): Itinerary {
  let changed = false;
  const legs = it.legs.map((l): Leg => {
    if (l.kind !== 'ride' || l.timing.kind !== 'live') return l;
    if (!liveSkipped && now - l.timing.asOf <= LIVE_FRESH_MS) return l;
    changed = true;
    return { ...l, timing: { kind: 'scheduled' } };
  });
  return changed ? { ...it, legs } : it;
}

/**
 * The leg retiming starts from: the current leg until you've boarded it,
 * then the one after. Done legs and the ride you're on keep their times.
 */
export function retimeFrom(p: JourneyProgress): number {
  return p.phase === 'walking' || p.phase === 'waiting' ? p.legIndex : p.legIndex + 1;
}

/**
 * Re-times the journey with live positions (spec §4.4) from leg `from` on.
 * `base` is the itinerary as started (or the last re-planned tail adopted):
 * `retime` always starts from it, never from its own output. Legs before
 * `from` stay exactly as `current` has them. `previousArriveAt` is the
 * arrival when Go started, once it has moved a minute or more. Returns
 * `current` itself when nothing could be re-timed.
 */
export function retimeJourney(
  base: Itinerary,
  current: Itinerary,
  from: number,
  live: LiveSnapshot,
  net: TransitNetwork,
  ctx: RetimeContext,
  startedArriveAt: number,
): Itinerary {
  from = Math.max(0, from);
  if (from >= base.legs.length || from > current.legs.length) return current;
  const tailLegs = base.legs.slice(from);
  const tail: Itinerary = { ...base, legs: tailLegs, departAt: tailLegs[0].from.time };
  delete tail.previousArriveAt;
  const [out] = retime([tail], live, net, ctx);
  // The same object back: no live data, or no live leg left.
  if (!out || out === tail) return current;
  const legs = [...current.legs.slice(0, from), ...out.legs];
  let rides = 0;
  let walkMeters = 0;
  for (const l of legs) {
    if (l.kind === 'ride') rides++;
    else walkMeters += l.meters;
  }
  const next: Itinerary = {
    ...current,
    id: itineraryId(net, legs),
    departAt: legs[0].from.time,
    arriveAt: out.arriveAt,
    legs,
    rides,
    walkMeters,
    warnings: out.warnings,
  };
  delete next.previousArriveAt;
  if (Math.abs(next.arriveAt - startedArriveAt) >= 60_000) next.previousArriveAt = startedArriveAt;
  return next;
}

/**
 * Walk paths that still belong after a re-plan: kept by leg index only
 * where that leg is still the same walk (same ends).
 */
export function keepWalkPaths(
  prev: Itinerary,
  next: Itinerary,
  paths: Readonly<Record<number, LatLng[]>>,
): Record<number, LatLng[]> {
  const out: Record<number, LatLng[]> = {};
  for (const [k, path] of Object.entries(paths)) {
    const i = Number(k);
    const a = prev.legs[i];
    const b = next.legs[i];
    if (a?.kind === 'walk' && b?.kind === 'walk' && same(a.from, b.from) && same(a.to, b.to)) out[i] = path;
  }
  return out;
}

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** A ride's chip label: "T816", "KG", or "KTM" for any KTM line. */
function chipLabel(l: Ride): string {
  return l.mode === 'ktm' ? 'KTM' : l.label;
}

/** "every 4 mins" (5 or less), else "in about 7 mins"; a timetable "in 7 mins". */
function cadence(l: Ride, now: number): string {
  const m = minutesUntil(l.from.time, now);
  if (l.timing.kind === 'headway') {
    return l.timing.headwaySec <= HEADWAY_ONLY_MAX_SEC ? `every ${mins(everyMinutes(l.timing.headwaySec))}` : `in about ${mins(m)}`;
  }
  return m === 0 ? 'due' : `in ${mins(m)}`;
}

/**
 * The Live Activity's line for the current leg (spec §8):
 * "Walk to Hotel Lisa De Inn · T816 in 3 mins", "On T816 · 4 stops to MRT
 * Phileo Damansara", "KG towards Kajang · every 4 mins · get off at Pasar Seni".
 */
export function legText(it: Itinerary, p: JourneyProgress, now: number): string {
  const leg = it.legs[p.legIndex];
  if (!leg) return '';
  const to = pointName(it, p.legIndex, 'to');
  if (p.phase === 'arrived') return `Arrived at ${destinationName(it)}`;
  if (leg.kind === 'walk') {
    if (p.phase === 'leg-done') return `At ${to}`;
    const next = rideAfter(it, p.legIndex);
    return next ? `Walk to ${to} · ${chipLabel(next)} ${cadence(next, now)}` : `Walk to ${to}`;
  }
  if (p.phase === 'leg-done') return `Get off at ${to}`;
  if (isRail(leg)) {
    const middle =
      p.phase === 'waiting'
        ? cadence(leg, now)
        : p.phase === 'next-is-yours'
          ? 'next stop'
          : `about ${stopsLabel(p.stopsToGo ?? 0)}`;
    return `${chipLabel(leg)} towards ${railHeadsign(leg.headsign)} · ${middle} · get off at ${to}`;
  }
  if (p.phase === 'waiting') return `${leg.label} ${cadence(leg, now)} · ${stopsLabel(p.stopsToGo ?? 0)} to ${to}`;
  if (p.phase === 'next-is-yours') return `On ${leg.label} · get off next at ${to}`;
  return `On ${leg.label} · ${stopsLabel(p.stopsToGo ?? 0)} to ${to}`;
}

/** Where the journey ends: the last leg's end. */
export function destinationName(it: Itinerary): string {
  return pointName(it, it.legs.length - 1, 'to');
}

/** Legs that count for "Leg 2 of 4": snap walks don't. */
function legOrdinal(it: Itinerary, i: number): { index: number; count: number } {
  let index = 0;
  let count = 0;
  it.legs.forEach((l, k) => {
    if (isSnap(l)) return;
    count++;
    if (k <= i) index = count;
  });
  return { index: Math.max(1, index), count };
}

/** Live means a live bus leg with a fresh fix (`honestTiming`'s rule). */
function liveTiming(leg: Leg, now: number): Extract<Ride['timing'], { kind: 'live' }> | null {
  if (leg.kind !== 'ride' || leg.timing.kind !== 'live') return null;
  return now - leg.timing.asOf <= LIVE_FRESH_MS ? leg.timing : null;
}

/**
 * The Live Activity for the current leg (`kind: 'journey'`): the chip
 * ("T816", "KG", "Walk"), the leg's target, and when it ends (boarding,
 * while waiting). `source` is 'live' only for a live bus leg. The timer
 * range is never inverted (SwiftUI traps on it).
 */
export function journeyActivityProps(it: Itinerary, p: JourneyProgress, now: number): BusActivityProps {
  const leg = it.legs[p.legIndex] ?? it.legs[it.legs.length - 1];
  const arrived = p.phase === 'arrived';
  const target = p.phase === 'waiting' ? leg.from.time : leg.to.time;
  const arrivalEpochMs = Math.max(target, now);
  const live = liveTiming(leg, now);
  const { index, count } = legOrdinal(it, p.legIndex);
  return {
    kind: 'journey',
    routeCode: leg.kind === 'walk' ? 'Walk' : chipLabel(leg),
    minutesToStop: arrived ? 0 : minutesUntil(arrivalEpochMs, now),
    arrivalEpochMs,
    // Never after now: a SwiftUI countdown shows the whole interval until
    // its lower bound passes, so a wait from boarding to boarding read 0:00.
    tripStartEpochMs: Math.min(leg.from.time, now, arrivalEpochMs),
    delayMinutes: null,
    delayTone: null,
    stopName: arrived ? destinationName(it) : pointName(it, p.legIndex, 'to'),
    busPlate: live?.vehicleId ?? null,
    source: live ? 'live' : 'schedule',
    distanceToStopMeters: null,
    isStale: false,
    arrivalStatus: arrived ? 'arrived' : p.phase === 'next-is-yours' || p.phase === 'leg-done' ? 'arriving' : 'en-route',
    updatedAtEpochMs: live?.asOf ?? null,
    legText: legText(it, p, now),
    legIndex: index,
    legCount: count,
    approximate: p.approximate,
  };
}

/** The Go sheet's line for the current leg, with the line's name ("Kajang Line · about 3 stops"). */
export function goInstruction(it: Itinerary, p: JourneyProgress, now: number, lineName: (l: Ride) => string): string {
  const leg = it.legs[p.legIndex];
  if (!leg) return '';
  const to = pointName(it, p.legIndex, 'to');
  if (p.phase === 'arrived') return `Arrived at ${destinationName(it)}`;
  if (leg.kind === 'walk') return p.phase === 'leg-done' ? `At ${to}` : `Walk to ${to}`;
  if (p.phase === 'leg-done') return `Get off at ${to}`;
  if (p.phase === 'next-is-yours') return `Get off next at ${to}`;
  if (p.phase === 'waiting') return `${lineName(leg)} ${cadence(leg, now)}`;
  const n = stopsLabel(p.stopsToGo ?? 0);
  return isRail(leg) || p.approximate ? `${lineName(leg)} · about ${n}` : `On ${lineName(leg)} · ${n}`;
}

/** The Go header's compact value: the leg's minutes or stops, or "Here". */
export function goCompact(it: Itinerary, p: JourneyProgress, now: number): HeroValue {
  const leg = it.legs[p.legIndex];
  if (!leg || p.phase === 'arrived' || p.phase === 'leg-done') return { text: 'Here', unit: null, kind: 'word' };
  if (p.phase === 'next-is-yours') return { text: 'Next', unit: null, kind: 'word' };
  if (p.phase === 'riding' && p.stopsToGo != null) return { text: String(p.stopsToGo), unit: 'stops', kind: 'minutes' };
  const m = minutesUntil(p.phase === 'waiting' ? leg.from.time : leg.to.time, now);
  return m === 0 ? { text: 'Now', unit: null, kind: 'word' } : { text: String(m), unit: 'min', kind: 'minutes' };
}

/** True when a ride from leg `from` on runs on a headway: its arrival is "about". */
export function arrivalIsApproximate(it: Itinerary, from: number): boolean {
  return it.legs.slice(Math.max(0, from)).some((l) => l.kind === 'ride' && l.timing.kind === 'headway');
}

function meters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
