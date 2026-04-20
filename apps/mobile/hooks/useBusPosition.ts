import type { RouteId } from "@bus-tracker/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  realtimeStore,
  type RealtimeSnapshot,
  type RealtimeStore,
} from "@/services/realtime";
import { mockRealtimeStore } from "@/services/realtime-mock";

const USE_MOCK =
  process.env.EXPO_PUBLIC_MOCK_REALTIME === "1" ||
  process.env.EXPO_PUBLIC_MOCK_REALTIME === "true";

const defaultStore: RealtimeStore = USE_MOCK ? mockRealtimeStore : realtimeStore;

export interface UseBusPositionResult {
  positions: RealtimeSnapshot["positions"];
  lastUpdated: number | null;
  error: Error | null;
}

export interface UseBusPositionOptions {
  /** Filter positions down to this route. Omit to return all polled routes. */
  routeCode?: RouteId;
  /** Injection seam for tests. */
  store?: RealtimeStore;
}

/**
 * Subscribes to the live vehicle-position stream.
 *
 * Uses ref-counted start/stop on the module-level store so multiple
 * screens share a single poller. When the last subscriber unmounts,
 * polling stops. The poller itself pulls *all* tracked routes; this hook
 * filters the snapshot to the caller's selected route.
 */
if (USE_MOCK && typeof console !== "undefined") {
  console.log(
    "[realtime] using MOCK store (EXPO_PUBLIC_MOCK_REALTIME=1) — unset to use live data",
  );
}

export function useBusPosition(
  options: UseBusPositionOptions | RealtimeStore = {},
): UseBusPositionResult {
  // Back-compat: an earlier signature accepted the store positionally.
  const { routeCode, store = defaultStore } =
    typeof (options as RealtimeStore).subscribe === "function"
      ? ({ store: options as RealtimeStore } as UseBusPositionOptions)
      : (options as UseBusPositionOptions);

  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);

  const snapshot = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  const positions = useMemo(() => {
    if (!routeCode) return snapshot.positions;
    return snapshot.positions.filter((p) => p.routeId === routeCode);
  }, [snapshot.positions, routeCode]);

  return {
    positions,
    lastUpdated: snapshot.lastUpdated,
    error: snapshot.lastError,
  };
}
