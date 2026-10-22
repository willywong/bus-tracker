import { toMalaysiaParts } from "../utils/gtfs-time.js";
import { ev } from "./compile.js";
import { feedOfStopId, type TransitNetwork } from "./network.js";

/**
 * What a board row says about the next departure. Rail is never live:
 * `headway` is an estimate on the frequency grid, `timetable` holds
 * scheduled times, and `closed` covers before the first and after the last
 * departure so neither masquerades as a countdown.
 */
export type NextDeparture =
  | { kind: "headway"; headwaySec: number; nextAboutSec: number }
  | { kind: "timetable"; times: number[] }          // epoch ms, ascending, ≤ 3
  | { kind: "closed"; reopensAt: number | null };   // before first / after last; epoch ms

export interface BoardRow {
  route: number;                 // index into net.routes
  pattern: number;               // representative pattern for this direction
  dir: 0 | 1;                    // from lineDirections
  towards: string;               // display name of the pattern's last stop
  next: NextDeparture;
  first: number | null;          // epoch ms, today's first departure at this station
  last: number | null;           // epoch ms, last departure
}

export interface StationBoard { station: number; rows: BoardRow[]; stale: boolean }

/** Spec §6.4: up to this headway a rail row shows only "every N mins", never a countdown. */
export const HEADWAY_ONLY_MAX_SEC = 300;

/** Scheduled times a timetable row shows. */
const MAX_TIMES = 3;
const DAY_SEC = 86_400;

/**
 * `now` on the network's service-day clock: seconds after its midnight, which
 * run past 86,400 for the small hours of the next calendar day (GTFS
 * spill-over), and the epoch ms of that midnight. `null` when `now` falls on
 * neither the service date nor the day after.
 */
export function serviceClock(net: TransitNetwork, nowEpochMs: number): { t: number; midnightMs: number } | null {
  const parts = toMalaysiaParts(new Date(nowEpochMs));
  const ymd = net.meta.serviceDate;
  if (parts.ymd === ymd) return { t: parts.secSinceMidnight, midnightMs: parts.midnightUtcMs };
  const next = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)) + 1));
  const nextYmd = `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, "0")}${String(next.getUTCDate()).padStart(2, "0")}`;
  if (parts.ymd !== nextYmd) return null;
  return { t: parts.secSinceMidnight + DAY_SEC, midnightMs: parts.midnightUtcMs - DAY_SEC * 1000 };
}

