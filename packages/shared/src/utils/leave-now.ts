import { isWithinQuietHours } from "./quiet-hours.js";

export interface ShouldNotifyArgs {
  /** Traffic-adjusted minutes from the bus to the user's stop. */
  etaMinutes: number;
  /** Minutes the user needs to walk to the stop. */
  walkMinutes: number;
  /** Extra lead-time buffer the user configured (0–5). */
  bufferMinutes: number;
  /** Local wall-clock time used for the quiet-hours check. */
  now: Date | number;
  /** Quiet-hours start, minute-of-day (0–1439). */
  quietStartMin: number;
  /** Quiet-hours end, minute-of-day (0–1439). */
  quietEndMin: number;
}

/**
 * Pure decision function that powers the "Leave now" push.
 *
 * Fires when the bus will reach the user's stop no later than the walk time
 * plus the configured buffer, and the current local time is outside the
 * user's quiet-hours window (wrap-around across midnight supported).
 */
export function shouldNotify(args: ShouldNotifyArgs): boolean {
  const {
    etaMinutes,
    walkMinutes,
    bufferMinutes,
    now,
    quietStartMin,
    quietEndMin,
  } = args;

  if (!Number.isFinite(etaMinutes)) return false;
  if (etaMinutes < 0) return false;

  const threshold = walkMinutes + bufferMinutes;
  if (etaMinutes > threshold) return false;

  if (
    isWithinQuietHours(now, {
      startMin: quietStartMin,
      endMin: quietEndMin,
    })
  ) {
    return false;
  }

  return true;
}
