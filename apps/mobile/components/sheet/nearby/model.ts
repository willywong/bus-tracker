import {
  ev,
  FEED_IDS,
  HEADWAY_ONLY_MAX_SEC,
  haversineMeters,
  serviceClock,
  stationBoard,
  stopDepartures,
  stopsNear,
  walkingMinutes,
  type BoardRow,
  type LatLng,
  type NextDeparture,
  type TransitNetwork,
} from '@bus-tracker/shared';

import { sliceShape } from '@/components/map/itineraryGeometry';
import { formatStopName } from '@/components/map/format';
import { lineBadgeLabel, lineDisplayName } from '@/components/rail/stationModel';

/**
 * Nearby as plain data (plan 17/01): the stops and stations around you, the
 * routes boarding at a stop, and one route's preview from your stop. Built
 * from the compiled network already on the phone; nothing here touches
 * React Native, so it runs under `tsx --test`.
 */

/** Bus stops this close are listed (straight line). */
export const STOP_RADIUS_M = 600;
/**
 * Rail and KTM stations this close are listed: worth a longer walk. 2 km,
 * not the plan's 1.5: from Hotel Lisa De Inn the nearest stations are
 * 1.7–1.9 km (Taman Paramount, Asia Jaya, Phileo Damansara).
 */
export const STATION_RADIUS_M = 2000;
/** At most this many places. */
export const MAX_PLACES = 8;
/** Stations kept even when nearer bus stops fill the list, so rail never drops out. */
export const MIN_STATIONS = 2;
/** Same-name stops this close (opposite sides of a road) are one place. */
export const MERGE_SAME_NAME_M = 80;

export interface LineChip {
  label: string;
  color: string;
  textColor: string;
}

export type NearbyPlace =
  | {
      kind: 'station';
      key: string;
      stationId: string;
      name: string;
      lines: LineChip[];
      distanceM: number;
      walkMin: number;
      /** "every 4 mins", "about 6 mins", "7:35", "First 6:00". */
      next: string;
      spoken: string;
    }
  | {
      kind: 'stop';
      key: string;
      /** Network stop indexes, nearest first; more than one when same-name stops merge. */
      stopIndexes: number[];
      name: string;
      /** Route labels boarding here, "PJ02", "780". */
      routes: string[];
      distanceM: number;
      walkMin: number;
      /** The soonest departure: "7:35", "every 10 min", "first 6:00", "No more today". */
      next: string;
      /** `next` is the live route's ETA, not the timetable. */
      live: boolean;
      isYourStop: boolean;
      spoken: string;
    };

export interface StopRouteRow {
  route: number;
  pattern: number;
  label: string;
  towards: string;
  /** The stop this row boards at (one of a merged place's stops). */
  stopIndex: number;
  /** Epoch ms of the next departure; null when none is left today. */
  nextAt: number | null;
  /** "7:52", "every 10 min", "first 6:05", "No more today". */
  next: string;
  /** "then 7:58 · 8:13", "every 10 min", "Last bus left 6:40", or null. */
  then: string | null;
  live: boolean;
  /** No more departures today. */
  ended: boolean;
  /** The next departure alone, spoken: "next at 7:52, scheduled", "no more today". */
  whenSpoken: string;
  spoken: string;
}

export interface RoutePreviewStop {
  index: number;
  name: string;
  lat: number;
  lng: number;
  /** Scheduled time of the next trip here; null when none is left today. */
  time: string | null;
  yours: boolean;
}

export interface RoutePreview {
  route: number;
  pattern: number;
  label: string;
  towards: string;
  fromStopIndex: number;
  fromStopName: string;
  /** From your stop to the end of the pattern. */
  stops: RoutePreviewStop[];
  /** Epoch ms the next trip leaves your stop; null when none is left today. */
  nextAt: number | null;
  /** Today's first departure at your stop, for "first 6:05" after service. */
  firstAt: number | null;
  /** Map path from your stop onward: the road shape's slice, else stop to stop. */
  path: LatLng[];
  /** `path` follows the road (a shape slice) rather than straight lines. */
  onRoad: boolean;
  spoken: string;
}

