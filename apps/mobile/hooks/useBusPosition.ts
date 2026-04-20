import { useEffect, useSyncExternalStore } from "react";
import {
  realtimeStore,
  type RealtimeSnapshot,
  type RealtimeStore,
} from "@/services/realtime";

export interface UseBusPositionResult {
  positions: RealtimeSnapshot["positions"];
  lastUpdated: number | null;
  error: Error | null;
}

/**
 * Subscribes to the live T816 vehicle-position stream.
 *
 * Uses ref-counted start/stop on the module-level store so multiple
 * screens share a single poller. When the last subscriber unmounts,
 * polling stops.
 */
export function useBusPosition(
  store: RealtimeStore = realtimeStore,
): UseBusPositionResult {
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

  return {
    positions: snapshot.positions,
    lastUpdated: snapshot.lastUpdated,
    error: snapshot.lastError,
  };
}
