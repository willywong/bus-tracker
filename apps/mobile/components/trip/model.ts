/**
 * Pure presentation model for the trip sheet. Every visible string and state
 * decision lives here so the rules from docs/design/README.md (§3.2) are in
 * one testable place and the views stay dumb.
 */

import type { RainCondition } from '@/services/weather/types';

export type ArrivalStatusLike = 'en-route' | 'arriving' | 'arrived' | 'passed';

export interface ArrivalLike {
  kind: 'live' | 'sched';
  epochMs: number;
  tripId: string | null;
}

export interface DelayLike {
  delayMinutes: number;
  onTimeWindow: 'on-time' | 'late' | 'early';
}

export interface TripModelInput {
  hasFavorites: boolean;
  /** Static route data + first ETA composition are available. */
  ready: boolean;
  now: number;
  /** 'live' | 'schedule' | 'none' from resolveEta. */
  mode: 'live' | 'schedule' | 'none';
  /** Minutes to the primary arrival (integer, ≥ 0). */
  minutesToStop: number | null;
  primaryArrival: ArrivalLike | null;
  /** Later arrivals in time order (secondary first), may include duplicates of primary. */
  laterArrivals: readonly ArrivalLike[];
  arrivalStatus: ArrivalStatusLike;
  delay: DelayLike | null;
  serviceEnded: boolean;
  beforeServiceStart: boolean;
  firstBusToday: number | null;
  lastBusToday: number | null;
  /** Live vehicles currently reporting on the route. */
  liveBusCount: number;
  /** Epoch ms of the last successful realtime poll. */
  lastUpdated: number | null;
  feedError: boolean;
  /** Stops between the tracked bus and the user's stop. */
  stopsAhead: number | null;
  /** "Stopped at a traffic light" etc. Null when moving normally / unknown. */
  motionLabel: string | null;
  walkMinutes: number;
  walkRemainingSeconds: number | null;
  isFollowing: boolean;
  formatClock: (epochMs: number) => string;
  /** Route code, for copy ("No bus on T816 is reporting yet"). */
  routeCode?: string;
  /**
   * Plausible vehicles in the whole feeder feed on the last poll (every
   * route, not just this one). 0 during service hours means data.gov.my's
   * live feed is down, not that this route is quiet. Null before first poll.
   */
  feedVehicleCount?: number | null;
  /** Stop the tracked live bus is at or heading toward. */
  busNearStopName?: string | null;
  /** A weather nudge to show, e.g. from MET Malaysia warnings. */
  rainNudge?: {
    condition: RainCondition;
    title: string;
    message: string;
  } | null;
}

export type TripState =
  | 'empty'
  | 'loading'
  | 'arrival'
  | 'before-service'
  | 'service-ended'
  | 'no-service';

export type SourceKind = 'live' | 'aging' | 'scheduled';

export interface HeroValue {
  /** Digits ("4"), a word ("Due"), or a clock time ("10:42"). */
  text: string;
  /** "min" when `text` is a minute count, else null. */
  unit: string | null;
  kind: 'minutes' | 'word' | 'clock';
}

export type TripAction =
  | { kind: 'none' }
  | { kind: 'follow'; leaveInMinutes: number; following: boolean }
  | { kind: 'leave-now'; following: boolean }
  | { kind: 'walking'; remainingSeconds: number }
  | { kind: 'tight' };

/** Why live data is missing, when it is. */
export type FeedHealth = 'ok' | 'route-quiet' | 'feed-down' | 'unreachable';

export interface TripNote {
  id: 'feed-down' | 'offline' | 'ghost' | 'last-bus' | 'rain' | 'bunching' | 'where-from';
  /** SF Symbol name. */
  icon: string;
  /** Bold first line of a warning ("Thunderstorms likely this afternoon"); `text` follows it, quieter. */
  title?: string;
  text: string;
  tone: 'info' | 'warning';
  /** Key/value form for a hairline row ("Last bus" · "23:41"); else `text` is shown. */
  label?: string;
  value?: string;
}

