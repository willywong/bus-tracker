import type { FeedId, Itinerary, Leg } from '@bus-tracker/shared';

import { formatDistance } from '@/components/map/format';
import { formatDuration, mins } from '@/components/trip/model';

/**
 * Pure presentation model for the plan sheet's results (spec §6.2, 15/04):
 * each itinerary row's leave time, chips, journey bar, status line, tag,
 * notes and spoken label. No React Native imports, so it runs under
 * `tsx --test`. Clocks are injected (`formatClockHHMM` in the app).
 */

export type Clock = (epochMs: number) => string;
type Ride = Extract<Leg, { kind: 'ride' }>;

/** At most this many chips before inner walks fold into the separators. */
export const MAX_CHIPS = 5;
/** A walk shorter than this is a snap to the stop: no chip, no bar segment, not spoken. */
const MIN_WALK_SEC = 30;

const isRide = (l: Leg): l is Ride => l.kind === 'ride';
const isBus = (l: Ride) => l.mode === 'bus' || l.mode === 'feeder';
const walkMinutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const spokenMinutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));

/** Whole minutes from now until the itinerary leaves, rounded down (≤ 0 → leave now). */
function leaveMinutes(it: Itinerary, now: number): number {
  return Math.floor((it.departAt - now) / 60_000);
}

/** "Leave now", "Leave in 4 mins", or "Leave 10:42" from an hour out. */
export function leaveLabel(it: Itinerary, now: number, clock: Clock): string {
  const m = leaveMinutes(it, now);
  if (m <= 0) return 'Leave now';
  if (m < 60) return `Leave in ${mins(m)}`;
  return `Leave ${clock(it.departAt)}`;
}

/** Door-to-door length: "38 mins", "1 h 5 mins". */
export function durationLabel(it: Itinerary): string {
  return formatDuration(minutesBetween(it.departAt, it.arriveAt));
}

export type Chip =
  | { kind: 'walk'; minutes: number }
  | { kind: 'bus'; label: string; every: number | null }
  | { kind: 'rail'; label: string; name: string; color: string; textColor: string; every: number | null };

/** "every 4": a turn-up-and-go leg's headway in minutes, else null. */
function everyOf(l: Ride): number | null {
  return l.timing.kind === 'headway' ? Math.max(1, Math.round(l.timing.headwaySec / 60)) : null;
}

/** "LRT Kelana Jaya Line" → "Kelana Jaya Line", "KTM Komuter Seremban Line" → "Komuter Seremban Line". */
export function lineName(longName: string): string {
  return longName.replace(/^(LRT|MRT|BRT|KTM)\s+/, '') || longName;
}

/** What the chips and the spoken label need of the network: a route's long name and text colour. */
export interface RouteInfo {
  longName(route: number): string;
  textColor(route: number): string;
}

/** `RouteInfo` over a compiled network. */
export function routeInfoOf(net: { routes: { longName: string[]; textColor: string[] } }): RouteInfo {
  return {
    longName: (r) => net.routes.longName[r] ?? '',
    textColor: (r) => net.routes.textColor[r] || '#FFFFFF',
  };
}

function rideChip(l: Ride, routes: RouteInfo): Chip {
  if (isBus(l)) return { kind: 'bus', label: l.label, every: everyOf(l) };
  return {
    kind: 'rail',
    // KTM's labels are line names ("KTM Seremban"): the chip says KTM.
    label: l.mode === 'ktm' ? 'KTM' : l.label,
    name: lineName(routes.longName(l.route) || l.label),
    color: l.color,
    textColor: routes.textColor(l.route),
    every: everyOf(l),
  };
}

/**
 * The leg chips, left to right. Walks under 30 s (a snap to the stop) have
 * none. Past {@link MAX_CHIPS}, walks between rides fold into the separators;
 * the first and last walk stay.
 */
export function legChips(it: Itinerary, routes: RouteInfo): Chip[] {
  const chips: Chip[] = [];
  for (const l of it.legs) {
    if (l.kind === 'walk') {
      if (l.seconds >= MIN_WALK_SEC) chips.push({ kind: 'walk', minutes: walkMinutes(l.seconds) });
    } else {
      chips.push(rideChip(l, routes));
    }
  }
  if (chips.length <= MAX_CHIPS) return chips;
  return chips.filter((c, i) => c.kind !== 'walk' || i === 0 || i === chips.length - 1);
}

export interface Segment {
  kind: 'wait' | 'walk' | 'bus' | 'rail';
  seconds: number;
  /** Rail: the line colour. Others: null (ink, or the hairline for a wait). */
  color: string | null;
}

/**
 * The journey bar: one segment per leg, sized by time, from `departAt` to
 * `arriveAt`. The wait before the first ride is its own segment; any later
 * wait (a transfer) belongs to the ride it waits for. Walks under 30 s fold
 * into the next segment. The seconds always sum to the journey.
 */
export function journeySegments(it: Itinerary): Segment[] {
  const out: Segment[] = [];
  let at = it.departAt;
  let carry = 0;
  let rodeYet = false;
  const push = (kind: Segment['kind'], ms: number, color: string | null) => {
    const seconds = Math.max(0, Math.round(ms / 1000)) + carry;
    carry = 0;
    if (seconds > 0) out.push({ kind, seconds, color });
  };
  for (const l of it.legs) {
    const end = Math.max(at, Math.min(l.to.time, it.arriveAt));
    if (l.kind === 'walk') {
      if (l.seconds < MIN_WALK_SEC) carry += Math.max(0, Math.round((end - at) / 1000));
      else push('walk', end - at, null);
    } else {
      if (!rodeYet) {
        const board = Math.min(Math.max(at, l.from.time), end);
        push('wait', board - at, null);
        at = board;
      }
      rodeYet = true;
      push(isBus(l) ? 'bus' : 'rail', end - at, isBus(l) ? null : l.color);
    }
    at = end;
  }
  // Anything after the last leg (never in practice) and a trailing snap walk.
  const tail = Math.max(0, Math.round((it.arriveAt - at) / 1000)) + carry;
  if (tail > 0) {
    const last = out[out.length - 1];
    if (last) last.seconds += tail;
    else out.push({ kind: 'walk', seconds: tail, color: null });
  }
  return out;
}

