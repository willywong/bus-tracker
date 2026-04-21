// Malaysia operates at UTC+8 year-round (no DST). Hard-coding avoids Intl-based
// tz lookups in hot query paths on Hermes.
export const MY_TZ_OFFSET_MIN = 8 * 60;

const GTFS_TIME_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/**
 * Parses a GTFS time string ("HH:MM:SS" where HH may exceed 23, e.g. "25:30:00"
 * for 01:30 on the next service day) into seconds since the trip's service-day
 * midnight. Returns null for missing/invalid input.
 */
export function gtfsTimeToSeconds(
  t: string | undefined | null,
): number | null {
  if (!t) return null;
  const m = GTFS_TIME_RE.exec(t);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Renders seconds-since-service-day-midnight as wall-clock "HH:MM" (24-hour).
 * Values >= 86400 wrap (e.g. 91800 -> "01:30").
 */
export function secondsToClockHHMM(seconds: number): string {
  const s = ((seconds % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface MalaysiaDateParts {
  /** "YYYYMMDD" — matches GTFS calendar.start_date / end_date format. */
  ymd: string;
  /** 0=Sun, 1=Mon, ..., 6=Sat (matches JS `Date#getDay`). */
  dow: number;
  /** Seconds since Malaysia-local midnight. */
  secSinceMidnight: number;
  /** Absolute UTC epoch ms at Malaysia-local midnight of this calendar day. */
  midnightUtcMs: number;
}

/** Returns Malaysia-local calendar parts for an absolute point in time. */
export function toMalaysiaParts(now: Date): MalaysiaDateParts {
  const shifted = new Date(now.getTime() + MY_TZ_OFFSET_MIN * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const ymd = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const dow = shifted.getUTCDay();
  const secSinceMidnight =
    shifted.getUTCHours() * 3600 +
    shifted.getUTCMinutes() * 60 +
    shifted.getUTCSeconds();
  const midnightUtcMs = Date.UTC(y, m - 1, d) - MY_TZ_OFFSET_MIN * 60_000;
  return { ymd, dow, secSinceMidnight, midnightUtcMs };
}
