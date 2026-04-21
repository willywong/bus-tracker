export type OnTimeWindow = "early" | "on-time" | "late";

export interface ComputeScheduleDelayArgs {
  /** Scheduled departure from the stop, in seconds-since-service-day-midnight. */
  scheduledDepartureSeconds: number | null;
  /** Projected arrival at the stop as an absolute epoch ms. */
  projectedArrivalEpochMs: number;
  /** Malaysia-local midnight of the trip's service day, as UTC epoch ms. */
  serviceDayMidnightUtcMs: number;
  /**
   * If |delay| exceeds this in minutes, treat it as a mismatch between the live
   * vehicle and the scheduled trip (likely a different trip) and return null.
   */
  maxAbsDelayMinutes?: number;
}

export interface ScheduleDelay {
  delayMinutes: number;
  onTimeWindow: OnTimeWindow;
}

const DEFAULT_MAX_ABS_DELAY_MIN = 15;
const ON_TIME_BAND_MIN = 2;

/**
 * Compares a projected live arrival against the scheduled departure at a stop.
 * Positive `delayMinutes` means the bus is running late relative to schedule.
 *
 * Returns null when schedule data is missing or when the absolute delta exceeds
 * `maxAbsDelayMinutes` (most likely a trip-id mismatch — better to say nothing
 * than to show a misleading "+30 min late" label).
 */
export function computeScheduleDelay(
  args: ComputeScheduleDelayArgs,
): ScheduleDelay | null {
  const {
    scheduledDepartureSeconds,
    projectedArrivalEpochMs,
    serviceDayMidnightUtcMs,
    maxAbsDelayMinutes = DEFAULT_MAX_ABS_DELAY_MIN,
  } = args;
  if (scheduledDepartureSeconds == null) return null;
  const schedMs =
    serviceDayMidnightUtcMs + scheduledDepartureSeconds * 1000;
  const delayMinutes = (projectedArrivalEpochMs - schedMs) / 60_000;
  if (Math.abs(delayMinutes) > maxAbsDelayMinutes) return null;
  const onTimeWindow: OnTimeWindow =
    delayMinutes < -ON_TIME_BAND_MIN
      ? "early"
      : delayMinutes > ON_TIME_BAND_MIN
        ? "late"
        : "on-time";
  return { delayMinutes, onTimeWindow };
}
