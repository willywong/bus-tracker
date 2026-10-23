import { useEffect, useMemo, useState } from "react";
import { openDb } from "@/db/database";
import {
  getNextScheduledDepartures,
  getServiceDayBounds,
  type ScheduledDeparture,
  type ServiceDayBounds,
} from "@/db/queries";
import { useNow } from "@/hooks/useNow";
import { useStaticGtfs } from "@/hooks/useStaticGtfs";

const REFRESH_MS = 30_000;
const DEFAULT_LIMIT = 8;

export interface UseScheduledDeparturesArgs {
  stopId: string;
  routeCode: string;
  /** Max departures to return. Default: 8. */
  limit?: number;
}

export interface UseScheduledDeparturesResult {
  upcoming: ScheduledDeparture[];
  firstEpochMs: number | null;
  lastEpochMs: number | null;
  serviceEnded: boolean;
  beforeServiceStart: boolean;
  ready: boolean;
  error: Error | null;
}

export function useScheduledDepartures(
  args: UseScheduledDeparturesArgs,
): UseScheduledDeparturesResult {
  const { stopId, routeCode, limit = DEFAULT_LIMIT } = args;
  const staticGtfs = useStaticGtfs();

  const [state, setState] = useState<{
    upcoming: ScheduledDeparture[];
    bounds: ServiceDayBounds;
    ready: boolean;
    error: Error | null;
  }>({
    upcoming: [],
    bounds: { firstEpochMs: null, lastEpochMs: null },
    ready: false,
    error: null,
  });
  // Re-query every 30s on the shared clock (and on returning to the
  // foreground, when the phone may have slept for an hour): schedule data is
  // static, so only `now` moves `serviceEnded` / `beforeServiceStart` / the
  // upcoming window.
  const now = useNow(REFRESH_MS);

  useEffect(() => {
    if (!staticGtfs.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const nowDate = new Date(now);
        const [upcoming, bounds] = await Promise.all([
          getNextScheduledDepartures(db, routeCode, stopId, nowDate, limit),
          getServiceDayBounds(db, routeCode, stopId, nowDate),
        ]);
        if (cancelled) return;
        // Same rows as last time (the usual 30s tick): keep the old arrays so
        // nothing downstream rebuilds.
        setState((prev) =>
          prev.ready &&
          prev.error == null &&
          sameDepartures(prev.upcoming, upcoming) &&
          prev.bounds.firstEpochMs === bounds.firstEpochMs &&
          prev.bounds.lastEpochMs === bounds.lastEpochMs
            ? prev
            : { upcoming, bounds, ready: true, error: null },
        );
      } catch (err) {
        console.error(
          '[scheduledDepartures] load failed',
          'routeCode=', routeCode,
          'stopId=', stopId,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          ready: true,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stopId, routeCode, limit, now, staticGtfs.ready]);

  const { upcoming, bounds, ready, error } = state;
  const beforeServiceStart =
    bounds.firstEpochMs != null && now < bounds.firstEpochMs;
  const serviceEnded =
    bounds.lastEpochMs != null && now > bounds.lastEpochMs;

  return useMemo(
    () => ({
      upcoming,
      firstEpochMs: bounds.firstEpochMs,
      lastEpochMs: bounds.lastEpochMs,
      serviceEnded,
      beforeServiceStart,
      ready,
      error,
    }),
    [upcoming, bounds, serviceEnded, beforeServiceStart, ready, error],
  );
}

function sameDepartures(a: readonly ScheduledDeparture[], b: readonly ScheduledDeparture[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].tripId !== b[i].tripId || a[i].departureEpochMs !== b[i].departureEpochMs) return false;
  }
  return true;
}
