import { HEADWAY_ONLY_MAX_SEC, TRANSFER_KIND, type Itinerary, type Leg, type TransitNetwork } from '@bus-tracker/shared';

import { formatDistance, formatStopName } from '@/components/map/format';
import { durationLabel, rideChip, routeInfoOf, warningNote, type Chip, type Clock } from '@/components/plan/results';
import { mins } from '@/components/trip/model';

/**
 * Pure model for the itinerary sheet (spec §6.3, 15/05): the timeline's
 * rows, the rail between them, what VoiceOver reads for each, the notes
 * above it, and which itinerary the sheet shows once a retime renames it.
 * No React Native imports, so it runs under `tsx --test`. Clocks are
 * injected (`formatClockHHMM` in the app).
 */

type Ride = Extract<Leg, { kind: 'ride' }>;
type Walk = Extract<Leg, { kind: 'walk' }>;
export type RideChip = Exclude<Chip, { kind: 'walk' }>;

/** A walk shorter than this at either end is a snap to the stop: no row (as the result chips). */
const SNAP_WALK_SEC = 30;

const isRide = (l: Leg): l is Ride => l.kind === 'ride';
const isBus = (l: Ride) => l.mode === 'bus' || l.mode === 'feeder';
const walkMinutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const spokenMinutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));
const everyMinutes = (headwaySec: number) => Math.max(1, Math.round(headwaySec / 60));

/**
 * Rapid Rail headsigns read "From KL Sentral to Titiwangsa"; the rider wants
 * only where the train is going. Other headsigns pass through.
 */
export function railHeadsign(headsign: string): string {
  return /^from\s+.+?\s+to\s+(.+)$/i.exec(headsign.trim())?.[1] ?? headsign;
}

/**
 * A row's time. Rail is never live: a turn-up-and-go leg every 5 minutes or
 * less shows `every` instead of a time, and a longer headway's times are
 * `about` (the station board's rule). Live only for a bus re-timed from a
 * real position; everything else, KTM included, is `scheduled`.
 */
export type TimeCell =
  | { kind: 'live' | 'scheduled' | 'about'; at: number }
  | { kind: 'every'; minutes: number }
  | null;

export type TimelineEnd = 'origin' | 'destination';

export type TimelineRow =
  | { kind: 'end'; which: TimelineEnd; time: TimeCell; name: string }
  | {
      kind: 'board' | 'alight';
      legIndex: number;
      node: 'stop' | 'station';
      time: TimeCell;
      name: string;
      /** The rail station here (`/station?station=`), for a rail leg. */
      stationId: string | null;
      /** Line colour for rail, null for a bus (ink). */
      color: string | null;
      liveNote: string | null;
      /** The journey starts or ends here (no walk to or from the stop): drawn as the end pin. */
      end: TimelineEnd | null;
    }
  | {
      kind: 'walk';
      legIndex: number;
      minutes: number;
      meters: number;
      label: string;
      /** An unverified curated interchange: "about 4 mins walk". */
      about: boolean;
      /** Between two rides: "Change · walk 3 mins". */
      change: boolean;
    }
  | {
      kind: 'ride';
      legIndex: number;
      chip: RideChip;
      headsign: string;
      /** Stops passed on the way, board and alight excluded. */
      stops: string[];
      minutes: number;
      /** 'ink' for a bus, else the line colour. */
      rail: 'ink' | string;
    };

/** What the timeline reads from the network: route names and colours, stations, transfer kinds. */
export type TimelineNet = Pick<TransitNetwork, 'routes' | 'stops' | 'stations' | 'transfers'>;

/** "#RRGGBB" whether or not the feed wrote the '#'. */
function lineColor(c: string): string {
  return /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : c;
}

function stationIdOf(net: TimelineNet, stop: number | undefined): string | null {
  if (stop == null) return null;
  const s = net.stops.station[stop];
  return s != null && s >= 0 ? (net.stations[s]?.id ?? null) : null;
}

/** A curated interchange whose walking time hasn't been checked on foot. */
function unverifiedInterchange(net: TimelineNet, l: Walk): boolean {
  const a = l.from.stop;
  const b = l.to.stop;
  if (a == null || b == null) return false;
  const T = net.transfers;
  for (let k = T.start[a], end = T.start[a] + T.len[a]; k < end; k++) {
    if (T.to[k] === b) return T.kind[k] === TRANSFER_KIND.interchange;
  }
  return false;
}

