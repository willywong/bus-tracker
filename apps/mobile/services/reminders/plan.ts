/**
 * Pure reminder planning: no React Native, no Expo, no I/O.
 *
 * Everything here works in absolute epoch ms and treats Malaysia as UTC+8
 * year-round (no DST), matching `toMalaysiaParts` in `@bus-tracker/shared`.
 * Kept dependency-free so it runs under `tsx --test` on plain Node (the
 * journey types are type-only imports).
 */
import type { Itinerary, Leg, LegPoint } from '@bus-tracker/shared';

const MY_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** iOS keeps at most 64 pending local notifications per app; extras are silently dropped. */
export const IOS_MAX_PENDING_NOTIFICATIONS = 64;
/**
 * Slots kept free for one-off alerts: leave-now, picked departure, last bus
 * and get-off (4), plus Go mode's leave and up to four ride-leg alerts (5).
 */
export const RESERVED_NOTIFICATION_SLOTS = 9;
/** Default cap on commute reminders scheduled at once. */
export const COMMUTE_MAX_PENDING = IOS_MAX_PENDING_NOTIFICATIONS - RESERVED_NOTIFICATION_SLOTS;

/** Identifier prefix for every scheduled commute reminder. */
export const COMMUTE_ID_PREFIX = 'commute-';

/**
 * Two alerts closer than this are "the same moment": only one should reach the
 * user (design principle: one notification per moment).
 */
export const SAME_MOMENT_WINDOW_MS = 20 * MINUTE_MS;

export interface CommuteRules {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday (Malaysia local). */
  weekdays: readonly number[];
  /**
   * Minute of the Malaysia-local day (0–1439). The planner picks the first
   * scheduled departure at or after this time, i.e. "the bus around 08:00".
   */
  targetMinuteOfDay: number;
}

export interface PlannedReminder {
  /** Stable notification identifier: `commute-YYYY-MM-DD`. */
  id: string;
  /** Malaysia-local service date, YYYY-MM-DD. */
  date: string;
  fireAtMs: number;
  /** The scheduled departure this reminder is for. */
  departureMs: number;
  title: string;
  body: string;
}

export interface PlanCommuteInput {
  rules: CommuteRules;
  /**
   * Service date (YYYY-MM-DD, Malaysia) -> that day's scheduled departure
   * epoch ms at the user's stop. Missing dates mean "no service / no data".
   */
  departuresByDay: Readonly<Record<string, readonly number[]>>;
  walkMinutes: number;
  bufferMinutes: number;
  now: Date | number;
  /** How many days to plan, starting with today. Default 7. */
  days?: number;
  /** Used in the copy only. */
  routeCode?: string;
  /** Used in the copy only. */
  stopName?: string;
  /** Hard cap on returned reminders (earliest kept). Default COMMUTE_MAX_PENDING. */
  maxReminders?: number;
  /** Clock formatter for the copy. Default 24-hour Malaysia time. */
  formatClock?: (epochMs: number) => string;
}

// ---------------------------------------------------------------------------
// Malaysia time helpers
// ---------------------------------------------------------------------------

function toMs(t: Date | number): number {
  return typeof t === 'number' ? t : t.getTime();
}

/** Epoch ms of Malaysia-local midnight for the day containing `epochMs`. */
export function malaysiaMidnightMs(epochMs: number): number {
  const shifted = epochMs + MY_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - MY_OFFSET_MS;
}