const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const spokenMins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const metresText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const metresSpoken = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} kilometres` : `${Math.round(m / 10) * 10} metres`;

/** A leading RapidKL stop code ("PJ210 ", "KL1079 ") or the feeder's "(m) " marker. */
const STOP_CODE = /^(?:\(m\)\s*)?(?:[A-Z]{1,3}\d{2,5}[A-Z]?\s+)?/;

/**
 * A stop name as Nearby shows it: display-cased, without the stop code and
 * feeder marker ("PJ210 Hotel Lisa De Inn" → "Hotel Lisa De Inn"), so the
 * city-bus and feeder stops on one corner read, and merge, as one place.
 */
export function placeName(raw: string): string {
  const name = formatStopName(raw);
  const bare = name.replace(STOP_CODE, '').trim();
  return bare || name;
}

/**
 * Two names for one kerb compare equal when they differ only in case,
 * spacing or punctuation ("Menara Am First", "Menara Amfirst").
 */
export function mergeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A place's stable key: 'station:<id>' or 'stop:<nearest stop id>'. */
export function placeKey(p: NearbyPlace): string {
  return p.key;
}

/** When a departure is, for sorting; none left sorts last. */
function soonestMs(next: NextDeparture, now: number): number {
  switch (next.kind) {
    case 'headway':
      return now + next.nextAboutSec * 1000;
    case 'timetable':
      return next.times[0] ?? Number.POSITIVE_INFINITY;
    case 'closed':
      return Number.POSITIVE_INFINITY;
  }
}

/** A bus departure in a few characters, plus its spoken form. */
function busShort(next: NextDeparture, clock: (ms: number) => string): { text: string; spoken: string } {
  switch (next.kind) {
    case 'headway': {
      const every = Math.max(1, Math.round(next.headwaySec / 60));
      return { text: `every ${every} min`, spoken: `every ${spokenMins(every)}` };
    }
    case 'timetable': {
      const at = clock(next.times[0]);
      return { text: at, spoken: `next at ${at}, scheduled` };
    }
    case 'closed':
      return next.reopensAt == null
        ? { text: 'No more today', spoken: 'no more buses today' }
        : { text: `first ${clock(next.reopensAt)}`, spoken: `first bus at ${clock(next.reopensAt)}` };
  }
}

/** A train departure: headways only as "every"/"about", never a clock time (spec §6.4). */
function railShort(next: NextDeparture, clock: (ms: number) => string): { text: string; spoken: string } {
  switch (next.kind) {
    case 'headway': {
      const every = Math.max(1, Math.round(next.headwaySec / 60));
      if (next.headwaySec <= HEADWAY_ONLY_MAX_SEC) return { text: `every ${every} min`, spoken: `trains every ${spokenMins(every)}` };
      const about = Math.max(1, Math.floor(next.nextAboutSec / 60));
      return { text: `about ${about} min`, spoken: `next train in about ${spokenMins(about)}` };
    }
    case 'timetable': {
      const at = clock(next.times[0]);
      return { text: at, spoken: `next train at ${at}, scheduled` };
    }
    case 'closed':
      return next.reopensAt == null
        ? { text: 'No more today', spoken: 'no more trains today' }
        : { text: `first ${clock(next.reopensAt)}`, spoken: `first train at ${clock(next.reopensAt)}` };
  }
}

const isBusFeed = (net: TransitNetwork, s: number) => {
  const feed = FEED_IDS[net.stops.feed[s]];
  return feed === 'bus-kl' || feed === 'feeder';
};

/**
 * The places around `here`, nearest first: stations within 2 km (one per
 * station, measured to the station) and bus stops within 600 m with
 * something to board, same-name stops across a road merged. At most 8,
 * at least two of them stations when any are in range.
 */
export function aroundYou(
  net: TransitNetwork,
  here: LatLng,
  now: number,
  o: {
    clock: (ms: number) => string;
    /**
     * Your tracked stop as tracking stores it, captioned "Your stop". The
     * static database shares the bus feeds' ids with the network
     * ('kl:1000944', feeder '12000759'), so it compares as is.
     */
    yourStopId: string | null;
    /** Your tracked route's label and its live ETA text ("4 min"), shown on your stop. */
    yourRouteCode?: string | null;
    yourLiveNext?: string | null;
  },
): NearbyPlace[] {
  const near = stopsNear(net, here.lat, here.lng, STATION_RADIUS_M);
  const places: NearbyPlace[] = [];

  // Stations: one per station, measured to the station's own point.
  const stations = new Set<number>();
  for (const s of near) {
    const st = net.stops.station[s];
    if (st >= 0 && !isBusFeed(net, s)) stations.add(st);
  }
  for (const st of stations) {
    const station = net.stations[st];
    if (!station) continue;
    const d = haversineMeters(here, { lat: station.lat, lng: station.lng });
    if (d > STATION_RADIUS_M) continue;
    const board = stationBoard(net, st, now);
    const best = board.rows.reduce<BoardRow | null>(
      (b, r) => (b == null || soonestMs(r.next, now) < soonestMs(b.next, now) ? r : b),
      null,
    );
    const next = best ? railShort(best.next, o.clock) : { text: 'Timetable unavailable', spoken: 'timetable unavailable' };
    const walkMin = Math.max(1, walkingMinutes(d));
    const lineNames = [...new Set(station.lines.map(lineDisplayName))];
    places.push({
      kind: 'station',
      key: `station:${station.id}`,
      stationId: station.id,
      name: station.name,
      lines: station.lines.map((l) => ({ label: lineBadgeLabel(l), color: l.color, textColor: l.textColor })),
      distanceM: d,
      walkMin,
      next: next.text,
      spoken: `${station.name}, ${lineNames.join(' and ')} station, ${metresSpoken(d)}, ${walkMin} minute walk, ${next.spoken}`,
    });
  }

  // Bus stops within 600 m that something boards at, nearest first.
  const stops = near
    .filter((s) => isBusFeed(net, s))
    .map((s) => ({ s, d: haversineMeters(here, { lat: net.stops.lat[s], lng: net.stops.lon[s] }) }))
    .filter((x) => x.d <= STOP_RADIUS_M)
    .sort((a, b) => a.d - b.d || a.s - b.s);
  const groups: {
    name: string;
    merge: string;
    anchor: number;
    d: number;
    members: { s: number; rows: BoardRow[] }[];
  }[] = [];
  for (const { s, d } of stops) {
    const rows = stopDepartures(net, s, now);
    if (rows.length === 0) continue; // arrivals only: nothing to board
    const name = placeName(net.stops.name[s]);
    const merge = mergeName(name);
    const pos = { lat: net.stops.lat[s], lng: net.stops.lon[s] };
    const group = groups.find(
      (g) =>
        g.merge === merge &&
        haversineMeters(pos, { lat: net.stops.lat[g.anchor], lng: net.stops.lon[g.anchor] }) <= MERGE_SAME_NAME_M,
    );
    if (group) group.members.push({ s, rows });
    else groups.push({ name, merge, anchor: s, d, members: [{ s, rows }] });
  }
  for (const g of groups) {
    const rows = g.members.flatMap((m) => m.rows);
    const routes = [...new Set(rows.map((r) => net.routes.label[r.route]))].sort(byLabel);
    const best = rows.reduce((b, r) => (soonestMs(r.next, now) < soonestMs(b.next, now) ? r : b));
    const ids = g.members.map((m) => net.stops.id[m.s]);
    const isYourStop = o.yourStopId != null && ids.includes(o.yourStopId);
    const yourLive = isYourStop && o.yourRouteCode != null && o.yourLiveNext != null && routes.includes(o.yourRouteCode);
    const next = yourLive
      ? { text: o.yourLiveNext!, spoken: `route ${o.yourRouteCode} in ${o.yourLiveNext}, live` }
      : busShort(best.next, o.clock);
    const walkMin = Math.max(1, walkingMinutes(g.d));
    const routeWords = routes.length === 1 ? `route ${routes[0]}` : `routes ${routes.slice(0, -1).join(', ')} and ${routes[routes.length - 1]}`;
    places.push({
      kind: 'stop',
      key: `stop:${net.stops.id[g.anchor]}`,
      stopIndexes: g.members.map((m) => m.s),
      name: g.name,
      routes,
      distanceM: g.d,
      walkMin,
      next: next.text,
      live: yourLive,
      isYourStop,
      spoken: `${g.name}, ${isYourStop ? 'your stop' : 'bus stop'}, ${metresSpoken(g.d)}, ${routeWords}, ${next.spoken}`,
    });
  }

  const sorted = places.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name));
  const out = sorted.slice(0, MAX_PLACES);
  // Nearer bus stops crowd out stations: swap the farthest stops for the
  // nearest stations left out, up to MIN_STATIONS.
  const missing = sorted.slice(MAX_PLACES).filter((p) => p.kind === 'station');
  let have = out.filter((p) => p.kind === 'station').length;
  while (have < MIN_STATIONS && missing.length > 0) {
    let k = out.length - 1;
    while (k >= 0 && out[k].kind !== 'stop') k--;
    if (k < 0) break;
    out.splice(k, 1);
    out.push(missing.shift()!);
    have++;
  }
  return out;
}

/** "240 m", "1.1 km". */
export function distanceText(m: number): string {
  return metresText(m);
}

/**
 * Every route and direction boarding at a place's stops, soonest first and
 * finished ones last. A route and direction served by two merged stops
 * keeps its sooner row.
 */
export function stopRoutes(
  net: TransitNetwork,
  stopIndexes: readonly number[],
  now: number,
  o: { clock: (ms: number) => string; liveRoutes?: ReadonlySet<string> },
): StopRouteRow[] {
  const best = new Map<string, { row: BoardRow; stopIndex: number }>();
  for (const s of stopIndexes) {
    for (const row of stopDepartures(net, s, now)) {
      const key = `${row.route}|${row.towards}`;
      const prev = best.get(key);
      if (!prev || soonestMs(row.next, now) < soonestMs(prev.row.next, now)) best.set(key, { row, stopIndex: s });
    }
  }
  const rows = [...best.values()].map(({ row, stopIndex }): StopRouteRow => {
    const label = net.routes.label[row.route];
    const towards = placeName(row.towards);
    const n = row.next;
    const ended = n.kind === 'closed' && n.reopensAt == null;
    const short = busShort(n, o.clock);
    const nextAt = n.kind === 'closed' ? n.reopensAt : soonestMs(n, now);
    let then: string | null = null;
    if (n.kind === 'timetable' && n.times.length > 1) then = `then ${n.times.slice(1).map(o.clock).join(' · ')}`;
    else if (ended && row.last != null) then = `Last bus left ${o.clock(row.last)}`;
    const live = !ended && (o.liveRoutes?.has(label) ?? false);
    return {
      route: row.route,
      pattern: row.pattern,
      label,
      towards,
      stopIndex,
      nextAt: Number.isFinite(nextAt ?? NaN) ? nextAt : null,
      next: ended ? 'No more today' : short.text,
      then,
      live,
      ended,
      whenSpoken: ended ? 'no more today' : short.spoken,
      spoken: `Route ${label} to ${towards}, ${ended ? 'no more today' : short.spoken}${live ? ', live' : ''}${then && !ended ? `. ${then}` : ''}`,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(a.ended) - Number(b.ended) ||
      (a.nextAt ?? Number.POSITIVE_INFINITY) - (b.nextAt ?? Number.POSITIVE_INFINITY) ||
      byLabel(a.label, b.label) ||
      a.towards.localeCompare(b.towards),
  );
}

/** First trip of pattern `p` leaving position `pos` at or after service time `t`; -1 when none. */
function nextTrip(net: TransitNetwork, p: number, pos: number, t: number): number {
  const n = net.patterns.tripLen[p];
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (net.patterns.dep[ev(net, p, mid, pos)] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < n ? lo : -1;
}

/** The next headway departure from position `pos` at or after `t`, in service seconds; null when none. */
function nextOnGrid(net: TransitNetwork, p: number, pos: number, t: number): number | null {
  const { patterns } = net;
  const off = patterns.runOffset[patterns.stopStart[p] + pos];
  let best: number | null = null;
  for (let w = patterns.freqStart[p]; w < patterns.freqStart[p] + patterns.freqLen[p]; w++) {
    const h = patterns.fHeadway[w];
    const s = patterns.fStart[w] + off;
    const end = patterns.fEnd[w] + off;
    if (t > end) continue;
    const d = t <= s ? s : s + Math.ceil((t - s) / h) * h;
    if (d <= end && (best === null || d < best)) best = d;
  }
  return best;
}

/**
 * One route's preview from your stop: its stops onward with the next trip's
 * scheduled times, and the map path (the road shape's slice when given and
 * it fits, else stop to stop). Null when `fromStopIndex` isn't on `pattern`.
 */
export function routePreview(
  net: TransitNetwork,
  pattern: number,
  fromStopIndex: number,
  now: number,
  o: { clock: (ms: number) => string; roadShape?: readonly LatLng[] | null },
): RoutePreview | null {
  const { patterns, stops: st } = net;
  if (pattern < 0 || pattern >= patterns.count) return null;
  const start = patterns.stopStart[pattern];
  const len = patterns.stopLen[pattern];
  let pos = -1;
  for (let k = 0; k < len - 1; k++) {
    if (patterns.stops[start + k] === fromStopIndex) {
      pos = k;
      break;
    }
  }
  if (pos < 0) return null;

  // The next trip's service time at each stop from yours on.
  const clockNow = serviceClock(net, now);
  let times: (number | null)[] = Array(len - pos).fill(null);
  let firstSec: number | null = null;
  if (clockNow) {
    const toMs = (sec: number) => clockNow.midnightMs + sec * 1000;
    const trip = patterns.tripLen[pattern] > 0 ? nextTrip(net, pattern, pos, clockNow.t) : -1;
    const grid = nextOnGrid(net, pattern, pos, clockNow.t);
    const tripDep = trip >= 0 ? patterns.dep[ev(net, pattern, trip, pos)] : null;
    if (tripDep != null && (grid == null || tripDep <= grid)) {
      times = times.map((_, i) => toMs(patterns.dep[ev(net, pattern, trip, pos + i)]));
    } else if (grid != null) {
      const offPos = patterns.runOffset[start + pos];
      times = times.map((_, i) => toMs(grid - offPos + patterns.runOffset[start + pos + i]));
    }
    if (patterns.tripLen[pattern] > 0) firstSec = patterns.dep[ev(net, pattern, 0, pos)];
    for (let w = patterns.freqStart[pattern]; w < patterns.freqStart[pattern] + patterns.freqLen[pattern]; w++) {
      const s = patterns.fStart[w] + patterns.runOffset[start + pos];
      if (firstSec == null || s < firstSec) firstSec = s;
    }
    if (firstSec != null) firstSec = toMs(firstSec);
  }

  const stops: RoutePreviewStop[] = [];
  for (let k = pos; k < len; k++) {
    const s = patterns.stops[start + k];
    const at = times[k - pos];
    stops.push({
      index: s,
      name: placeName(st.name[s]),
      lat: st.lat[s],
      lng: st.lon[s],
      time: at == null ? null : o.clock(at),
      yours: k === pos,
    });
  }
  const label = net.routes.label[patterns.route[pattern]];
  const towards = stops[stops.length - 1].name;
  const points = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const sliced =
    o.roadShape && o.roadShape.length >= 2 ? sliceShape(o.roadShape, points[0], points[points.length - 1], points) : null;
  const nextAt = times[0];
  const when = nextAt == null ? 'no more today' : `next at ${o.clock(nextAt)}, scheduled`;
  return {
    route: patterns.route[pattern],
    pattern,
    label,
    towards,
    fromStopIndex,
    fromStopName: stops[0].name,
    stops,
    nextAt,
    firstAt: firstSec,
    path: sliced ?? points,
    onRoad: sliced != null,
    spoken: `Route ${label} to ${towards} from ${stops[0].name}, ${when}`,
  };
}