/** Numeric part of a stop's code ("rail:KJ1" → 1, "rail:KG18A" → 18, "ktm:19100" → 19100). */
function stationCode(net: TransitNetwork, stop: number): number {
  const m = /(\d+)\D*$/.exec(net.stops.id[stop]);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

const firstStop = (net: TransitNetwork, p: number) => net.patterns.stops[net.patterns.stopStart[p]];
const lastStop = (net: TransitNetwork, p: number) =>
  net.patterns.stops[net.patterns.stopStart[p] + net.patterns.stopLen[p] - 1];

/**
 * Whether pattern `b` runs the same way as pattern `a`: the first two of
 * `b`'s stops that `a` also calls at come in `a`'s order. Without two shared
 * stops, whether `b` ends nearer `a`'s terminus than `a`'s origin.
 */
function sameWay(net: TransitNetwork, a: number, b: number): boolean {
  const { stops, stopStart, stopLen } = net.patterns;
  const posInA = new Map<number, number>();
  for (let s = stopLen[a] - 1; s >= 0; s--) posInA.set(stops[stopStart[a] + s], s);
  let prev = -1;
  for (let s = 0; s < stopLen[b]; s++) {
    const pos = posInA.get(stops[stopStart[b] + s]);
    if (pos === undefined || pos === prev) continue;
    if (prev >= 0) return pos > prev;
    prev = pos;
  }
  const { lat, lon } = net.stops;
  const d2 = (i: number, j: number) => (lat[i] - lat[j]) ** 2 + (lon[i] - lon[j]) ** 2;
  const end = lastStop(net, b);
  return d2(end, lastStop(net, a)) <= d2(end, firstStop(net, a));
}

interface Directions { order: number[]; dirByLast: Map<number, 0 | 1> }

function directions(net: TransitNetwork, route: number): Directions {
  const { count, stopLen, headsign } = net.patterns;
  // The longest pattern per last stop; the lower index on a tie.
  const reps = new Map<number, number>();
  for (let p = 0; p < count; p++) {
    if (net.patterns.route[p] !== route) continue;
    const last = lastStop(net, p);
    const rep = reps.get(last);
    if (rep === undefined || stopLen[p] > stopLen[rep]) reps.set(last, p);
  }
  const byCode = (a: number, b: number) =>
    stationCode(net, firstStop(net, a)) - stationCode(net, firstStop(net, b)) ||
    stopLen[b] - stopLen[a] ||
    (headsign[a] < headsign[b] ? -1 : headsign[a] > headsign[b] ? 1 : 0) ||
    a - b;
  const sorted = [...reps.values()].sort(byCode);
  const dirByLast = new Map<number, 0 | 1>();
  if (sorted.length === 0) return { order: [], dirByLast };
  const [base, ...rest] = sorted;
  // After dir 0, the rest go longest first, so [1] is the full run the other way.
  const longest = (a: number, b: number) => stopLen[b] - stopLen[a] || byCode(a, b);
  const same = rest.filter((p) => sameWay(net, base, p)).sort(longest);
  const back = rest.filter((p) => !sameWay(net, base, p)).sort(longest);
  dirByLast.set(lastStop(net, base), 0);
  for (const p of same) dirByLast.set(lastStop(net, p), 0);
  for (const p of back) dirByLast.set(lastStop(net, p), 1);
  return { order: [base, ...back, ...same], dirByLast };
}

/**
 * One representative pattern per direction of a route, `dir 0` first. The
 * network stores no `direction_id` (spec §3.3), so directions are derived:
 * the longest pattern per last stop, `dir 0` being the one whose first stop
 * has the lowest station code (`KJ1` Gombak), the longer then headsign A–Z
 * on a tie. Then
 * the patterns running the other way (`dir 1`), longest first, and last any
 * other `dir 0` short workings (KTM).
 */
export function lineDirections(net: TransitNetwork, routeIndex: number): number[] {
  return directions(net, routeIndex).order;
}

/** The last grid departure of a window, `start + k·headway ≤ end`. */
const lastOnGrid = (start: number, end: number, headway: number) =>
  start + Math.floor((end - start) / headway) * headway;

/** First index in `dep` column `pos` of pattern `p` with a departure ≥ t (FIFO keeps the column sorted). */
function firstTripFrom(net: TransitNetwork, p: number, pos: number, t: number): number {
  const { dep } = net.patterns;
  let lo = 0;
  let hi = net.patterns.tripLen[p];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dep[ev(net, p, mid, pos)] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Every (pattern, pos) of one (route, last stop) at the stops being boarded. */
interface Group { route: number; last: number; calls: Array<{ p: number; pos: number }> }

/** Rows for every (route, last stop) departing from any of `stops`, merged across them. */
function departuresAt(net: TransitNetwork, stops: readonly number[], t: number, midnightMs: number): BoardRow[] {
  const { stopRoutes, patterns } = net;
  const groups = new Map<string, Group>();
  for (const stop of stops) {
    for (let k = stopRoutes.start[stop]; k < stopRoutes.start[stop] + stopRoutes.len[stop]; k++) {
      const p = stopRoutes.pattern[k];
      const pos = stopRoutes.pos[k];
      if (pos === patterns.stopLen[p] - 1) continue; // arrivals only
      const route = patterns.route[p];
      const last = lastStop(net, p);
      const key = `${route}:${last}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { route, last, calls: [] }));
      group.calls.push({ p, pos });
    }
  }

  const dirs = new Map<number, Directions>();
  const toMs = (sec: number) => midnightMs + sec * 1000;
  const rows: BoardRow[] = [];
  for (const { route, last, calls } of groups.values()) {
    let dirsOfRoute = dirs.get(route);
    if (!dirsOfRoute) dirs.set(route, (dirsOfRoute = directions(net, route)));

    let first = Number.POSITIVE_INFINITY;
    let lastDep = Number.NEGATIVE_INFINITY;
    // Headway windows, shifted to this stop: the earliest grid departure
    // ≥ t, and the window holding `t` (the later one on a boundary).
    let best: number | null = null;
    let current: { s: number; end: number; h: number } | null = null;
    // Timetabled departures ≥ t.
    const times: number[] = [];
    let rep = calls[0].p;
    for (const { p, pos } of calls) {
      if (patterns.stopLen[p] > patterns.stopLen[rep] || (patterns.stopLen[p] === patterns.stopLen[rep] && p < rep)) rep = p;
      const off = patterns.runOffset[patterns.stopStart[p] + pos];
      for (let w = patterns.freqStart[p]; w < patterns.freqStart[p] + patterns.freqLen[p]; w++) {
        const h = patterns.fHeadway[w];
        const s = patterns.fStart[w] + off;
        const end = patterns.fEnd[w] + off;
        const e = lastOnGrid(patterns.fStart[w], patterns.fEnd[w], h) + off;
        first = Math.min(first, s);
        lastDep = Math.max(lastDep, e);
        if (s <= t && t <= end && (!current || s > current.s)) current = { s, end, h };
        if (t > e) continue;
        const d = t <= s ? s : s + Math.ceil((t - s) / h) * h;
        if (best === null || d < best) best = d;
      }
      const n = patterns.tripLen[p];
      if (n > 0) {
        first = Math.min(first, patterns.dep[ev(net, p, 0, pos)]);
        lastDep = Math.max(lastDep, patterns.dep[ev(net, p, n - 1, pos)]);
        const from = firstTripFrom(net, p, pos, t);
        for (let i = from; i < n && i < from + MAX_TIMES; i++) times.push(patterns.dep[ev(net, p, i, pos)]);
      }
    }

    let next: NextDeparture;
    // Running now: `t` is inside a window and the next train comes no more
    // than one headway past that window's end (from an adjacent window).
    if (best !== null && current && best <= current.end + current.h) {
      next = { kind: "headway", headwaySec: current.h, nextAboutSec: best - t };
    } else if (times.length > 0) {
      times.sort((x, y) => x - y);
      next = { kind: "timetable", times: times.slice(0, MAX_TIMES).map(toMs) };
    } else {
      next = { kind: "closed", reopensAt: best === null ? null : toMs(best) };
    }
    rows.push({
      route,
      pattern: rep,
      dir: dirsOfRoute.dirByLast.get(last) ?? 0,
      towards: net.stops.name[last],
      next,
      first: Number.isFinite(first) ? toMs(first) : null,
      last: Number.isFinite(lastDep) ? toMs(lastDep) : null,
    });
  }
  return rows;
}

/**
 * One row per (route, last stop) departing from a stop at `now`: headway
 * windows shifted by the run time to this stop, timetabled trips, and
 * first/last departures. A terminus yields no row for the pattern ending
 * there. Empty when `now` is off this network's service date.
 */
export function stopDepartures(net: TransitNetwork, stopIndex: number, nowEpochMs: number): BoardRow[] {
  const clock = serviceClock(net, nowEpochMs);
  return clock ? departuresAt(net, [stopIndex], clock.t, clock.midnightMs) : [];
}

/**
 * The departure board of a station: every platform's rows, one per line and
 * direction, sorted by line label then destination. Stale with no rows when
 * `now` is off this network's service date or the station's feed is left out
 * of the network (spec §3.6; the sheet shows "Timetable unavailable").
 */
export function stationBoard(net: TransitNetwork, stationIndex: number, nowEpochMs: number): StationBoard {
  const clock = serviceClock(net, nowEpochMs);
  const station = net.stations[stationIndex];
  const excluded = station?.stopIds.some((id) => !net.meta.feeds[feedOfStopId(id)].included) ?? true;
  if (!clock || excluded) return { station: stationIndex, rows: [], stale: true };
  const stops: number[] = [];
  for (let s = 0; s < net.stops.count; s++) if (net.stops.station[s] === stationIndex) stops.push(s);
  const { label } = net.routes;
  const rows = departuresAt(net, stops, clock.t, clock.midnightMs).sort(
    (a, b) =>
      (label[a.route] < label[b.route] ? -1 : label[a.route] > label[b.route] ? 1 : 0) ||
      (a.towards < b.towards ? -1 : a.towards > b.towards ? 1 : 0),
  );
  return { station: stationIndex, rows, stale: false };
}

/** "every 3 minutes": minutes spelled out for VoiceOver. */
const spokenMins = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/**
 * The honest label for a row (spec §6.4). Headways up to 5 min show only
 * "every N mins"; longer ones "about N mins" then the headway; timetabled
 * rows scheduled clock times; closed rows the first train or that service
 * has ended. `fmtMins` is the app's `mins()`, `fmtClock` its clock format.
 */
export function boardText(
  n: NextDeparture,
  fmtMins: (m: number) => string,
  fmtClock: (ms: number) => string,
): { primary: string; secondary: string | null; spoken: string } {
  switch (n.kind) {
    case "headway": {
      const every = Math.round(n.headwaySec / 60);
      if (n.headwaySec <= HEADWAY_ONLY_MAX_SEC) {
        return { primary: `every ${fmtMins(every)}`, secondary: null, spoken: `every ${spokenMins(every)}` };
      }
      const about = Math.max(1, Math.floor(n.nextAboutSec / 60));
      return {
        primary: `about ${fmtMins(about)}`,
        secondary: `then every ${fmtMins(every)}`,
        spoken: `about ${spokenMins(about)}, then every ${spokenMins(every)}`,
      };
    }
    case "timetable": {
      const clocks = n.times.map(fmtClock);
      return {
        primary: clocks[0] ?? "",
        secondary: clocks.length > 1 ? clocks.slice(1).join(" · ") : null,
        spoken: `Scheduled ${clocks.join(", ")}`,
      };
    }
    case "closed": {
      const text = n.reopensAt === null ? "No more trains today" : `First ${fmtClock(n.reopensAt)}`;
      return { primary: text, secondary: null, spoken: text };
    }
  }
}
