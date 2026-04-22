import { useEffect, useState } from 'react';

import {
  computeScheduleDelay,
  type EtaSource,
  type ScheduleDelay,
} from '@bus-tracker/shared';
import type { ScheduledDeparture } from '@/db/queries';
import { devNow } from '@/utils/devClock';

export interface ApproachingBus {
  minutesToStop: number | null;
  vehicleId: string;
  forwardMeters: number;
  source: EtaSource | null;
  /** Vehicle speed in km/h (Prasarana feed publishes km/h despite GTFS-RT spec). Null when unknown. */
  speedKmh: number | null;
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

/**
 * Module-level 12h/24h preference — kept here so pure formatters can read it
 * without accepting an extra argument at every call site. `SettingsProvider`
 * pushes the current user preference in via `setClockUse24h` whenever it
 * changes. Defaults to 24h to match the pre-toggle behaviour of the app.
 */
let use24hClock = true;
export function setClockUse24h(v: boolean): void {
  use24hClock = v;
}
export function getClockUse24h(): boolean {
  return use24hClock;
}

export function formatClockHHMM(epochMs: number): string {
  const date = new Date(epochMs);
  if (use24hClock) {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kuala_Lumpur',
    });
  }
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
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

export type DelayTone = 'on-time' | 'late' | 'early';

/**
 * Self-labelled delay text ("On schedule" / "3 min late" / "2 min early") for
 * the compare row's pill. Returns null when the delay isn't known.
 */
export function formatDelayLabel(
  delay: ScheduleDelay | null,
): { text: string; tone: DelayTone } | null {
  if (!delay) return null;
  const m = Math.abs(Math.round(delay.delayMinutes));
  if (delay.onTimeWindow === 'on-time') {
    return { text: 'On schedule', tone: 'on-time' };
  }
  if (delay.onTimeWindow === 'late') {
    return { text: `${m} min late`, tone: 'late' };
  }
  return { text: `${m} min early`, tone: 'early' };
}

/**
 * Human distance — "650 m" under 1 km, "2.1 km" otherwise. Returns null when
 * the meters value isn't finite. Caller supplies any surrounding label ("away",
 * "to stop", etc.).
 */
