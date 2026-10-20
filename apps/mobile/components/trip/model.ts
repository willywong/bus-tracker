/**
 * Pure presentation model for the trip sheet. Every visible string and state
 * decision lives here so the rules from docs/design/README.md (§3.2) are in
 * one testable place and the views stay dumb.
 */

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
  action: TripAction;
  accessibilityLabel: string;
}

/** Age after which a live ETA is shown as "Updated N min ago". */
export const AGING_AFTER_MS = 60_000;
/** Inside this many minutes before you need to leave, the action flips to "Leave now". */
export const LEAVE_NOW_WINDOW_MIN = 2;

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
      const mins = Math.max(
        0,
        Math.floor((input.firstBusToday - input.now) / 60_000),
      );
      return base('before-service', 'scheduled', input, {
        hero: { text: clock, unit: null, kind: 'clock' },
        heroEyebrow: 'First bus',
        status: 'Scheduled',
        detail: mins > 0 ? `In ${formatDuration(mins)}` : null,
        compact: clock,
        accessibilityLabel: `First bus at ${clock}`,
      });
    }
    return base('no-service', 'scheduled', input, {
      status: input.feedError
        ? "Can't reach live data"
        : 'No buses scheduled right now',
      accessibilityLabel: 'No buses scheduled right now',
    });
  }

  const minutes = Math.max(0, Math.floor(input.minutesToStop));
  const isLive = input.primaryArrival.kind === 'live' && input.mode === 'live';
  const hero = heroFor(minutes, isLive, input);
  const shownSource: SourceKind = isLive ? source : 'scheduled';

  return {
    state: 'arrival',
    hero,
    heroEyebrow: null,
    source: shownSource,
    status: statusFor(shownSource, input),
    detail: shownSource === 'scheduled' ? null : detailFor(input),
    then: thenFor(input),
    compact: hero.unit ? `${hero.text} ${hero.unit}` : hero.text,
    action: actionFor(minutes, hero, input),
    accessibilityLabel: a11yFor(hero, shownSource, input),
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
    action:
      input.walkRemainingSeconds != null
        ? { kind: 'walking', remainingSeconds: input.walkRemainingSeconds }
        : { kind: 'none' },
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

function heroFor(
  minutes: number,
  isLive: boolean,
  input: TripModelInput,
): HeroValue {
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
  return { text: String(minutes), unit: 'min', kind: 'minutes' };
}

function statusFor(source: SourceKind, input: TripModelInput): string {
  if (source === 'scheduled') {
    if (input.liveBusCount > 0) return 'Scheduled';
    return input.feedError
      ? "Scheduled · can't reach live data"
      : 'Scheduled · no live buses reporting';
  }
  if (source === 'aging' && input.lastUpdated != null) {
    const mins = Math.max(1, Math.floor((input.now - input.lastUpdated) / 60_000));
    return `Updated ${mins} min ago`;
  }
  const parts = ['Live'];
  const ahead = stopsAheadLabel(input.stopsAhead);
  if (ahead) parts.push(ahead);
  return parts.join(' · ');
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
  if (d.onTimeWindow === 'late') return `${m} min behind schedule`;
  return `${m} min ahead of schedule`;
}

function thenFor(input: TripModelInput): string | null {
  const primary = input.primaryArrival;
  if (!primary) return null;
  const seen = new Set<string>();
  if (primary.tripId) seen.add(primary.tripId);
  const picks: number[] = [];
  for (const a of input.laterArrivals) {
    if (a.epochMs <= primary.epochMs + 30_000) continue;
    if (a.tripId) {
      if (seen.has(a.tripId)) continue;
      seen.add(a.tripId);
    }
    picks.push(a.epochMs);
    if (picks.length === 2) break;
  }
  if (picks.length === 0) return null;
  const parts = picks.map((ms) => {
    const m = Math.max(0, Math.floor((ms - input.now) / 60_000));
    return m < 60 ? { text: String(m), minutes: true } : { text: input.formatClock(ms), minutes: false };
  });
  const last = parts[parts.length - 1];
  return `Then ${parts.map((p) => p.text).join(' · ')}${last.minutes ? ' min' : ''}`;
}

function actionFor(
  minutes: number,
  hero: HeroValue,
  input: TripModelInput,
): TripAction {
  if (input.walkRemainingSeconds != null) {
    return { kind: 'walking', remainingSeconds: input.walkRemainingSeconds };
  }
  if (hero.kind === 'word' && hero.text !== 'Due') return { kind: 'none' };
  if (minutes < input.walkMinutes) return { kind: 'tight' };
  const leaveIn = minutes - input.walkMinutes;
  if (leaveIn <= LEAVE_NOW_WINDOW_MIN) {
    return { kind: 'leave-now', following: input.isFollowing };
  }
  return { kind: 'follow', leaveInMinutes: leaveIn, following: input.isFollowing };
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

/** "45 min", "1 h 5 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "3:05" for the walk countdown. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