/** The bus after the one in the hero, and what missing the hero costs. */
export interface NextBus {
  /** Clock time, "21:41". */
  clock: string;
  /** Wait after the hero bus, "+39 min" — the cost of missing it. */
  wait: string;
  live: boolean;
}

/** One fact under the hero: label, value, one line of context. */
export interface TripFact {
  id: 'position';
  /** "Your bus". */
  label: string;
  /** "2 stops away". */
  value: string;
  /** "Near Komersial SS19/8", "in 33 mins". */
  caption: string | null;
}

/**
 * "Live · 8 min late" with "Updated 10:22" on the trailing edge, or
 * "Scheduled · no live buses reporting".
 */
export interface SourceLine {
  label: string;
  /** How the bus runs (timing, else motion), or why there's no live data. */
  note: string | null;
  /** Freshness of the live fix, right-aligned and quiet. */
  updated: string | null;
  /** "Arrives 10:56 AM" beside the minutes; null when the hero is a clock. */
  arrives: string | null;
  /** The bare clock time of `arrives` ("10:56 AM"), for the bus bar. */
  arrivesAt: string | null;
}

export interface TripModel {
  state: TripState;
  hero: HeroValue | null;
  /** Small line above the hero for clock-time heroes ("First bus"). */
  heroEyebrow: string | null;
  source: SourceKind;
  status: string;
  detail: string | null;
  then: string | null;
  /** One-line ETA for the peek detent and the toolbar. */
  compact: string | null;
  /** The following bus, shown as the "Then" row. */
  next: NextBus | null;
  action: TripAction;
  accessibilityLabel: string;
  /** "as of 08:41" next to a live status, so a frozen number can't pass as fresh. */
  freshness: string | null;
  feedHealth: FeedHealth;
  /** Supporting facts under the hero, most important first (max {@link MAX_NOTES}). */
  notes: TripNote[];
  /** Glyph + word line under the hero: where the number comes from. */
  sourceLine: SourceLine;
  /** Where the bus is, timing against the timetable, the next bus. */
  facts: TripFact[];
}

/** Age after which a live ETA is shown as "Updated N min ago". */
export const AGING_AFTER_MS = 60_000;
/** Inside this many minutes before you need to leave, the action flips to "Leave now". */
export const LEAVE_NOW_WINDOW_MIN = 2;
/** A scheduled bus this close with nothing on the route reporting may not run. */
export const GHOST_WINDOW_MIN = 15;
/** Two live buses closer than this are bunched. */
export const BUNCHED_MIN = 5;
/** Start mentioning the last bus this long before it leaves. */
export const LAST_BUS_HEADS_UP_MS = 3 * 60 * 60_000;
export const MAX_NOTES = 3;

/** The weather's own glyph, drawn in the warning's orange. */
const RAIN_ICON: Record<RainCondition, string> = {
  thunderstorm: 'cloud.bolt.rain.fill',
  rain: 'cloud.rain.fill',
  'heavy-rain': 'cloud.heavyrain.fill',
  flood: 'water.waves',
};

