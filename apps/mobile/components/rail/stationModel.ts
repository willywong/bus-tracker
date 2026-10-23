import {
  boardText,
  FEED_IDS,
  feedOfStopId,
  HEADWAY_ONLY_MAX_SEC,
  haversineMeters,
  MODES,
  RAIL_INTERCHANGES,
  RAIL_STATIONS,
  stationBoard,
  stationIndexById,
  stopDepartures,
  stopIndexById,
  stopsNear,
  walkingMinutes,
  type BoardRow,
  type FeedId,
  type Interchange,
  type NetworkHealth,
  type NextDeparture,
  type RailLine,
  type RailMode,
  type RailStation,
  type TransitNetwork,
} from '@bus-tracker/shared';

import { formatStopName } from '@/components/map/format';
import { formatClockHHMM } from '@/components/tracker/logic';
import { mins } from '@/components/trip/model';

/**
 * The station sheet as plain data (plan 13/03): which lines call here, a
 * board per line from 13/01's `stationBoard`, walking interchanges and the
 * bus stops around it. Rail is never live: rows read "every N mins" or
 * "about N mins", and an expired feed reads "Timetable unavailable".
 * `app/station.tsx` renders it; nothing here touches React Native.
 */

/** Bus stops this close to the station are "nearby" (straight line). */
export const NEARBY_RADIUS_M = 250;
/** At most this many nearby bus stops. */
export const NEARBY_MAX = 4;

export interface StationLine {
  line: RailLine;
  /** Index into `net.routes`, or null without a network (bundled stations). */
  routeIndex: number | null;
  /** `net.routes.id` ('rail:KJ'), the `line` param of `/line`; null without a network. */
  routeId: string | null;
  /** Badge text: the last token of the line's code ("KJ", "MR", "BRT"). */
  badge: string;
  /** The line's name without its mode prefix ("Kelana Jaya Line"). */
  name: string;
}

export interface BoardRowView {
  towards: string;
  /** "every 3 mins", "about 4 mins", "07:30", "First 06:00", "No more trains today". */
  primary: string;
  /** "then every 6 mins", or the later scheduled times. */
  secondary: string | null;
  /** The minute count while the label counts down ("about N mins"); null when nothing should roll. */
  rolling: number | null;
  /** One VoiceOver element: "Kelana Jaya Line towards Gombak, every 3 minutes". */
  spoken: string;
  dir: 0 | 1;
  /** `primary` is a timetabled clock time (KTM): drawn with the clock glyph. */
  scheduled: boolean;
}

export interface StationBoardView {
  line: StationLine;
  rows: BoardRowView[];
  /** "First 06:00 · Last 23:25", or null. */
  footer: string | null;
  /** "First train 06:00, last train 23:25". */
  footerSpoken: string | null;
}

export interface InterchangeView {
  /** The other station's `RailStation.id`. */
  stationId: string;
  name: string;
  /** Distinct line colours of the other station. */
  colors: string[];
  /** "3 min walk", or "about 3 min walk" until the walk is verified. */
  walk: string;
  note: string;
  spoken: string;
}

export interface NearbyStopView {
  stopIndex: number;
  /** Network stop id ('kl:1004342', feeder raw). */
  stopId: string;
  name: string;
  /** The route shown on the row's chip. */
  routeLabel: string;
  /** That route's index and the direction boarding here: what the row's preview opens. */
  route: number;
  pattern: number;
  /** Every other route departing here, for the caption. */
  others: string[];
  /** "3 min walk". */
  walk: string;
  /** "next 09:14", "every 10 mins", "first 06:00", "No more buses today". */
  next: string;
  /** `next` is a timetable clock time: drawn with the clock glyph. */
  scheduled: boolean;
  /** The trip's own stop and route: the sheet shows the trip's live ETA instead. */
  isTrip: boolean;
  spoken: string;
  /** `spoken` without its departure ("Route 580, Pasar Seni, 2 minute walk"), for the trip's live row. */
  spokenPlace: string;
  /** ". Also 590, 851", or ''. */
  spokenAlso: string;
}

export type UnavailableReason = 'expired' | 'no-network' | 'stale';

export interface StationSheetModel {
  station: RailStation;
  lines: StationLine[];
  boards: StationBoardView[];
  /** Rail expired, the board is stale, or there's no network: rows become "Timetable unavailable". */
  unavailable: boolean;
  reason: UnavailableReason | null;
  /** The one footnote under the boards, e.g. "Rail timetable from data.gov.my has expired." */
  unavailableNote: string | null;
  interchanges: InterchangeView[];
  nearby: NearbyStopView[];
}

