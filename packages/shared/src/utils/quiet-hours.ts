export interface QuietHoursRange {
  /** Minute-of-day (0–1439) when quiet hours begin. */
  startMin: number;
  /** Minute-of-day (0–1439) when quiet hours end. */
  endMin: number;
}

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * True when `now` falls inside the quiet-hours window, handling wrap-around
 * across midnight (e.g. 22:00–06:00).
 *
 * When start === end, the window is treated as empty (never quiet).
 */
export function isWithinQuietHours(
  now: Date | number,
  range: QuietHoursRange,
): boolean {
  const nowMin =
    typeof now === "number" ? now : now.getHours() * 60 + now.getMinutes();
  const { startMin, endMin } = range;
  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}
