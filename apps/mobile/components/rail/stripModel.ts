import {
  ev,
  FEED_IDS,
  haversineMeters,
  lineDirections,
  MODES,
  RAIL_LINES,
  serviceClock,
  type LatLng,
  type Mode,
  type RailLine,
  type RailMode,
  type TransitNetwork,
} from '@bus-tracker/shared';

import { lineDisplayName } from '@/components/rail/stationModel';
import { mins } from '@/components/trip/model';

/**
 * The line sheet's strip map as plain data (plan 13/04, spec §6.5): one
 * line in one direction, its stations top to bottom with the run time from
 * the first stop, other lines' colours at interchanges, and every run that
 * leaves the first stop today. Estimated trains are drawn from `runs` and
 * the run times; rail is never live, so nothing here claims a position
 * beyond the timetable. `app/line.tsx` renders it; nothing here touches
 * React Native.
 */

export interface StripStation {
  /** Index into `net.stops`. */
  stopIndex: number;
  /** `RailStation.id`, the `station` param of `/station`; null for a stop with no station. */
  stationId: string | null;
  name: string;
  /** Template seconds from the first stop; strictly increasing down the strip. */
  offsetSec: number;
  /** Distinct colours of the other lines calling here (interchange squares). */
  otherLineColors: string[];
  /** The other lines' names without their mode prefix ("Kajang Line"), for VoiceOver. */
  otherLineNames: string[];
  lat: number;
  lng: number;
}

export interface StripDirection {
  dir: 0 | 1;
  /** Display name of the pattern's last stop ("Gombak"). */
  towards: string;
}

export interface StripModel {
  route: number;
  /** `net.routes.id` ('rail:KJ'). */
  routeId: string;
  pattern: number;
  dir: 0 | 1;
  towards: string;
  /** Both ways when the line has two; the picker's options. */
  directions: StripDirection[];
  /** Branding for the badge, from the bundled lines when the name matches. */
  line: RailLine;
  /** `line.name` without its mode prefix ("Kelana Jaya Line"). */
  name: string;
  mode: Mode;
  /** KTM runs are timetabled trips; every other rail line runs on headway windows. */
  kind: 'headway' | 'timetable';
  stations: StripStation[];
  totalRunSec: number;
  /** The window in force at the first stop now; null outside every window (and for timetabled lines). */
  window: { headwaySec: number; startSec: number; endSec: number } | null;
  /** Epoch ms of today's first and last departures from the first stop. */
  first: number | null;
  last: number | null;
  /** Epoch ms of the next departure from the first stop at or after now. */
  next: number | null;
  /**
   * Every departure from the first stop today, service seconds ascending:
   * each window's grid (`fStart + k·h ≤ fEnd`) or each timetabled trip.
   */
  runs: number[];
  /** For a timetabled line, the trip index of each run (`runs[i]` ↔ `trips[i]`); null on headway lines. */
  trips: number[] | null;
  /** Epoch ms of the network's service-day midnight; null when now is off its service date. */
  midnightMs: number | null;
}

/** Trains fade in and out over this many seconds at the ends of a run. */
export const TRAIN_FADE_SEC = 15;
/** "Nearest to you" only within this distance of a station. */
export const NEAREST_MAX_M = 2000;

const RAIL_MODE_OF: Partial<Record<Mode, RailMode>> = {
  lrt: 'LRT',
  mrt: 'MRT',
  monorail: 'Monorail',
  brt: 'BRT',
  ktm: 'KTM',
};

/** SF Symbol for a rail mode (spec §7): LRT/BRT tram, MRT/KTM train, Monorail light rail. */
export function railGlyph(mode: Mode): 'tram.fill' | 'train.side.front.car' | 'lightrail.fill' {
  switch (mode) {
    case 'monorail':
      return 'lightrail.fill';
    case 'mrt':
    case 'ktm':
      return 'train.side.front.car';
    default:
      return 'tram.fill';
  }
}

/** Index of the route with `net.routes.id === id`, or -1. */
export function routeIndexById(net: TransitNetwork, id: string): number {
  return net.routes.id.indexOf(id);
}

function lineOf(net: TransitNetwork, r: number): RailLine {
  const longName = net.routes.longName[r];
  const bundled = RAIL_LINES.find((l) => l.name === longName);
  if (bundled) return bundled;
  // KTM lines live on the network's stations ("KTM" badge, as on the station sheet).
  for (const s of net.stations) {
    const l = s.lines.find((x) => x.name === longName);
    if (l) return l;
  }
  return {
    code: net.routes.label[r],
    mode: RAIL_MODE_OF[MODES[net.routes.mode[r]]] ?? 'LRT',
    name: longName || net.routes.label[r],
    color: net.routes.color[r] || '#000000',
    textColor: net.routes.textColor[r] || '#FFFFFF',
  };
}