/** The first ride, if it is a bus with live timing: only that makes a row Live. */
export function isLive(it: Itinerary): boolean {
  const first = it.legs.find(isRide);
  return first != null && isBus(first) && first.timing.kind === 'live';
}

function changesText(it: Itinerary): string {
  const changes = Math.max(0, it.rides - 1);
  if (changes === 0) return 'No changes';
  return changes === 1 ? '1 change' : `${changes} changes`;
}

function walkText(meters: number): string {
  if (meters < 10) return 'no walking';
  return `${formatDistance(meters)} walk`;
}

/**
 * The status line after "Live" / "Scheduled": "1 change · 650 m walk",
 * "No changes · no walking", or "Walk only · 1.2 km". `live` is true only
 * when the first ride is a bus re-timed from a real position.
 */
export function statusText(it: Itinerary): { live: boolean; text: string } {
  if (it.rides === 0) return { live: false, text: `Walk only · ${formatDistance(it.walkMeters)}` };
  return { live: isLive(it), text: `${changesText(it)} · ${walkText(it.walkMeters)}` };
}

const TAG_LABELS = { fastest: 'Fastest', 'fewer-changes': 'Fewer changes', 'less-walking': 'Less walking' } as const;

/** The row's tag, or null. `plan()` only tags options where they differ. */
export function tagLabel(it: Itinerary): string | null {
  const t = it.tags[0];
  return t ? TAG_LABELS[t] : null;
}

/**
 * Success criterion 7: "Leave in 4 minutes, live. 56 minutes. Walk 5
 * minutes, bus T816, Kajang Line, walk 3 minutes. Arrive 9:30. Fastest."
 * It always says "live" or "scheduled", so colour never carries meaning.
 */
export function resultAccessibilityLabel(it: Itinerary, now: number, clock: Clock, routes: RouteInfo): string {
  const m = leaveMinutes(it, now);
  const leave = m <= 0 ? 'Leave now' : m < 60 ? `Leave in ${spokenMinutes(m)}` : `Leave at ${clock(it.departAt)}`;
  const total = minutesBetween(it.departAt, it.arriveAt);
  const length =
    total < 60
      ? spokenMinutes(total)
      : `${Math.floor(total / 60)} ${Math.floor(total / 60) === 1 ? 'hour' : 'hours'}${total % 60 ? ` ${spokenMinutes(total % 60)}` : ''}`;
  const legs: string[] = [];
  for (const l of it.legs) {
    if (l.kind === 'walk') {
      if (l.seconds >= MIN_WALK_SEC) legs.push(`walk ${spokenMinutes(walkMinutes(l.seconds))}`);
    } else if (isBus(l)) {
      legs.push(`bus ${l.label}`);
    } else {
      legs.push(lineName(routes.longName(l.route) || l.label));
    }
  }
  const steps = legs.join(', ');
  const parts = [
    `${leave}, ${isLive(it) ? 'live' : 'scheduled'}.`,
    `${length}.`,
    steps ? `${steps.charAt(0).toUpperCase()}${steps.slice(1)}.` : null,
    `Arrive ${clock(it.arriveAt)}.`,
    tagLabel(it) ? `${tagLabel(it)}.` : null,
    warningNote(it) ? `${warningNote(it)}.` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

/** "Updated · was 9:12" once live re-timing moved the arrival by a minute or more. */
export function updatedNote(it: Itinerary, clock: Clock): string | null {
  const was = it.previousArriveAt;
  if (was == null || Math.abs(was - it.arriveAt) < 60_000) return null;
  return `Updated · was ${clock(was)}`;
}

const FEED_NOTE_ORDER: readonly FeedId[] = ['rail', 'ktm', 'bus-kl', 'feeder'];
const FEED_NOTES: Record<FeedId, string> = {
  rail: 'Rail timetable from data.gov.my has expired. Showing bus-only routes.',
  ktm: 'KTM timetable expired. Showing routes without KTM Komuter.',
  'bus-kl': 'Rapid KL bus timetable expired. Showing other routes.',
  feeder: 'MRT feeder timetable expired. Showing other routes.',
};

/** One note per feed left out of routing (`PlanResult.excludedFeeds`), shown even with no results. */
export function feedNotes(excludedFeeds: readonly FeedId[]): string[] {
  return FEED_NOTE_ORDER.filter((f) => excludedFeeds.includes(f)).map((f) => FEED_NOTES[f]);
}

/** Spec §4.3 budget: shown once above the rows when a needed live feed isn't polled. */
export const LIVE_PAUSED_NOTE =
  "Live times are paused to stay within data.gov.my's limits. Showing scheduled times.";

/** The note under a row, most serious first. Only a missed connection is orange. */
export function warningNote(it: Itinerary): string | null {
  if (it.warnings.includes('missed-connection')) return 'Connection missed. Times updated';
  if (it.warnings.includes('last-service')) return 'Last service tonight';
  if (it.warnings.includes('long-wait')) return 'Long wait for the first ride';
  return null;
}

export const RESULTS_FOOTER = 'Routes use data.gov.my timetables. Rail times are every-few-minutes estimates.';