export interface StationSheetInput {
  net: TransitNetwork | null;
  health: NetworkHealth | null;
  /** `RailStation.id` (slug), the `station` route param. */
  stationId: string;
  now: number;
  /** The trip sheet's route and stop, so its row reuses the live ETA. */
  tripRouteCode?: string | null;
  tripStopId?: string | null;
  /** Clock format; the app's `formatClockHHMM` by default. */
  clock?: (epochMs: number) => string;
}

const MODE_PREFIX = /^(LRT|MRT|BRT|KTM)\s+/;

/** "LRT Kelana Jaya Line" → "Kelana Jaya Line"; "KTM Komuter Seremban Line" → "Komuter Seremban Line". */
export function lineDisplayName(line: Pick<RailLine, 'name'>): string {
  return line.name.replace(MODE_PREFIX, '') || line.name;
}

/** "LRT KJ" → "KJ", "Monorail MR" → "MR", "BRT" → "BRT". */
export function lineBadgeLabel(line: Pick<RailLine, 'code'>): string {
  const parts = line.code.trim().split(/\s+/);
  return parts[parts.length - 1] || line.code;
}

/** "3 minutes", "1 minute": counts spelled out for VoiceOver. */
const spokenMins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

const RAIL_MODE_OF: Partial<Record<(typeof MODES)[number], RailMode>> = {
  lrt: 'LRT',
  mrt: 'MRT',
  monorail: 'Monorail',
  brt: 'BRT',
  ktm: 'KTM',
};

/** A bundled station with its stop ids namespaced like the network's ('KJ15' → 'rail:KJ15'). */
function bundled(id: string): RailStation | null {
  const s = RAIL_STATIONS.find((x) => x.id === id);
  return s ? { ...s, stopIds: s.stopIds.map((sid) => `rail:${sid}`) } : null;
}

/** The station that holds network stop `stopId`: from the network, else the bundled rail list. */
function stationOfStop(net: TransitNetwork | null, stopId: string): RailStation | null {
  if (net) {
    const i = stopIndexById(net, stopId);
    const st = i >= 0 ? net.stops.station[i] : -1;
    if (st >= 0 && net.stations[st]) return net.stations[st];
  }
  if (!stopId.startsWith('rail:')) return null;
  const raw = stopId.slice('rail:'.length);
  const s = RAIL_STATIONS.find((x) => x.stopIds.includes(raw));
  return s ? bundled(s.id) : null;
}

/** The network route a station line runs as, matched on its full name. */
function routeOfLine(net: TransitNetwork, line: RailLine): number | null {
  for (let r = 0; r < net.routes.count; r++) {
    const feed = FEED_IDS[net.routes.feed[r]];
    if ((feed === 'rail' || feed === 'ktm') && net.routes.longName[r] === line.name) return r;
  }
  return null;
}

function stationLine(net: TransitNetwork | null, line: RailLine, routeIndex: number | null): StationLine {
  return {
    line,
    routeIndex,
    routeId: net && routeIndex != null ? net.routes.id[routeIndex] : null,
    badge: lineBadgeLabel(line),
    name: lineDisplayName(line),
  };
}

/** A line for a route on the board that the station's own list lacks. */
function lineOfRoute(net: TransitNetwork, r: number): RailLine {
  const mode = RAIL_MODE_OF[MODES[net.routes.mode[r]]] ?? 'LRT';
  return {
    code: net.routes.label[r],
    mode,
    name: net.routes.longName[r] || net.routes.label[r],
    color: net.routes.color[r] || '#000000',
    textColor: net.routes.textColor[r] || '#FFFFFF',
  };
}

function rowView(row: BoardRow, lineName: string, clock: (ms: number) => string): BoardRowView {
  const text = boardText(row.next, mins, clock);
  const next = row.next;
  const rolling =
    next.kind === 'headway' && next.headwaySec > HEADWAY_ONLY_MAX_SEC
      ? Math.max(1, Math.floor(next.nextAboutSec / 60))
      : null;
  return {
    towards: row.towards,
    primary: text.primary,
    secondary: text.secondary,
    rolling,
    spoken: `${lineName} towards ${row.towards}, ${text.spoken}`,
    dir: row.dir,
    scheduled: next.kind === 'timetable',
  };
}

function footerOf(rows: readonly BoardRow[], clock: (ms: number) => string): { footer: string | null; footerSpoken: string | null } {
  let first: number | null = null;
  let last: number | null = null;
  for (const r of rows) {
    if (r.first != null && (first == null || r.first < first)) first = r.first;
    if (r.last != null && (last == null || r.last > last)) last = r.last;
  }
  if (first == null || last == null) return { footer: null, footerSpoken: null };
  return {
    footer: `First ${clock(first)} · Last ${clock(last)}`,
    footerSpoken: `First train ${clock(first)}, last train ${clock(last)}`,
  };
}