/** YYYY-MM-DD (Malaysia-local) for `epochMs`. */
export function malaysiaDateKey(epochMs: number): string {
  const d = new Date(epochMs + MY_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 0 = Sunday … 6 = Saturday (Malaysia-local) for `epochMs`. */
export function malaysiaWeekday(epochMs: number): number {
  return new Date(epochMs + MY_OFFSET_MS).getUTCDay();
}

/**
 * Formats `epochMs` as Malaysia wall-clock time without Intl ("23:30", or
 * "11:30 PM" when `use24h` is false).
 */
export function formatMalaysiaClock(epochMs: number, use24h = true): string {
  const d = new Date(epochMs + MY_OFFSET_MS);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (use24h) return `${String(h).padStart(2, '0')}:${mm}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The Malaysia-local service dates for the next `days` days, starting today. */
export function upcomingServiceDates(
  now: Date | number,
  days: number,
): { date: string; midnightMs: number; weekday: number }[] {
  const start = malaysiaMidnightMs(toMs(now));
  const out: { date: string; midnightMs: number; weekday: number }[] = [];
  for (let i = 0; i < days; i++) {
    // +12h before formatting keeps us safely inside the day.
    const midnightMs = start + i * DAY_MS;
    out.push({
      date: malaysiaDateKey(midnightMs + DAY_MS / 2),
      midnightMs,
      weekday: malaysiaWeekday(midnightMs + DAY_MS / 2),
    });
  }
  return out;
}

export function commuteReminderId(date: string): string {
  return `${COMMUTE_ID_PREFIX}${date}`;
}

export function isCommuteReminderId(id: string): boolean {
  return id.startsWith(COMMUTE_ID_PREFIX);
}

export function isSameMoment(
  aMs: number,
  bMs: number,
  windowMs: number = SAME_MOMENT_WINDOW_MS,
): boolean {
  return Math.abs(aMs - bMs) < windowMs;
}

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Commute planning
// ---------------------------------------------------------------------------

/**
 * Plans one "leave by" reminder per enabled weekday over the next `days` days.
 *
 * For each day: take the first scheduled departure at or after
 * `targetMinuteOfDay`, fire at departure − walk − buffer, and skip it if that
 * moment has already passed (we don't chase a later bus — the live screen does
 * that). Results are sorted by fire time and capped at `maxReminders`.
 */
export function planCommuteReminders(input: PlanCommuteInput): PlannedReminder[] {
  const { rules, departuresByDay, walkMinutes, bufferMinutes, routeCode, stopName } = input;
  if (!rules.enabled) return [];

  const nowMs = toMs(input.now);
  const days = Math.max(0, Math.floor(input.days ?? 7));
  const maxReminders = Math.max(0, Math.floor(input.maxReminders ?? COMMUTE_MAX_PENDING));
  const fmt = input.formatClock ?? ((ms: number) => formatMalaysiaClock(ms));
  const weekdays = new Set(rules.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (weekdays.size === 0 || days === 0 || maxReminders === 0) return [];

  const target = Math.min(1439, Math.max(0, Math.floor(rules.targetMinuteOfDay)));
  const walk = nonNegative(walkMinutes);
  const leadMs = (walk + nonNegative(bufferMinutes)) * MINUTE_MS;

  const out: PlannedReminder[] = [];
  for (const day of upcomingServiceDates(nowMs, days)) {
    if (!weekdays.has(day.weekday)) continue;
    const deps = departuresByDay[day.date];
    if (!deps || deps.length === 0) continue;

    const targetMs = day.midnightMs + target * MINUTE_MS;
    let departureMs: number | null = null;
    for (const d of deps) {
      if (d >= targetMs && (departureMs == null || d < departureMs)) {
        departureMs = d;
      }
    }
    if (departureMs == null) continue;

    const fireAtMs = departureMs - leadMs;
    if (fireAtMs <= nowMs) continue;

    const route = routeCode ? ` for ${routeCode}` : '';
    const at = stopName ? ` at ${stopName}` : '';
    const walkCopy = walk > 0 ? ` · ${walk}-min walk` : '';
    out.push({
      id: commuteReminderId(day.date),
      date: day.date,
      fireAtMs,
      departureMs,
      title: `Leave by ${fmt(fireAtMs)}${route}`,
      body: `Scheduled bus${at} at ${fmt(departureMs)}${walkCopy}. Open for live times.`,
    });
  }

  out.sort((a, b) => a.fireAtMs - b.fireAtMs);
  return out.slice(0, maxReminders);
}

// ---------------------------------------------------------------------------
// Last bus
// ---------------------------------------------------------------------------

export interface LastBusTimes {
  /** When the user must leave to reach the stop for the last bus. */
  leaveByMs: number;
  /** When to notify: `leadMinutes` before leave-by. */
  notifyAtMs: number;
}

/** leave-by = last bus − walk; notify = leave-by − lead. */
export function lastBusLeaveBy(
  lastBusMs: number,
  walkMinutes: number,
  leadMinutes: number,
): LastBusTimes {
  const leaveByMs = lastBusMs - nonNegative(walkMinutes) * MINUTE_MS;
  return {
    leaveByMs,
    notifyAtMs: leaveByMs - nonNegative(leadMinutes) * MINUTE_MS,
  };
}

// ---------------------------------------------------------------------------
// Go mode (15/06): leave, change and get-off alerts for one itinerary
// ---------------------------------------------------------------------------

/** Go's leave alert: when the itinerary's own access walk starts. */
export const GO_LEAVE_ID = 'bt.go.leave';
/** Go's ride-leg alerts: `bt.go.leg.0` … `bt.go.leg.3`, by ride. */
export const GO_LEG_ID_PREFIX = 'bt.go.leg.';
/** A journey has at most four rides (the engine's `MAX_RIDES`), so four leg alerts. */
export const GO_MAX_LEG_ALERTS = 4;
/** A ride-leg alert fires this long before the ride's alight time. */
export const GO_ALERT_LEAD_MS = 60_000;
/** A walk shorter than this is a snap to the stop: no leave alert, no "walk" in the copy. */
const GO_SNAP_WALK_SEC = 30;
/** Rail turning up every this many seconds or less reads "every N mins" (the board's rule). */
const GO_EVERY_MAX_SEC = 300;

type GoRide = Extract<Leg, { kind: 'ride' }>;

export interface JourneyAlert {
  /** `bt.go.leave` or `bt.go.leg.<ride>`: scheduling again replaces it. */
  id: string;
  atMs: number;
  title: string;
  body: string;
  /** The ride leg it's for (an index into `it.legs`), null for the leave alert. */
  legIndex: number | null;
}

export interface JourneyAlertOptions {
  /** "Kelana Jaya Line", "T816". Default: the leg's label. */
  lineName?: (ride: GoRide) => string;
  /** A stop's display name (bus stops display-cased). Default: as given. */
  stopName?: (p: LegPoint, bus: boolean) => string;
  /** Clock for the copy. Default 24-hour Malaysia time. */
  clock?: (epochMs: number) => string;
}

export function goLegAlertId(ride: number): string {
  return `${GO_LEG_ID_PREFIX}${ride}`;
}

/** Every Go alert id, for cancelling them all. */
export const GO_ALERT_IDS: readonly string[] = [
  GO_LEAVE_ID,
  ...Array.from({ length: GO_MAX_LEG_ALERTS }, (_, i) => goLegAlertId(i)),
];

const goIsBus = (l: GoRide) => l.mode === 'bus' || l.mode === 'feeder';
const goMins = (n: number) => `${n} ${n === 1 ? 'min' : 'mins'}`;

/**
 * Go's alerts for `it`, in time order, those already past `now` dropped:
 * - `bt.go.leave` when the itinerary's own access walk starts (its first
 *   leg, at the planner's 80 m/min; not the favourite stop's walk setting);
 * - `bt.go.leg.<i>` a minute before each ride's alight time: "Change at
 *   Pasar Seni for Kelana Jaya Line" / "Get off now. About a 4-min walk to
 *   the platform.", and "Your stop is next: KLCC" for the last ride.
 * Rail times are "about" and never live; a bus is "scheduled" or a "live
 * estimate".
 */
export function planJourneyAlerts(it: Itinerary, now: number, opts: JourneyAlertOptions = {}): JourneyAlert[] {
  const lineName = opts.lineName ?? ((l: GoRide) => l.label);
  const stopName = opts.stopName ?? ((p: LegPoint) => p.name);
  const clock = opts.clock ?? ((ms: number) => formatMalaysiaClock(ms));
  const legs = it.legs;
  const out: JourneyAlert[] = [];

  const first = legs[0];
  const firstRide = legs.find((l): l is GoRide => l.kind === 'ride') ?? null;
  if (first?.kind === 'walk' && first.seconds >= GO_SNAP_WALK_SEC) {
    const walk = goMins(Math.max(1, Math.round(first.seconds / 60)));
    if (firstRide) {
      const bus = goIsBus(firstRide);
      const when =
        firstRide.timing.kind === 'headway'
          ? firstRide.timing.headwaySec <= GO_EVERY_MAX_SEC
            ? `every ${goMins(Math.max(1, Math.round(firstRide.timing.headwaySec / 60)))}`
            : `about ${clock(firstRide.from.time)}`
          : `at ${clock(firstRide.from.time)} (${firstRide.timing.kind === 'live' ? 'live estimate' : 'scheduled'})`;
      out.push({
        id: GO_LEAVE_ID,
        atMs: first.from.time,
        title: `Leave now for ${lineName(firstRide)}`,
        body: `Walk ${walk} to ${stopName(first.to, bus)}. ${lineName(firstRide)} ${when}.`,
        legIndex: null,
      });
    } else {
      out.push({
        id: GO_LEAVE_ID,
        atMs: first.from.time,
        title: 'Leave now',
        body: `Walk ${walk} to ${stopName(first.to, false)}.`,
        legIndex: null,
      });
    }
  }

  const rides: number[] = [];
  legs.forEach((l, i) => {
    if (l.kind === 'ride') rides.push(i);
  });
  rides.slice(0, GO_MAX_LEG_ALERTS).forEach((i, r) => {
    const l = legs[i] as GoRide;
    const at = stopName(l.to, goIsBus(l));
    const nextIndex = rides[r + 1];
    let title: string;
    let body: string;
    if (nextIndex == null) {
      title = `Your stop is next: ${at}`;
      body = 'Get ready to get off.';
    } else {
      const next = legs[nextIndex] as GoRide;
      let walkSec = 0;
      for (let k = i + 1; k < nextIndex; k++) {
        const w = legs[k];
        if (w.kind === 'walk') walkSec += w.seconds;
      }
      title = `Change at ${at} for ${lineName(next)}`;
      body =
        walkSec >= GO_SNAP_WALK_SEC
          ? `Get off now. About a ${Math.max(1, Math.round(walkSec / 60))}-min walk to the ${goIsBus(next) ? 'stop' : 'platform'}.`
          : 'Get off now.';
    }
    out.push({ id: goLegAlertId(r), atMs: l.to.time - GO_ALERT_LEAD_MS, title, body, legIndex: i });
  });

  return out.filter((a) => a.atMs > now).sort((a, b) => a.atMs - b.atMs);
}

/**
 * True when `next` should replace what's scheduled: an alert came or went,
 * or one moved by more than `driftMs` (a retime that only nudges the times
 * leaves the queue alone).
 */
export function journeyAlertsMoved(
  scheduled: ReadonlyMap<string, number>,
  next: readonly JourneyAlert[],
  driftMs = 60_000,
): boolean {
  if (scheduled.size !== next.length) return true;
  for (const a of next) {
    const at = scheduled.get(a.id);
    if (at == null || Math.abs(at - a.atMs) > driftMs) return true;
  }
  return false;
}