export function buildTripModel(input: TripModelInput): TripModel {
  const source = sourceOf(input);

  if (!input.hasFavorites) {
    return base('empty', source, input, {
      status: '',
      accessibilityLabel: 'No bus selected',
    });
  }
  if (!input.ready) {
    return base('loading', source, input, {
      status: 'Loading timetable…',
      accessibilityLabel: 'Loading',
    });
  }

  if (input.primaryArrival == null || input.minutesToStop == null) {
    if (input.serviceEnded) {
      return base('service-ended', 'scheduled', input, {
        status: 'No more buses today',
        detail:
          input.firstBusToday != null
            ? null
            : input.lastBusToday != null
              ? `Last bus left at ${input.formatClock(input.lastBusToday)}`
              : null,
        accessibilityLabel: 'No more buses today',
      });
    }
    if (input.beforeServiceStart && input.firstBusToday != null) {
      const clock = input.formatClock(input.firstBusToday);
      const until = Math.max(0, Math.floor((input.firstBusToday - input.now) / 60_000));
      return base('before-service', 'scheduled', input, {
        hero: { text: clock, unit: null, kind: 'clock' },
        heroEyebrow: 'First bus',
        status: 'Scheduled',
        detail: until > 0 ? `In ${formatDuration(until)}` : null,
        compact: clock,
        accessibilityLabel: `First bus at ${clock}`,
      });
    }
    return base('no-service', 'scheduled', input, {
      status: input.feedError ? "Can't reach live data" : 'No buses scheduled right now',
      notes: compactNotes([lastBusNote(input, null)]),
      accessibilityLabel: 'No buses scheduled right now',
    });
  }

  const minutes = Math.max(0, Math.floor(input.minutesToStop));
  const isLive = input.primaryArrival.kind === 'live' && input.mode === 'live';
  const hero = heroFor(minutes, isLive, input);
  const shownSource: SourceKind = isLive ? source : 'scheduled';
  const feedHealth = feedHealthOf(input);

  return {
    state: 'arrival',
    hero,
    heroEyebrow: null,
    source: shownSource,
    status: statusFor(shownSource, input),
    detail: shownSource === 'scheduled' ? null : detailFor(input),
    then: thenFor(input),
    next: nextFor(input),
    compact: hero.unit ? `${hero.text} ${hero.unit}` : hero.text,
    action: actionFor(minutes, hero, input),
    accessibilityLabel: a11yFor(hero, shownSource, input),
    freshness:
      shownSource === 'live' && input.lastUpdated != null
        ? `as of ${input.formatClock(input.lastUpdated)}`
        : null,
    feedHealth,
    notes: arrivalNotes(minutes, isLive, feedHealth, input),
    sourceLine: sourceLineFor(shownSource, input),
    facts: factsFor(shownSource, input),
  };
}

function base(
  state: TripState,
  source: SourceKind,
  input: TripModelInput,
  patch: Partial<TripModel> & { status: string; accessibilityLabel: string },
): TripModel {
  return {
    state,
    hero: null,
    heroEyebrow: null,
    source,
    detail: null,
    then: null,
    compact: null,
    next: null,
    action:
      input.walkRemainingSeconds != null
        ? { kind: 'walking', remainingSeconds: input.walkRemainingSeconds }
        : { kind: 'none' },
    freshness: null,
    feedHealth: feedHealthOf(input),
    notes: [],
    sourceLine: {
      label: patch.status,
      note: null,
      updated: null,
      arrives: null,
      arrivesAt: null,
    },
    facts: [],
    ...patch,
  };
}

function sourceOf(input: TripModelInput): SourceKind {
  if (input.mode !== 'live') return 'scheduled';
  if (input.lastUpdated != null && input.now - input.lastUpdated >= AGING_AFTER_MS) {
    return 'aging';
  }
  return 'live';
}

function heroFor(minutes: number, isLive: boolean, input: TripModelInput): HeroValue {
  if (isLive && input.arrivalStatus === 'arrived') {
    return { text: 'At stop', unit: null, kind: 'word' };
  }
  if (isLive && input.arrivalStatus === 'arriving') {
    return { text: 'Arriving', unit: null, kind: 'word' };
  }
  if (minutes < 1) return { text: 'Due', unit: null, kind: 'word' };
  if (minutes >= 60 && input.primaryArrival) {
    return {
      text: input.formatClock(input.primaryArrival.epochMs),
      unit: null,
      kind: 'clock',
    };
  }
  return {
    text: String(minutes),
    unit: minutes === 1 ? 'min' : 'mins',
    kind: 'minutes',
  };
}

function feedHealthOf(input: TripModelInput): FeedHealth {
  if (input.feedError) return 'unreachable';
  if (input.liveBusCount > 0) return 'ok';
  if (input.feedVehicleCount === 0) return 'feed-down';
  // Unknown whole-feed count (first poll pending) reads as a quiet route.
  return 'route-quiet';
}

