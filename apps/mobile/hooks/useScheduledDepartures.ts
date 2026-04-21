import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import {
  getNextScheduledDepartures,
  getServiceDayBounds,
  type ScheduledDeparture,
  type ServiceDayBounds,
} from "@/db/queries";
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
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-query every 30s — schedule data is static so we just need `now` to
  // advance for `serviceEnded` / `beforeServiceStart` / the upcoming window.
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Immediate re-query on foreground — covers the case where the phone was
  // asleep for an hour and the in-memory `upcoming` list is stale.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

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
        setState({ upcoming, bounds, ready: true, error: null });
      } catch (err) {
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

  return {
    upcoming,
    firstEpochMs: bounds.firstEpochMs,
    lastEpochMs: bounds.lastEpochMs,
    serviceEnded,
    beforeServiceStart,
    ready,
    error,
  };
}