function boardTime(l: Ride): TimeCell {
  switch (l.timing.kind) {
    case 'live':
      return { kind: 'live', at: l.from.time };
    case 'headway':
      return l.timing.headwaySec <= HEADWAY_ONLY_MAX_SEC
        ? { kind: 'every', minutes: everyMinutes(l.timing.headwaySec) }
        : { kind: 'about', at: l.from.time };
    default:
      return { kind: 'scheduled', at: l.from.time };
  }
}

function sourceOf(l: Ride | undefined): 'live' | 'scheduled' | 'about' {
  if (!l) return 'scheduled';
  return l.timing.kind === 'live' ? 'live' : l.timing.kind === 'headway' ? 'about' : 'scheduled';
}

const isSnap = (l: Leg) => l.kind === 'walk' && l.seconds < SNAP_WALK_SEC;

/**
 * The §6.3 timeline, top to bottom: the start, each leg (a walk row, or a
 * ride's board, ride and alight rows), the destination. A snap walk (under
 * 30 s) at either end has no row; when a ride then starts or ends the
 * journey, its board or alight row carries `end` instead of a separate end
 * row. Bus stop names are display-cased; rail names already are.
 */
export function timelineRows(it: Itinerary, net: TimelineNet, clock: Clock): TimelineRow[] {
  const routes = routeInfoOf(net);
  const legs = it.legs;
  const rows: TimelineRow[] = [];
  if (legs.length === 0) return rows;
  let first = 0;
  let last = legs.length - 1;
  while (first < last && isSnap(legs[first])) first++;
  while (last > first && isSnap(legs[last])) last--;
  const rides = legs.filter(isRide);
  const firstRide = rides[0];
  const lastRide = rides[rides.length - 1];

  const head = legs[first];
  if (head.kind === 'walk') {
    rows.push({ kind: 'end', which: 'origin', time: { kind: sourceOf(firstRide), at: it.departAt }, name: head.from.name });
  }

  for (let i = first; i <= last; i++) {
    const l = legs[i];
    if (l.kind === 'walk') {
      const change = i > first && i < last && legs[i - 1].kind === 'ride' && legs[i + 1].kind === 'ride';
      const about = change && unverifiedInterchange(net, l);
      const m = walkMinutes(l.seconds);
      const label = change
        ? about
          ? `Change · about ${mins(m)} walk`
          : `Change · walk ${mins(m)}`
        : `Walk ${mins(m)} · ${formatDistance(l.meters)}`;
      rows.push({ kind: 'walk', legIndex: i, minutes: m, meters: l.meters, label, about, change });
      continue;
    }
    const bus = isBus(l);
    const name = (p: { name: string }) => (bus ? formatStopName(p.name) : p.name);
    const color = bus ? null : lineColor(l.color);
    const node = bus ? 'stop' : 'station';
    const source = sourceOf(l);
    rows.push({
      kind: 'board',
      legIndex: i,
      node,
      time: boardTime(l),
      name: name(l.from),
      stationId: bus ? null : stationIdOf(net, l.from.stop),
      color,
      liveNote: l.timing.kind === 'live' ? `Live · as of ${clock(l.timing.asOf)}` : null,
      end: i === first ? 'origin' : null,
    });
    rows.push({
      kind: 'ride',
      legIndex: i,
      chip: rideChip(l, routes),
      headsign: bus ? formatStopName(l.headsign) : railHeadsign(l.headsign),
      stops: l.via.map(name),
      minutes: minutesBetween(l.from.time, l.to.time),
      rail: color ?? 'ink',
    });
    rows.push({
      kind: 'alight',
      legIndex: i,
      node,
      time: { kind: source, at: l.to.time },
      name: name(l.to),
      stationId: bus ? null : stationIdOf(net, l.to.stop),
      color,
      liveNote: null,
      end: i === last ? 'destination' : null,
    });
  }

  const tail = legs[last];
  if (tail.kind === 'walk') {
    rows.push({ kind: 'end', which: 'destination', time: { kind: sourceOf(lastRide), at: it.arriveAt }, name: tail.to.name });
  }
  return rows;
}

