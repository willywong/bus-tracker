import {
  interpolateScheduledPosition,
  type LatLng,
} from '@bus-tracker/shared';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { openDb } from '@/db/database';
import { getStopTimesForTrip, type TripStopTimeRow } from '@/db/queries';

const TICK_MS = 15_000;

export interface UseScheduledBusPositionArgs {
  tripId: string | null;
  polyline: readonly LatLng[];
  stopsById: ReadonlyMap<string, LatLng>;
  /**
   * Service-day Malaysia-local midnight as a UTC epoch ms — comes from
   * `ScheduledDeparture.serviceDayMidnightUtcMs`. We need it to convert
   * `Date.now()` into "seconds since the trip's service-day midnight".
   */
  serviceDayMidnightUtcMs: number | null;
  loop?: boolean;
}

export interface UseScheduledBusPositionResult {
  coord: LatLng | null;
  ready: boolean;
}

/**
 * Estimates the on-route position of a scheduled trip using only timetable
 * data. Returns null while the trip hasn't started, has ended, or stop_times
 * are still loading.
 */
export function useScheduledBusPosition({
  tripId,
  polyline,
  stopsById,
  serviceDayMidnightUtcMs,
  loop = true,
}: UseScheduledBusPositionArgs): UseScheduledBusPositionResult {
  const [stopTimes, setStopTimes] = useState<TripStopTimeRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!tripId) {
      setStopTimes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const rows = await getStopTimesForTrip(db, tripId);
        if (!cancelled) setStopTimes(rows);
      } catch (err) {
        console.error(
          '[scheduledBusPosition] stop_times load failed',
          'tripId=', tripId,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
        if (!cancelled) setStopTimes(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  if (
    !tripId ||
    !stopTimes ||
    serviceDayMidnightUtcMs == null ||
    polyline.length < 2
  ) {
    return { coord: null, ready: false };
  }

  const nowSec = (now - serviceDayMidnightUtcMs) / 1000;
  const coord = interpolateScheduledPosition({
    stopTimes,
    stopsById,
    polyline,
    nowSec,
    loop,
  });
  return { coord, ready: true };
}