function statusFor(source: SourceKind, input: TripModelInput): string {
  if (source === 'scheduled') {
    // Why there's no live bus is a warning glyph beside the hero, not
    // words here.
    return 'Scheduled';
  }
  if (source === 'aging' && input.lastUpdated != null) {
    const age = Math.max(1, Math.floor((input.now - input.lastUpdated) / 60_000));
    return `Updated ${mins(age)} ago`;
  }
  const parts = ['Live'];
  const ahead = stopsAheadLabel(input.stopsAhead);
  if (ahead) parts.push(ahead);
  return parts.join(' · ');
}

function sourceLineFor(source: SourceKind, input: TripModelInput): SourceLine {
  const primary = input.primaryArrival;
  const arrivesAt =
    primary && input.minutesToStop != null && input.minutesToStop < 60
      ? input.formatClock(primary.epochMs)
      : null;
  return {
    ...sourceLineCore(source, input),
    arrives: arrivesAt ? `Arrives ${arrivesAt}` : null,
    arrivesAt,
  };
}

function sourceLineCore(
  source: SourceKind,
  input: TripModelInput,
): Omit<SourceLine, 'arrives' | 'arrivesAt'> {
  if (source === 'scheduled') {
    return { label: 'Scheduled', note: null, updated: null };
  }
  const note = timingValue(input.delay) ?? input.motionLabel ?? null;
  if (input.lastUpdated == null) return { label: 'Live', note, updated: null };
  if (source === 'aging') {
    const age = Math.max(1, Math.floor((input.now - input.lastUpdated) / 60_000));
    return { label: 'Live', note, updated: `Updated ${mins(age)} ago` };
  }
  return {
    label: 'Live',
    note,
    updated: `Updated ${input.formatClock(input.lastUpdated)}`,
  };
}

/**
 * The facts under the hero: live arrivals get where the bus is. Timing lives
 * in the source line; later buses live in the Today grid, where tapping one
 * opens its own small sheet. Rows are omitted, never shown empty.
 */
function factsFor(source: SourceKind, input: TripModelInput): TripFact[] {
  const facts: TripFact[] = [];
  if (source !== 'scheduled') {
    const n = input.stopsAhead;
    if (n != null && n >= 0) {
      // Motion only when timing took the source line's note.
      const motion = timingValue(input.delay) ? input.motionLabel : null;
      facts.push({
        id: 'position',
        label: 'Your bus',
        value: stopsAwayLabel(n),
        caption: input.busNearStopName ? `Near ${input.busNearStopName}` : motion,
      });
    }
  }
  return facts;
}

function timingValue(d: DelayLike | null): string | null {
  if (!d) return null;
  const m = Math.abs(Math.round(d.delayMinutes));
  if (d.onTimeWindow === 'on-time' || m === 0) return 'On time';
  return d.onTimeWindow === 'late' ? `${mins(m)} late` : `${mins(m)} early`;
}

/** "Next stop", "1 stop away", "4 stops away": where your bus is, as a value. */
export function stopsAwayLabel(n: number): string {
  return n === 0 ? 'Next stop' : n === 1 ? '1 stop away' : `${n} stops away`;
}

function stopsAheadLabel(n: number | null): string | null {
  if (n == null || n < 0) return null;
  if (n === 0) return 'next stop is yours';
  if (n === 1) return '1 stop away';
  return `${n} stops away`;
}

function detailFor(input: TripModelInput): string | null {
  if (input.motionLabel) return input.motionLabel;
  const d = input.delay;
  if (!d) return null;
  const m = Math.abs(Math.round(d.delayMinutes));
  if (d.onTimeWindow === 'on-time') return 'On schedule';
  if (d.onTimeWindow === 'late') return `${mins(m)} behind schedule`;
  return `${mins(m)} ahead of schedule`;
}

/**
 * "Then 18 · 34 min" while both are under an hour, else clock times for
 * both ("Then 21:41 · 22:11"); never a bare minute count beside a clock time.
 */
