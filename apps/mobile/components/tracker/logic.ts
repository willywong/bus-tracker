import { formatDistanceToNowStrict } from 'date-fns';
import { useEffect, useState } from 'react';

import type { ApproachingBus } from '@/hooks/useEta';

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

export function useLastUpdatedLabel(lastUpdated: number | null): {
  label: string;
  isStale: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (lastUpdated == null) {
    return { label: 'Waiting for feed…', isStale: true };
  }
  const age = now - lastUpdated;
  const label = `Updated ${formatDistanceToNowStrict(lastUpdated, { addSuffix: true })}`;
  return { label, isStale: age >= STALE_TICKER_MS };
}

export type HeroState = 'waiting' | 'relaxed' | 'leaveNow' | 'walking';

export function resolveHeroState(args: {
  isWalking: boolean;
  leaveIn: number | null;
}): HeroState {
  if (args.isWalking) return 'walking';
  if (args.leaveIn == null) return 'waiting';
  if (args.leaveIn <= LEAVE_NOW_WINDOW_MINUTES) return 'leaveNow';
  return 'relaxed';
}