const lastStopOf = (net: TransitNetwork, p: number) =>
  net.patterns.stops[net.patterns.stopStart[p] + net.patterns.stopLen[p] - 1];

/** Strictly increasing copy, so the per-segment interpolation never divides by zero. */
function strictlyIncreasing(xs: number[]): number[] {
  const out = xs.slice();
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 0.001;
  return out;
}

/** Every departure from the first stop of pattern `p`, ascending, with trip indices when timetabled. */
function departures(net: TransitNetwork, p: number): { runs: number[]; trips: number[] | null } {
  const P = net.patterns;
  if (P.freqLen[p] > 0) {
    const set = new Set<number>();
    for (let w = P.freqStart[p]; w < P.freqStart[p] + P.freqLen[p]; w++) {
      const h = P.fHeadway[w];
      if (h <= 0) continue;
      for (let d = P.fStart[w]; d <= P.fEnd[w]; d += h) set.add(d);
    }
    return { runs: [...set].sort((a, b) => a - b), trips: null };
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < P.tripLen[p]; i++) pairs.push([P.dep[ev(net, p, i, 0)], i]);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { runs: pairs.map((x) => x[0]), trips: pairs.map((x) => x[1]) };
}

/**
 * The strip for route `routeIndex` in direction `dir` (13/01's
 * `lineDirections`: `[0]` is dir 0, `[1]` the full run the other way) at
 * `now`. Null when the route has no pattern that way. Run times come from
 * the headway template (`runOffset`), or the day's first trip on a
 * timetabled line.
 */
export function stripModel(net: TransitNetwork, routeIndex: number, dir: 0 | 1, nowEpochMs: number): StripModel | null {
  if (routeIndex < 0 || routeIndex >= net.routes.count) return null;
  const order = lineDirections(net, routeIndex);
  const p = order[dir];
  if (p === undefined) return null;
  const P = net.patterns;
  const start = P.stopStart[p];
  const len = P.stopLen[p];
  const line = lineOf(net, routeIndex);
  const { runs, trips } = departures(net, p);
  const kind = trips ? 'timetable' : 'headway';

  // Template run times from the first stop.
  const raw: number[] = [];
  for (let s = 0; s < len; s++) {
    if (kind === 'headway') raw.push(P.runOffset[start + s]);
    else if (trips && trips.length > 0) raw.push(P.dep[ev(net, p, trips[0], s)] - runs[0]);
    else raw.push(s * 120);
  }
  const offsets = strictlyIncreasing(raw);

  const stations: StripStation[] = [];
  for (let s = 0; s < len; s++) {
    const stop = P.stops[start + s];
    const st = net.stops.station[stop];
    const station = st >= 0 ? net.stations[st] : undefined;
    const others = (station?.lines ?? []).filter((l) => l.name !== line.name);
    const names = [...new Set(others.map(lineDisplayName))];
    stations.push({
      stopIndex: stop,
      stationId: station?.id ?? null,
      name: station?.name ?? net.stops.name[stop],
      offsetSec: offsets[s],
      otherLineColors: [...new Set(others.map((l) => l.color))],
      otherLineNames: names,
      lat: net.stops.lat[stop],
      lng: net.stops.lon[stop],
    });
  }

  const clock = serviceClock(net, nowEpochMs);
  const t = clock?.t ?? null;
  const toMs = (sec: number) => (clock ? clock.midnightMs + sec * 1000 : null);

  let window: StripModel['window'] = null;
  if (t != null) {
    for (let w = P.freqStart[p]; w < P.freqStart[p] + P.freqLen[p]; w++) {
      // On a boundary the later window wins, as on the station board.
      if (P.fStart[w] <= t && t <= P.fEnd[w] && (!window || P.fStart[w] > window.startSec)) {
        window = { headwaySec: P.fHeadway[w], startSec: P.fStart[w], endSec: P.fEnd[w] };
      }
    }
  }
  const nextRun = t == null ? undefined : runs.find((d) => d >= t);

  const directions: StripDirection[] = order
    .slice(0, 2)
    .map((q, i) => ({ dir: i as 0 | 1, towards: net.stops.name[lastStopOf(net, q)] }));

  return {
    route: routeIndex,
    routeId: net.routes.id[routeIndex],
    pattern: p,
    dir,
    towards: net.stops.name[lastStopOf(net, p)],
    directions,
    line,
    name: lineDisplayName(line),
    mode: MODES[net.routes.mode[routeIndex]],
    kind,
    stations,
    totalRunSec: offsets[offsets.length - 1] ?? 0,
    window,
    first: runs.length && clock ? toMs(runs[0]) : null,
    last: runs.length && clock ? toMs(runs[runs.length - 1]) : null,
    next: nextRun != null ? toMs(nextRun) : null,
    runs,
    trips,
    midnightMs: clock?.midnightMs ?? null,
  };
}