function thenFor(input: TripModelInput): string | null {
  const picks = distinctLater(input)
    .slice(0, 2)
    .map((a) => a.epochMs);
  if (picks.length === 0) return null;
  const away = picks.map((ms) => Math.max(0, Math.floor((ms - input.now) / 60_000)));
  if (away.every((m) => m < 60)) {
    return `Then ${away.join(' · ')} ${away[away.length - 1] === 1 ? 'min' : 'mins'}`;
  }
  return `Then ${picks.map((ms) => input.formatClock(ms)).join(' · ')}`;
}

function actionFor(minutes: number, hero: HeroValue, input: TripModelInput): TripAction {
  if (input.walkRemainingSeconds != null) {
    return { kind: 'walking', remainingSeconds: input.walkRemainingSeconds };
  }
  if (hero.kind === 'word' && hero.text !== 'Due') return { kind: 'none' };
  if (minutes < input.walkMinutes) return { kind: 'tight' };
  const leaveIn = minutes - input.walkMinutes;
  if (leaveIn <= LEAVE_NOW_WINDOW_MIN) {
    return { kind: 'leave-now', following: input.isFollowing };
  }
  return {
    kind: 'follow',
    leaveInMinutes: leaveIn,
    following: input.isFollowing,
  };
}

function a11yFor(hero: HeroValue, source: SourceKind, input: TripModelInput): string {
  const when =
    hero.kind === 'minutes'
      ? `in ${hero.text} ${hero.text === '1' ? 'minute' : 'minutes'}`
      : hero.kind === 'clock'
        ? `at ${hero.text}`
        : hero.text.toLowerCase();
  const src =
    source === 'live'
      ? 'live'
      : source === 'aging'
        ? 'live, last updated over a minute ago'
        : 'scheduled time';
  const ahead = stopsAheadLabel(input.stopsAhead);
  return `Next bus ${when}, ${src}${source !== 'scheduled' && ahead ? `, ${ahead}` : ''}`;
}

function arrivalNotes(
  minutes: number,
  isLive: boolean,
  feedHealth: FeedHealth,
  input: TripModelInput,
): TripNote[] {
  const primary = input.primaryArrival;
  if (!primary) return [];
  const later = distinctLater(input);
  const lastBus = input.lastBusToday;
  const isLast =
    lastBus != null &&
    primary.epochMs >= lastBus - 5 * 60_000 &&
    !later.some((a) => a.epochMs <= lastBus);

  const notes: (TripNote | null)[] = [];

  if (feedHealth === 'feed-down') {
    notes.push({
      id: 'feed-down',
      icon: 'antenna.radiowaves.left.and.right.slash',
      title: 'Live data is down',
      text: 'Every route is on the timetable for now',
      tone: 'warning',
    });
  }

  if (feedHealth === 'unreachable') {
    notes.push({
      id: 'offline',
      icon: 'wifi.slash',
      title: "Can't reach live data",
      text: 'Showing the timetable until you’re back online',
      tone: 'warning',
    });
  }

  // Ghost-trip guard: a bus due soon, nothing on the route reporting, while
  // the rest of the feed is healthy. Feeder routes are loops, so the bus
  // for this run is normally already out finishing its previous lap.
  if (
    !isLive &&
    feedHealth === 'route-quiet' &&
    (input.feedVehicleCount ?? 0) > 0 &&
    minutes <= GHOST_WINDOW_MIN
  ) {
    const route = input.routeCode ? `on ${input.routeCode} ` : '';
    notes.push({
      id: 'ghost',
      icon: 'questionmark.circle.fill',
      title: `No bus ${route}is reporting yet`,
      text: 'This one may not run',
      tone: 'warning',
    });
  }

  notes.push(lastBusNote(input, isLast ? primary.epochMs : null));

  if (input.rainNudge) {
    notes.push({
      id: 'rain',
      icon: RAIN_ICON[input.rainNudge.condition],
      title: input.rainNudge.title,
      text: input.rainNudge.message,
      tone: 'warning',
    });
  }

  notes.push(bunchingNote(isLive, later, input));

  // Only when the facts row can't carry it (no stop count to anchor it).
  if (
    isLive &&
    input.busNearStopName &&
    input.stopsAhead == null &&
    input.arrivalStatus === 'en-route'
  ) {
    notes.push({
      id: 'where-from',
      icon: 'location.circle',
      text: `Now near ${input.busNearStopName}`,
      tone: 'info',
    });
  }

  return compactNotes(notes);
}