const FEED_NOUN: Record<FeedId, string> = {
  rail: 'Rail',
  ktm: 'KTM',
  'bus-kl': 'Rapid KL bus',
  feeder: 'MRT feeder bus',
};

/**
 * The walk row's note, seen from this station. Curated notes are written
 * from the `a` end, so a "Walk to …" note read at the `b` end would point
 * back here (on KTM KL Sentral: "Walk to the KTM platforms"). There the note
 * names the other end instead: its platforms when both share a name, else
 * the station. Notes that read both ways ("Walk between …") stay as they are.
 */
export function interchangeNote(ic: Interchange, atA: boolean, here: RailStation, other: RailStation): string {
  if (atA || !ic.note.startsWith('Walk to ')) return ic.note;
  const modes = [...new Set(other.lines.map((l) => l.mode))];
  const ktmOnly = modes.length > 0 && modes.every((m) => m === 'KTM');
  if (other.name === here.name && modes.length > 0) {
    return `Walk to the ${modes.join(' and ')} platforms in ${other.name}`;
  }
  return `Walk to ${ktmOnly ? 'KTM ' : ''}${other.name}`;
}

function interchangesOf(net: TransitNetwork | null, station: RailStation): InterchangeView[] {
  const mine = new Set(station.stopIds);
  const best = new Map<string, { other: RailStation; ic: Interchange; atA: boolean }>();
  for (const ic of RAIL_INTERCHANGES) {
    const atA = mine.has(ic.a);
    const otherId = atA ? ic.b : mine.has(ic.b) ? ic.a : null;
    // Both ends here: a pair already merged into this station.
    if (otherId == null || mine.has(otherId)) continue;
    const other = stationOfStop(net, otherId);
    if (!other || other.id === station.id) continue;
    const prev = best.get(other.id);
    if (!prev || ic.seconds < prev.ic.seconds) best.set(other.id, { other, ic, atA });
  }
  return [...best.values()]
    .sort((x, y) => x.ic.seconds - y.ic.seconds || x.other.name.localeCompare(y.other.name))
    .map(({ other, ic, atA }) => {
      const m = Math.max(1, Math.round(ic.seconds / 60));
      const walk = ic.verified ? `${m} min walk` : `about ${m} min walk`;
      const lines = other.lines.map(lineDisplayName);
      const spokenWalk = `${ic.verified ? '' : 'about '}${m} minute walk`;
      const note = interchangeNote(ic, atA, station, other);
      return {
        stationId: other.id,
        name: other.name,
        colors: [...new Set(other.lines.map((l) => l.color))],
        walk,
        note,
        spoken: [other.name, ...(lines.length ? [[...new Set(lines)].join(', ')] : []), spokenWalk].join(', ') + `. ${note}`,
      };
    });
}

/** When the next departure of a bus row is, for picking the soonest; closed rows last. */
function soonest(next: NextDeparture, now: number): number {
  switch (next.kind) {
    case 'headway':
      return now + next.nextAboutSec * 1000;
    case 'timetable':
      return next.times[0] ?? Number.POSITIVE_INFINITY;
    case 'closed':
      return Number.POSITIVE_INFINITY;
  }
}

function busNext(next: NextDeparture, clock: (ms: number) => string): { text: string; spoken: string; scheduled: boolean } {
  switch (next.kind) {
    case 'headway': {
      // Same honesty rule as rail: a headway is never shown as a clock time.
      const every = Math.max(1, Math.round(next.headwaySec / 60));
      return { text: `every ${mins(every)}`, spoken: `every ${spokenMins(every)}`, scheduled: false };
    }
    case 'timetable': {
      const at = clock(next.times[0]);
      return { text: `next ${at}`, spoken: `Scheduled, next bus ${at}`, scheduled: true };
    }
    case 'closed':
      return next.reopensAt == null
        ? { text: 'No more buses today', spoken: 'No more buses today', scheduled: false }
        : {
            text: `first ${clock(next.reopensAt)}`,
            spoken: `Scheduled, first bus ${clock(next.reopensAt)}`,
            scheduled: true,
          };
  }
}

