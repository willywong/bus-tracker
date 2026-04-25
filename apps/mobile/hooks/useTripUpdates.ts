import type { TripUpdateRecord } from "@bus-tracker/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { tripUpdatesStore } from "@/services/trip-updates";

export interface UseTripUpdatesResult {
  byTrip: ReadonlyMap<string, TripUpdateRecord>;
  /** Per-stop arrival delay (seconds) derived from the current feed. */
  getArrivalDelaySec: (tripId: string, stopId: string) => number | null;
  /** Stop-level ETA epoch ms if the feed provides one for (tripId, stopId). */
  getArrivalTimeMs: (tripId: string, stopId: string) => number | null;
  lastUpdated: number | null;
  lastError: Error | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribes to the TripUpdates store and exposes handy lookups for driving
 * ETA displays. Safe to mount unconditionally — the store ref-counts its
 * poller and only fetches when at least one component is listening.
 */
export function useTripUpdates(): UseTripUpdatesResult {
  const snap = useSyncExternalStore(
    tripUpdatesStore.subscribe,
    tripUpdatesStore.getSnapshot,
    tripUpdatesStore.getSnapshot,
  );

  useEffect(() => {
    tripUpdatesStore.start();
    return () => tripUpdatesStore.stop();
  }, []);

  const api = useMemo(
    () => ({
      getArrivalDelaySec: (tripId: string, stopId: string): number | null => {
        const rec = snap.byTrip.get(tripId);
        if (!rec) return null;
        const hit = rec.stopTimeUpdates.find((s) => s.stopId === stopId);
        if (!hit) return rec.delaySec ?? null;
        if (typeof hit.arrivalDelaySec === "number") return hit.arrivalDelaySec;
        if (typeof hit.departureDelaySec === "number")
          return hit.departureDelaySec;
        return rec.delaySec ?? null;
      },
      getArrivalTimeMs: (tripId: string, stopId: string): number | null => {
        const rec = snap.byTrip.get(tripId);
        if (!rec) return null;
        const hit = rec.stopTimeUpdates.find((s) => s.stopId === stopId);
        if (!hit) return null;
        return hit.arrivalTimeMs ?? hit.departureTimeMs ?? null;
      },
    }),
    [snap.byTrip],
  );

  return {
    byTrip: snap.byTrip,
    getArrivalDelaySec: api.getArrivalDelaySec,
    getArrivalTimeMs: api.getArrivalTimeMs,
    lastUpdated: snap.lastUpdated,
    lastError: snap.lastError,
    isRefreshing: snap.isRefreshing,
    refresh: () => tripUpdatesStore.refresh(),
  };
}