/**
 * "This is the last bus today" for the final run, otherwise "Last bus 23:30"
 * once it's within {@link LAST_BUS_HEADS_UP_MS}. Timetable only, so it still
 * works overnight when the live feed is empty.
 */
function lastBusNote(input: TripModelInput, finalRunAt: number | null): TripNote | null {
  if (finalRunAt != null) {
    return {
      id: 'last-bus',
      icon: 'moon.stars',
      text: 'This is the last bus today',
      tone: 'warning',
      label: 'Last bus',
      value: 'This one',
    };
  }
  const last = input.lastBusToday;
  if (last == null || last <= input.now) return null;
  if (last - input.now > LAST_BUS_HEADS_UP_MS) return null;
  return {
    id: 'last-bus',
    icon: 'moon.stars',
    text: `Last bus today at ${input.formatClock(last)}`,
    tone: 'info',
    label: 'Last bus',
    value: input.formatClock(last),
  };
}

/** "Next two buses 3 min apart, then a 40 min gap." Needs two live buses. */
function bunchingNote(
  isLive: boolean,
  later: readonly ArrivalLike[],
  input: TripModelInput,
): TripNote | null {
  const primary = input.primaryArrival;
  const second = later[0];
  if (!isLive || !primary || !second || second.kind !== 'live') return null;
  const apart = Math.round((second.epochMs - primary.epochMs) / 60_000);
  if (apart > BUNCHED_MIN) return null;
  const third = later[1];
  const gap = third ? Math.round((third.epochMs - second.epochMs) / 60_000) : null;
  const apartText = apart <= 1 ? 'back to back' : `${mins(apart)} apart`;
  return {
    id: 'bunching',
    icon: 'bus.doubledecker',
    text:
      gap != null && gap >= 20
        ? `Next two buses are ${apartText}, then a ${gap < 60 ? `${gap}-min` : formatDuration(gap)} gap`
        : `Next two buses are ${apartText}`,
    tone: 'info',
  };
}

function nextFor(input: TripModelInput): NextBus | null {
  const primary = input.primaryArrival;
  const next = distinctLater(input)[0];
  if (!primary || !next) return null;
  const gap = Math.max(1, Math.round((next.epochMs - primary.epochMs) / 60_000));
  return {
    clock: input.formatClock(next.epochMs),
    wait: `+${formatDuration(gap)}`,
    live: next.kind === 'live',
  };
}

/** Later arrivals, one per trip, strictly after the primary. */
function distinctLater(input: TripModelInput): ArrivalLike[] {
  const primary = input.primaryArrival;
  if (!primary) return [];
  const seen = new Set<string>();
  if (primary.tripId) seen.add(primary.tripId);
  const out: ArrivalLike[] = [];
  for (const a of input.laterArrivals) {
    if (a.epochMs <= primary.epochMs + 30_000) continue;
    if (a.tripId) {
      if (seen.has(a.tripId)) continue;
      seen.add(a.tripId);
    }
    out.push(a);
  }
  return out;
}

function compactNotes(notes: readonly (TripNote | null)[]): TripNote[] {
  return notes.filter((n): n is TripNote => n != null).slice(0, MAX_NOTES);
}

/**
 * "1 min", "5 mins": every count of minutes the app shows. Hyphenated
 * adjectives ("a 10-min walk") stay singular, as in English.
 */
export function mins(n: number): string {
  return `${n} ${n === 1 ? 'min' : 'mins'}`;
}

/** "45 mins", "1 h 5 mins". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return mins(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${mins(m)}`;
}

/** "in 1 min", "in 33 mins", "in 1 h 5 mins". */
export function formatIn(minutes: number): string {
  if (minutes < 60) return `in ${mins(minutes)}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${mins(m)}`;
}

/** "3:05" for the walk countdown. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
