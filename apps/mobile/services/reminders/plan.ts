/**
 * Pure reminder planning: no React Native, no Expo, no I/O.
 *
 * Everything here works in absolute epoch ms and treats Malaysia as UTC+8
 * year-round (no DST), matching `toMalaysiaParts` in `@bus-tracker/shared`.
 * Kept dependency-free so it runs under `tsx --test` on plain Node.
 */

const MY_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** iOS keeps at most 64 pending local notifications per app; extras are silently dropped. */
export const IOS_MAX_PENDING_NOTIFICATIONS = 64;
/** Slots kept free for one-off alerts (leave-now, picked departure, last bus, get-off). */
export const RESERVED_NOTIFICATION_SLOTS = 4;
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
