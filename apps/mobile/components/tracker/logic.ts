import { useEffect, useState } from 'react';

import {
  computeScheduleDelay,
  type EtaSource,
  type ScheduleDelay,
} from '@bus-tracker/shared';
import type { ScheduledDeparture } from '@/db/queries';

export interface ApproachingBus {
  minutesToStop: number | null;
  vehicleId: string;
  forwardMeters: number;
  source: EtaSource | null;
}

export type EtaMode = 'live' | 'schedule' | 'none';

export interface ResolvedEta {
  mode: EtaMode;
  /** Minutes-from-now shown as the hero countdown (before walk subtraction). */
  minutesToStop: number | null;
  /** Minutes-from-now derived purely from schedule. */
  scheduledMinutesToStop: number | null;
  /** Absolute epoch ms of the matched scheduled departure, if any. */
  scheduledEpochMs: number | null;
  /** Delay of the live ETA vs schedule (null when unmatched / no live). */
  delay: ScheduleDelay | null;
}

export interface ResolveEtaArgs {
  live: ApproachingBus | null;
  /** Seconds since service-day midnight for the live vehicle's scheduled departure from the stop. Null when unmatched. */
  liveTripScheduledSeconds: number | null;
  /** Service-day midnight of the live trip in UTC epoch ms. */
  liveTripServiceDayMidnightUtcMs: number | null;
  /** Projected absolute arrival epoch ms for the live vehicle (now + live minutes). */
  liveProjectedArrivalEpochMs: number | null;
  /** Nearest upcoming scheduled departure (lowest `departureEpochMs >= now`). */
  nextScheduled: ScheduledDeparture | null;
  isLiveStale: boolean;
  now: number;
}

/**
 * Blends live and schedule into one user-facing "minutes to stop" plus an
 * optional delay annotation when the live bus matches a scheduled trip.
 *
 * Preference order: live (not stale) → nearest scheduled → none.
 */
export function resolveEta(args: ResolveEtaArgs): ResolvedEta {
  const {
    live,
    liveTripScheduledSeconds,
    liveTripServiceDayMidnightUtcMs,
    liveProjectedArrivalEpochMs,
    nextScheduled,
    isLiveStale,
    now,
  } = args;

  const scheduledMinutesToStop =
    nextScheduled != null
      ? Math.max(0, Math.round((nextScheduled.departureEpochMs - now) / 60_000))
      : null;
  const scheduledEpochMs = nextScheduled?.departureEpochMs ?? null;

  const liveUsable =
    live?.minutesToStop != null && !isLiveStale ? live : null;

  if (liveUsable) {
    const delay =
      liveTripScheduledSeconds != null &&
      liveTripServiceDayMidnightUtcMs != null &&
      liveProjectedArrivalEpochMs != null
        ? computeScheduleDelay({
            scheduledDepartureSeconds: liveTripScheduledSeconds,
            projectedArrivalEpochMs: liveProjectedArrivalEpochMs,
            serviceDayMidnightUtcMs: liveTripServiceDayMidnightUtcMs,
          })
        : null;
    return {
      mode: 'live',
      minutesToStop: liveUsable.minutesToStop,
      scheduledMinutesToStop,
      scheduledEpochMs,
      delay,
    };
  }

  if (nextScheduled) {
    return {
      mode: 'schedule',
      minutesToStop: scheduledMinutesToStop,
      scheduledMinutesToStop,
      scheduledEpochMs,
      delay: null,
    };
  }

  return {
    mode: 'none',
    minutesToStop: null,
    scheduledMinutesToStop: null,
    scheduledEpochMs: null,
    delay: null,
  };
}

export function formatCountdownShort(minutesFromNow: number): string {
  if (minutesFromNow <= 1) return 'now';
  if (minutesFromNow < 60) return `in ${minutesFromNow} min`;
  const hours = Math.floor(minutesFromNow / 60);
  const mins = minutesFromNow % 60;
  if (hours < 24) return mins === 0 ? `in ${hours}h` : `in ${hours}h ${mins}m`;
  return '—';
}

export function formatClockHHMM(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

export function formatDeltaMin(delay: ScheduleDelay | null): string | null {
  if (!delay) return null;
  const m = Math.round(delay.delayMinutes);
  if (delay.onTimeWindow === 'on-time') return 'on time';
  if (m > 0) return `+${m} min`;
  return `${Math.abs(m)} min early`;
}

export const STALE_TICKER_MS = 90_000;
/** Rough free-flow bus speed used to infer an "on-schedule" baseline for the delay gauge. */
export const BASELINE_METERS_PER_MINUTE = 25_000 / 60;
/** Cap delta (minutes) that fills the gauge — anything ≥ this reads as fully delayed. */
export const GAUGE_FULL_DELAY_MINUTES = 15;
/** Window (minutes) around zero where the countdown switches to "Leave now" urgency. */
export const LEAVE_NOW_WINDOW_MINUTES = 2;

export type DelayStatus = 'onTime' | 'delayed' | 'heavilyDelayed';

export const statusLabel: Record<DelayStatus, string> = {
  onTime: 'On time',
  delayed: 'Delayed',
  heavilyDelayed: 'Heavily delayed',
};

export function formatMinutes(bus: ApproachingBus | null): string {
  if (!bus || bus.minutesToStop == null) return '—';
  return `${bus.minutesToStop}`;
}

export function computeDelay(bus: ApproachingBus | null): {
  status: DelayStatus;
  deltaMin: number;
} | null {
  if (!bus || bus.minutesToStop == null) return null;
  const baseline = bus.forwardMeters / BASELINE_METERS_PER_MINUTE;
  const deltaMin = bus.minutesToStop - baseline;
  const status: DelayStatus =
    deltaMin <= 1 ? 'onTime' : deltaMin <= 5 ? 'delayed' : 'heavilyDelayed';
  return { status, deltaMin };
}

export function formatWalkRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatLastUpdated(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Updated a few seconds ago';
  if (minutes < 2) return 'Updated a minute ago';
  return `Updated ${minutes} minutes ago`;
}

export function formatLastUpdatedShort(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 2) return '1 min ago';
  return `${minutes} min ago`;
}

export function useLastUpdatedLabel(lastUpdated: number | null): {
  label: string;
  shortLabel: string;
  isStale: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  if (lastUpdated == null) {
    return {
      label: 'Waiting for feed…',
      shortLabel: 'Waiting',
      isStale: true,
    };
  }
  const age = now - lastUpdated;
  return {
    label: formatLastUpdated(age),
    shortLabel: formatLastUpdatedShort(age),
    isStale: age >= STALE_TICKER_MS,
  };
}

export type HeroState =
  | 'waiting'
  | 'relaxed'
  | 'leaveNow'
  | 'walking'
  | 'hurry';

export function resolveHeroState(args: {
  isWalking: boolean;
  leaveIn: number | null;
  /** Minutes until the bus arrives at the user's stop. Used to detect "not enough time to walk". */
  minutesToStop: number | null;
  /** Walk-to-stop time from settings (minutes). */
  walkMinutes: number;
}): HeroState {
  if (args.isWalking) return 'walking';
  if (args.leaveIn == null) return 'waiting';
  // Bus is arriving before the normal walk would finish — prompt the user to
  // walk faster. Only fire when the bus hasn't already arrived (>0 min).
  if (
    args.minutesToStop != null &&
    args.minutesToStop > 0 &&
    args.minutesToStop < args.walkMinutes
  ) {
    return 'hurry';
  }
  if (args.leaveIn <= LEAVE_NOW_WINDOW_MINUTES) return 'leaveNow';
  return 'relaxed';
}