/** The rail between two consecutive rows: ink for a bus, the line colour, dots for a walk, a gap for a same-stop change. */
export type RailStyle = { kind: 'ink' } | { kind: 'line'; color: string } | { kind: 'walk' } | { kind: 'gap' };

export function railBetween(a: TimelineRow, b: TimelineRow): RailStyle {
  if (a.kind === 'walk' || b.kind === 'walk') return { kind: 'walk' };
  if (a.kind === 'board') return a.color ? { kind: 'line', color: a.color } : { kind: 'ink' };
  if (a.kind === 'ride') return a.rail === 'ink' ? { kind: 'ink' } : { kind: 'line', color: a.rail };
  return { kind: 'gap' };
}

/** "6 stops · 14 mins": the stops ridden (board to alight) and the time on board. */
export function rideSummary(row: Extract<TimelineRow, { kind: 'ride' }>): string {
  const n = row.stops.length + 1;
  return `${n} ${n === 1 ? 'stop' : 'stops'} · ${mins(row.minutes)}`;
}

/** "T816", or a rail line by name ("Kajang Line"). */
function rideName(chip: RideChip): string {
  return chip.kind === 'bus' ? chip.label : chip.name;
}

function spokenTime(t: TimeCell, clock: Clock): string | null {
  if (!t || t.kind === 'every') return null;
  return t.kind === 'about' ? `about ${clock(t.at)}` : clock(t.at);
}

/** "live" / "scheduled" / "every 6 minutes" after the time; "about" is already in it. */
function spokenSource(t: TimeCell): string | null {
  if (!t) return null;
  switch (t.kind) {
    case 'live':
      return 'live';
    case 'scheduled':
      return 'scheduled';
    case 'every':
      return `every ${spokenMinutes(t.minutes)}`;
    default:
      return null;
  }
}

/**
 * One VoiceOver label per row, never relying on colour or glyphs:
 * "9:05, board T816 at Hotel Lisa De Inn towards MRT Phileo Damansara,
 * live, as of 08:41" or "Kajang Line towards Kajang, every 6 minutes, 7
 * stops, 15 minutes".
 */
export function timelineLabels(rows: readonly TimelineRow[], clock: Clock): string[] {
  return rows.map((row, i) => {
    switch (row.kind) {
      case 'end': {
        const verb = row.which === 'origin' ? 'Start at' : 'Arrive at';
        return join([spokenTime(row.time, clock), `${verb} ${row.name}`, spokenSource(row.time)]);
      }
      case 'board': {
        const ride = rows[i + 1]?.kind === 'ride' ? (rows[i + 1] as Extract<TimelineRow, { kind: 'ride' }>) : null;
        const what = ride ? `board ${rideName(ride.chip)} at ${row.name} towards ${ride.headsign}` : `board at ${row.name}`;
        const note = row.liveNote ? row.liveNote.replace(/^Live · /, '') : null;
        return join([spokenTime(row.time, clock), what, spokenSource(row.time), note]);
      }
      case 'alight':
        return join([spokenTime(row.time, clock), `get off at ${row.name}`, spokenSource(row.time)]);
      case 'ride': {
        const n = row.stops.length + 1;
        const lead = row.chip.kind === 'bus' ? `Bus ${row.chip.label}` : row.chip.name;
        return join([
          `${lead} towards ${row.headsign}`,
          row.chip.every != null ? `every ${spokenMinutes(row.chip.every)}` : null,
          `${n} ${n === 1 ? 'stop' : 'stops'}`,
          spokenMinutes(row.minutes),
        ]);
      }
      case 'walk':
        if (row.change) {
          return row.about ? `Change, about ${spokenMinutes(row.minutes)} walk` : `Change, walk ${spokenMinutes(row.minutes)}`;
        }
        return `Walk ${spokenMinutes(row.minutes)}, ${formatDistance(row.meters)}`;
    }
  });
}