const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function nearbyOf(
  net: TransitNetwork,
  station: RailStation,
  now: number,
  clock: (ms: number) => string,
  tripRouteCode: string | null,
  tripStopId: string | null,
): NearbyStopView[] {
  const here = { lat: station.lat, lng: station.lng };
  const hits = stopsNear(net, station.lat, station.lng, NEARBY_RADIUS_M)
    .filter((s) => {
      const feed = FEED_IDS[net.stops.feed[s]];
      return feed === 'bus-kl' || feed === 'feeder';
    })
    .map((s) => ({ s, d: haversineMeters(here, { lat: net.stops.lat[s], lng: net.stops.lon[s] }) }))
    .sort((a, b) => a.d - b.d || a.s - b.s);

  const out: NearbyStopView[] = [];
  for (const { s, d } of hits) {
    if (out.length >= NEARBY_MAX) break;
    const rows = stopDepartures(net, s, now);
    if (rows.length === 0) continue; // arrivals only: nothing to board here
    // The first row per route: the soonest of its directions.
    const perRoute = new Map<string, BoardRow>();
    for (const r of rows) {
      const label = net.routes.label[r.route];
      const prev = perRoute.get(label);
      if (!prev || soonest(r.next, now) < soonest(prev.next, now)) perRoute.set(label, r);
    }
    const stopId = net.stops.id[s];
    const isTripStop = tripStopId != null && stopId === tripStopId;
    // The trip's route when it calls here, else the soonest departure.
    const pick =
      isTripStop && tripRouteCode != null && perRoute.has(tripRouteCode)
        ? tripRouteCode
        : [...perRoute.keys()].sort(
            (a, b) => soonest(perRoute.get(a)!.next, now) - soonest(perRoute.get(b)!.next, now) || byLabel(a, b),
          )[0];
    const row = perRoute.get(pick)!;
    const next = busNext(row.next, clock);
    const walkMin = Math.max(1, walkingMinutes(d));
    const name = formatStopName(net.stops.name[s]);
    const others = [...perRoute.keys()].filter((l) => l !== pick).sort(byLabel);
    const spokenPlace = `Route ${pick}, ${name}, ${walkMin} minute walk`;
    const spokenAlso = others.length ? `. Also ${others.join(', ')}` : '';
    out.push({
      stopIndex: s,
      stopId,
      name,
      routeLabel: pick,
      route: row.route,
      pattern: row.pattern,
      others,
      walk: `${walkMin} min walk`,
      next: next.text,
      scheduled: next.scheduled,
      isTrip: isTripStop && pick === tripRouteCode,
      spoken: `${spokenPlace}, ${next.spoken}${spokenAlso}`,
      spokenPlace,
      spokenAlso,
    });
  }
  return out;
}

/**
 * Everything the station sheet shows, or null for an unknown station id.
 * The station comes from the network, else the bundled `RAIL_STATIONS`
 * (an expired rail feed is left out of the network but its stations and
 * lines still render).
 */
export function buildStationSheet(i: StationSheetInput): StationSheetModel | null {
  const { net, health, stationId, now } = i;
  const clock = i.clock ?? formatClockHHMM;
  const index = net ? stationIndexById(net, stationId) : -1;
  const station = net && index >= 0 ? net.stations[index] : bundled(stationId);
  if (!station) return null;

  const board = net && index >= 0 ? stationBoard(net, index, now) : null;
  const feeds = [...new Set(station.stopIds.map(feedOfStopId))];
  const expired = feeds.filter((f) => health?.[f]?.state === 'expired');
  const reason: UnavailableReason | null =
    expired.length > 0 ? 'expired' : !net || !board ? 'no-network' : board.stale ? 'stale' : null;
  const unavailable = reason != null;

  // Lines: the station's own, in its order, then any route the board adds.
  const lines: StationLine[] = station.lines.map((l) => stationLine(net, l, net ? routeOfLine(net, l) : null));
  if (net && board && !unavailable) {
    for (const r of board.rows) {
      if (lines.some((l) => l.routeIndex === r.route)) continue;
      lines.push(stationLine(net, lineOfRoute(net, r.route), r.route));
    }
  }
  // KTM stations list one line per route under the same code: keep each name once.
  const seen = new Set<string>();
  const uniqueLines = lines.filter((l) => (seen.has(l.line.name) ? false : (seen.add(l.line.name), true)));

  const boards: StationBoardView[] = uniqueLines.map((line) => {
    const rows = unavailable || !board ? [] : board.rows.filter((r) => r.route === line.routeIndex);
    return {
      line,
      rows: rows.map((r) => rowView(r, line.name, clock)),
      ...(unavailable ? { footer: null, footerSpoken: null } : footerOf(rows, clock)),
    };
  });

  return {
    station,
    lines: uniqueLines,
    boards,
    unavailable,
    reason,
    unavailableNote:
      reason === 'expired' ? `${FEED_NOUN[expired[0]]} timetable from data.gov.my has expired.` : null,
    interchanges: interchangesOf(net, station),
    nearby: net ? nearbyOf(net, station, now, clock, i.tripRouteCode ?? null, i.tripStopId ?? null) : [],
  };
}