/**
 * Run times (s since leaving the first stop) of the trains on the line at
 * service-second `t`, ascending: every run with `0 ≤ t − dep ≤ totalRunSec`.
 * Unlike the plan's sketch, runs from an earlier window (another headway)
 * still count while they are on the line, so the strip doesn't empty out at
 * 09:00 when the peak window hands over.
 */
export function trainRunTimes(m: Pick<StripModel, 'runs' | 'totalRunSec'>, t: number): number[] {
  const out: number[] = [];
  for (let i = m.runs.length - 1; i >= 0; i--) {
    const r = t - m.runs[i];
    if (r < 0) continue;
    if (r > m.totalRunSec) break;
    out.push(r);
  }
  return out;
}

/**
 * Service seconds of each station for run `i`: the template offsets on a
 * headway line, that trip's own scheduled departures on a timetabled one
 * (made strictly increasing for the interpolation).
 */
export function runTimes(net: TransitNetwork, m: StripModel, i: number): number[] {
  const dep = m.runs[i];
  if (!m.trips) return m.stations.map((s) => dep + s.offsetSec);
  const trip = m.trips[i];
  const len = m.stations.length;
  const out: number[] = [];
  for (let s = 0; s < len; s++) out.push(net.patterns.dep[ev(net, m.pattern, trip, s)]);
  return strictlyIncreasing(out);
}

/** `now` as fractional service seconds of the model's day, or null off its service date. */
export function serviceSecondsAt(m: Pick<StripModel, 'midnightMs'>, nowEpochMs: number): number | null {
  return m.midnightMs == null ? null : (nowEpochMs - m.midnightMs) / 1000;
}

/** Index of the station nearest `point` within `maxM` metres, or -1. */
export function nearestStationIndex(
  stations: readonly Pick<StripStation, 'lat' | 'lng'>[],
  point: LatLng | null,
  maxM = NEAREST_MAX_M,
): number {
  if (!point) return -1;
  let best = -1;
  let bestD = maxM;
  stations.forEach((s, i) => {
    const d = haversineMeters(point, { lat: s.lat, lng: s.lng });
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Whether the line runs from the KTM feed (timetabled Komuter). */
export function isKtmRoute(net: TransitNetwork, routeIndex: number): boolean {
  return FEED_IDS[net.routes.feed[routeIndex]] === 'ktm';
}

export interface StripHeader {
  /** "every 3 mins now", "First 06:00", "Next 07:30", "No more trains today". */
  status: string;
  /** "First 06:00 · Last 23:25", or null. */
  footer: string | null;
  /** The caption under the header, verbatim from the spec. */
  caption: string;
  /** One VoiceOver element for the whole header. */
  spoken: string;
}

const spokenMins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

export const RAIL_CAPTION = "Trains shown at timetable spacing — Rapid Rail doesn't publish live positions.";
export const KTM_CAPTION = "Trains shown at scheduled times — KTM doesn't publish live Komuter positions.";

/** The header text (step 4) and its VoiceOver label (step 9). `clock` formats epoch ms. */
export function stripHeader(m: StripModel, ktm: boolean, clock: (epochMs: number) => string): StripHeader {
  let status: string;
  let spokenStatus: string;
  if (m.midnightMs == null) {
    status = spokenStatus = 'Timetable unavailable';
  } else if (m.window && m.kind === 'headway') {
    const every = Math.max(1, Math.round(m.window.headwaySec / 60));
    status = `every ${mins(every)} now`;
    spokenStatus = `every ${spokenMins(every)} now`;
  } else if (m.next == null) {
    status = spokenStatus = 'No more trains today';
  } else if (m.next === m.first || m.kind === 'headway') {
    status = `First ${clock(m.next)}`;
    spokenStatus = `First train ${clock(m.next)}`;
  } else {
    status = `Next ${clock(m.next)}`;
    spokenStatus = `Next train ${clock(m.next)}`;
  }
  const footer = m.first != null && m.last != null ? `First ${clock(m.first)} · Last ${clock(m.last)}` : null;
  const footerSpoken = m.first != null && m.last != null ? ` First train ${clock(m.first)}, last train ${clock(m.last)}.` : '';
  const caption = ktm ? KTM_CAPTION : RAIL_CAPTION;
  const spokenCaption = ktm ? 'Trains shown at scheduled times.' : 'Trains shown at timetable spacing.';
  return {
    status,
    footer,
    caption,
    spoken: `${m.name} towards ${m.towards}, ${spokenStatus}.${footerSpoken} ${spokenCaption}`,
  };
}

/** A station row's VoiceOver label: "Pasar Seni, change for Kajang Line, nearest to you". */
export function stationSpoken(s: Pick<StripStation, 'name' | 'otherLineNames'>, nearest: boolean): string {
  const parts = [s.name];
  if (s.otherLineNames.length > 0) parts.push(`change for ${joinAnd(s.otherLineNames)}`);
  if (nearest) parts.push('nearest to you');
  return parts.join(', ');
}

function joinAnd(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