function join(parts: (string | null)[]): string {
  const s = parts.filter(Boolean).join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Arrive 9:52 · 38 mins": the itinerary sheet's subtitle. */
export function headerSubtitle(it: Itinerary, clock: Clock): string {
  return `Arrive ${clock(it.arriveAt)} · ${durationLabel(it)}`;
}

/**
 * The notes above the timeline. A missed connection is one orange note
 * with the old arrival ("Connection missed. Times updated · was 9:12").
 * Otherwise any warning, then "Updated · was 9:12" for as long as the
 * retime that moved the arrival holds (the detail keeps it; the row flashes it).
 */
export function detailNotes(it: Itinerary, clock: Clock): { text: string; urgent: boolean }[] {
  const was = it.previousArriveAt;
  const moved = was != null && Math.abs(was - it.arriveAt) >= 60_000 ? clock(was) : null;
  const warning = warningNote(it);
  if (it.warnings.includes('missed-connection')) {
    return [{ text: moved ? `${warning} · was ${moved}` : (warning ?? ''), urgent: true }];
  }
  const out: { text: string; urgent: boolean }[] = [];
  if (warning) out.push({ text: warning, urgent: false });
  if (moved) out.push({ text: `Updated · was ${moved}`, urgent: false });
  return out;
}

/** Network route ids of the rail legs ('rail:KJ'), deduped: the map's rail focus. */
export function railRouteIds(it: Itinerary, net: Pick<TransitNetwork, 'routes'>): string[] {
  const ids = new Set<string>();
  for (const l of it.legs) {
    if (l.kind === 'ride' && !isBus(l)) {
      const id = net.routes.id[l.route];
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * The itinerary that took over from `prev` after a retime re-planned its
 * tail (the leg sequence, and so the id, changed): the one whose first ride
 * is the same route, from the same stop, on the same trip. Null when the
 * first ride itself changed, or `prev` has no ride.
 */
export function findSuccessor(prev: Itinerary, its: readonly Itinerary[]): Itinerary | null {
  const a = prev.legs.find(isRide);
  if (!a) return null;
  return (
    its.find((it) => {
      const b = it.legs.find(isRide);
      return b != null && b.route === a.route && b.from.stop === a.from.stop && b.tripKey === a.tripKey;
    }) ?? null
  );
}

/** The sheet's choice: the id it opened, and that id's position in the results then. */
export interface OpenRef {
  id: string;
  index: number;
}

/**
 * Which itinerary the sheet shows, so it is never empty while there are
 * results:
 * 1. the open id, while the results still have it;
 * 2. otherwise `prev`'s successor (a tail re-plan renamed it);
 * 3. otherwise the itinerary at the same position (its first ride changed);
 * 4. with no results at all (a re-plan in flight), `prev` as it was.
 * The provider then moves the open id to the answer, so it stays in step
 * with the results.
 */
export function resolveOpen(open: OpenRef | null, prev: Itinerary | null, its: readonly Itinerary[]): Itinerary | null {
  if (!open) return null;
  const same = its.find((it) => it.id === open.id);
  if (same) return same;
  if (its.length === 0) return prev;
  const next = prev ? findSuccessor(prev, its) : null;
  if (next) return next;
  return its[Math.min(Math.max(0, open.index), its.length - 1)];
}

/** Where Go (15/06) is: the current leg and its phase (`JourneyProgress`). */
export interface TimelineProgress {
  legIndex: number;
  phase: 'walking' | 'waiting' | 'riding' | 'next-is-yours' | 'leg-done' | 'arrived';
}

/**
 * A row against Go's progress: `done` fills its node (a stop you've left or
 * reached), `ahead` dims its rail (legs after the current one). The start
 * is done once you go; the destination once you've arrived.
 */
export function rowProgress(row: TimelineRow, p: TimelineProgress): { done: boolean; ahead: boolean } {
  const arrived = p.phase === 'arrived';
  if (row.kind === 'end') return row.which === 'origin' ? { done: true, ahead: false } : { done: arrived, ahead: !arrived };
  const cur = p.legIndex;
  const L = row.legIndex;
  const ahead = L > cur;
  if (row.kind === 'board') {
    const boarded = p.phase !== 'walking' && p.phase !== 'waiting';
    return { done: L < cur || (L === cur && boarded), ahead };
  }
  if (row.kind === 'alight') return { done: L < cur || (L === cur && (p.phase === 'leg-done' || arrived)), ahead };
  return { done: L < cur, ahead };
}