export function formatDistanceToStop(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1_000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

/**
 * Compact age for a vehicle's own `observedAt` timestamp. Mirrors
 * formatLastUpdatedShort but keeps seconds resolution for the freshest pings.
 */
export function formatVehicleObservedAge(
  observedAtMs: number | null | undefined,
  now: number,
): string | null {
  if (observedAtMs == null || !Number.isFinite(observedAtMs)) return null;
  const age = now - observedAtMs;
  if (age < 0) return 'just now';
  if (age < 60_000) {
    const s = Math.max(1, Math.floor(age / 1_000));
    return `${s} s ago`;
  }
  const m = Math.floor(age / 60_000);
  if (m < 2) return '1 min ago';
  return `${m} min ago`;
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

/**
 * Seconds remaining until the next realtime poll. Ticks once per second while
 * `nextRefreshAt` is set. Returns null when the store isn't polling (no
 * subscriber or app backgrounded).
 */
export function useRefreshCountdownSeconds(
  nextRefreshAt: number | null,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (nextRefreshAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [nextRefreshAt]);
  if (nextRefreshAt == null) return null;
  const secs = Math.ceil((nextRefreshAt - now) / 1_000);
  // Clamp to [0, 60] — we never poll slower than once a minute, and a
  // negative value just means the tick is imminent.
  return Math.max(0, Math.min(60, secs));
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

// ---------------------------------------------------------------------------
// Arrival status — contextual "Arriving…" / "Arrived" labels derived from the
// precise along-polyline distance + rounded ETA minutes + vehicle speed. Lets
// every surface (Live Activity, hero, card, map, callout) speak with one voice
// about whether the bus is imminent or at the stop.
// ---------------------------------------------------------------------------

export type ArrivalStatus = 'en-route' | 'arriving' | 'arrived';

/** Within this many meters + slow speed, the bus is considered docked at the stop. */
export const ARRIVED_METERS = 40;
/** Max speed (km/h) to count as "actually stopped" vs driving through a nearby point. */
export const ARRIVED_MAX_SPEED_KMH = 8;
/** Within this many meters, or ≤ ARRIVING_MINUTES, the bus is on final approach. */
export const ARRIVING_METERS = 300;
/** Minutes-until threshold that flips the status to `arriving`. */
export const ARRIVING_MINUTES = 1;
/** How long `"Arrived"` stays visible after the bus starts moving again. */
export const ARRIVED_LATCH_MS = 45_000;

export interface ArrivalStatusInput {
  minutesToStop: number | null;
  /** Exact along-polyline distance to stop, in meters. Null when no live vehicle. */
  forwardMeters: number | null;
  speedKmh: number | null;
  isStale: boolean;
  mode: EtaMode;
}

/**
 * Pure classifier. Returns `en-route` unless we have a fresh live signal — we
 * never claim "Arriving" or "Arrived" from schedule-only data or a stale feed.
 */
export function getArrivalStatus(input: ArrivalStatusInput): ArrivalStatus {
  if (input.mode !== 'live' || input.isStale) return 'en-route';

  const meters = input.forwardMeters;
  const mins = input.minutesToStop;
  const speed = input.speedKmh;

  // Arrived: docked at the stop. Require both proximity AND low speed so we
  // don't fire on a bus driving through an adjacent polyline point.
  if (
    meters != null &&
    meters < ARRIVED_METERS &&
    (speed == null || speed < ARRIVED_MAX_SPEED_KMH)
  ) {
    return 'arrived';
  }

  // Arriving: visibly close by distance OR time. The OR-clause catches the
  // stuck-in-traffic case (close in minutes but further in meters) and the
  // missing-forwardMeters fallback.
  if (
    (meters != null && meters < ARRIVING_METERS) ||
    (mins != null && mins <= ARRIVING_MINUTES)
  ) {
    return 'arriving';
  }

  return 'en-route';
}

/**
 * Latches the `'arrived'` status for ARRIVED_LATCH_MS so the Live Activity and
 * in-app surfaces can keep the label visible for ~45s after the bus begins
 * moving away. Resets when the tracked vehicle changes (next trip rolled in).
 */
export function useArrivalStatus(input: {
  vehicleId: string | null;
  minutesToStop: number | null;
  forwardMeters: number | null;
  speedKmh: number | null;
  isStale: boolean;
  mode: EtaMode;
}): { status: ArrivalStatus } {
  const raw = getArrivalStatus({
    minutesToStop: input.minutesToStop,
    forwardMeters: input.forwardMeters,
    speedKmh: input.speedKmh,
    isStale: input.isStale,
    mode: input.mode,
  });

  const [latch, setLatch] = useState<
    { vehicleId: string | null; since: number } | null
  >(null);

  // Start / restart the latch whenever we see a fresh 'arrived'.
  useEffect(() => {
    if (raw !== 'arrived') return;
    setLatch((prev) =>
      prev && prev.vehicleId === input.vehicleId
        ? prev
        : { vehicleId: input.vehicleId, since: devNow() },
    );
  }, [raw, input.vehicleId]);

  // Clear the latch when the tracked vehicle rolls over to a different trip.
  useEffect(() => {
    setLatch((prev) =>
      prev && prev.vehicleId !== input.vehicleId ? null : prev,
    );
  }, [input.vehicleId]);

  // Expire the latch after ARRIVED_LATCH_MS — a single timeout per latch is
  // enough; no interval ticks needed.
  useEffect(() => {
    if (!latch) return;
    const remaining = ARRIVED_LATCH_MS - (devNow() - latch.since);
    if (remaining <= 0) {
      setLatch(null);
      return;
    }
    const t = setTimeout(() => setLatch(null), remaining);
    return () => clearTimeout(t);
  }, [latch]);

  if (latch && devNow() - latch.since < ARRIVED_LATCH_MS) {
    return { status: 'arrived' };
  }
  return { status: raw };
}
