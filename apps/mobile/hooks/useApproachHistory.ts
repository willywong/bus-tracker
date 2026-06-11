import { useEffect, useMemo, useRef, useState } from 'react';

import { devNow } from '@/utils/devClock';

/**
 * Rolling telemetry buffer for the bus currently approaching the user's stop.
 *
 * The GTFS-Realtime feed only polls every ~30 s and frequently omits `speed`,
 * and `useEta` keeps just a single previous position per vehicle — so on its
 * own the app can't tell whether the bus *stopped*, *sped up*, or *changed
 * speed* between two refreshes. This hook records a short history of approach
 * samples (distance-along-route to the stop, ETA minutes, feed speed) keyed to
 * the tracked vehicle and derives the signals the Tracker UI needs to make the
 * live motion legible:
 *
 *  - `closingSpeedKmh` — speed *toward your stop* derived from the last two
 *    samples' change in `forwardMeters`. Fills the gap when feed `speed` is
 *    null (the common case on the Prasarana feed).
 *  - `effectiveSpeedKmh` — feed speed when present, else the closing speed.
 *  - `trend` — whether the ETA is `approaching` (distance falling), `holding`
 *    (bus not making progress) or `slipping` (distance growing).
 *  - `dwellSeconds` — how long since the bus last made meaningful progress
 *    toward the stop. Drives the "Stopped 45 s" dwell readout.
 *  - `samples` — the recent points, for the approach-trend sparkline.
 *
 * The buffer resets whenever the tracked `vehicleId` changes (a new bus is a
 * new approach) or live data is lost.
 */

const MAX_SAMPLES = 12;
/** Ignore a new observation that lands within this gap of the previous one (deduped poll). */
const SAMPLE_MIN_GAP_MS = 5_000;
/** A forward-distance drop of at least this many meters counts as real progress toward the stop. */
const MEANINGFUL_DECREASE_M = 15;
/** How many recent samples to assess for the trend slope. */
const TREND_WINDOW = 5;
/** |approach rate| under this (m/s) reads as "holding" rather than approaching/slipping. */
const HOLDING_RATE_MPS = 0.6;

export interface ApproachSample {
  /** Observation time (epoch ms) — the vehicle's own `observedAt` when present. */
  t: number;
  /** Along-route distance to the user's stop, in meters. */
  forwardMeters: number;
  /** Rounded ETA minutes at this sample, if known. */
  minutesToStop: number | null;
  /** Feed speed (km/h) at this sample, if reported. */
  speedKmh: number | null;
}

export type ApproachTrend = 'approaching' | 'holding' | 'slipping' | 'unknown';

export interface ApproachHistory {
  samples: ApproachSample[];
  /** Speed toward the stop derived from the last two samples (km/h). Null with <2 samples. */
  closingSpeedKmh: number | null;
  /** Feed speed when finite, otherwise the derived closing speed. Null when neither is known. */
  effectiveSpeedKmh: number | null;
  /** True when `effectiveSpeedKmh` is the derived closing speed (no feed speed) — UI may prefix "~". */
  speedIsEstimated: boolean;
  trend: ApproachTrend;
  /** Seconds since the bus last made meaningful progress toward the stop. Null until the first sample. */
  dwellSeconds: number | null;
}

export interface UseApproachHistoryInput {
  vehicleId: string | null;
  forwardMeters: number | null;
  minutesToStop: number | null;
  speedKmh: number | null;
  /** Vehicle's own observation timestamp; falls back to the local clock when absent. */
  observedAt: number | null;
  isStale: boolean;
}

function toFiniteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function useApproachHistory(
  input: UseApproachHistoryInput,
): ApproachHistory {
  const bufRef = useRef<ApproachSample[]>([]);
  const vehicleRef = useRef<string | null>(null);
  // Baseline of the last meaningful progress toward the stop — `dwellSeconds`
  // counts up from here whenever the bus stalls.
  const progressRef = useRef<{ t: number; meters: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [nowTick, setNowTick] = useState(() => devNow());

  const hasLiveVehicle = input.vehicleId != null;

  // Reset when the tracked vehicle changes or live data is lost.
  useEffect(() => {
    if (input.vehicleId === vehicleRef.current) return;
    vehicleRef.current = input.vehicleId;
    bufRef.current = [];
    progressRef.current = null;
    setVersion((v) => v + 1);
  }, [input.vehicleId]);

  // Record a sample whenever fresh live telemetry arrives.
  useEffect(() => {
    if (input.vehicleId == null || input.forwardMeters == null || input.isStale) {
      return;
    }
    const t = toFiniteOrNull(input.observedAt) ?? devNow();
    const forwardMeters = input.forwardMeters;
    const buf = bufRef.current;
    const last = buf[buf.length - 1];

    // Skip duplicate / near-duplicate observations (same poll re-delivered).
    if (last != null) {
      if (t <= last.t) return;
      if (
        t - last.t < SAMPLE_MIN_GAP_MS &&
        Math.abs(last.forwardMeters - forwardMeters) < 1
      ) {
        return;
      }
    }

    buf.push({
      t,
      forwardMeters,
      minutesToStop: input.minutesToStop,
      speedKmh: toFiniteOrNull(input.speedKmh),
    });
    if (buf.length > MAX_SAMPLES) buf.shift();

    const progress = progressRef.current;
    if (progress == null || forwardMeters <= progress.meters - MEANINGFUL_DECREASE_M) {
      progressRef.current = { t, meters: forwardMeters };
    }

    setVersion((v) => v + 1);
  }, [
    input.vehicleId,
    input.forwardMeters,
    input.observedAt,
    input.minutesToStop,
    input.speedKmh,
    input.isStale,
  ]);

  // Tick once a second so `dwellSeconds` counts up live between polls. Only
  // runs while a vehicle is tracked to avoid an always-running timer.
  useEffect(() => {
    if (!hasLiveVehicle) return;
    const id = setInterval(() => setNowTick(devNow()), 1_000);
    return () => clearInterval(id);
  }, [hasLiveVehicle]);

  return useMemo<ApproachHistory>(() => {
    const samples = bufRef.current.slice();
    const n = samples.length;

    let closingSpeedKmh: number | null = null;
    if (n >= 2) {
      const prev = samples[n - 2];
      const cur = samples[n - 1];
      const dtSec = (cur.t - prev.t) / 1_000;
      if (dtSec > 0) {
        const closingMps = (prev.forwardMeters - cur.forwardMeters) / dtSec;
        closingSpeedKmh = Math.max(0, closingMps * 3.6);
      }
    }

    const feedSpeed = n > 0 ? samples[n - 1].speedKmh : null;
    const speedIsEstimated = feedSpeed == null && closingSpeedKmh != null;
    const effectiveSpeedKmh = feedSpeed ?? closingSpeedKmh;

    let trend: ApproachTrend = 'unknown';
    if (n >= 2) {
      const window = samples.slice(Math.max(0, n - TREND_WINDOW));
      const first = window[0];
      const last = window[window.length - 1];
      const dtSec = (last.t - first.t) / 1_000;
      if (dtSec > 0) {
        // Positive rate = distance shrinking = approaching the stop.
        const approachRateMps = (first.forwardMeters - last.forwardMeters) / dtSec;
        if (approachRateMps > HOLDING_RATE_MPS) trend = 'approaching';
        else if (approachRateMps < -HOLDING_RATE_MPS) trend = 'slipping';
        else trend = 'holding';
      }
    }

    const progress = progressRef.current;
    const dwellSeconds =
      progress != null ? Math.max(0, Math.round((nowTick - progress.t) / 1_000)) : null;

    return {
      samples,
      closingSpeedKmh,
      effectiveSpeedKmh,
      speedIsEstimated,
      trend,
      dwellSeconds,
    };
    // `version` bumps on every buffer mutation; `nowTick` drives the dwell clock.
  }, [version, nowTick]);
}
