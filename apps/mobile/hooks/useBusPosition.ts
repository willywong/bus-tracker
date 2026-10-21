import type { RouteId } from "@bus-tracker/shared";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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
  /**
   * Plausible vehicles in the feed(s) behind `routeCode` (every polled feed
   * when no route is given); see RealtimeSnapshot.
   */
  feedVehicleCount: number | null;
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

  // Only the fields read below. The store also notifies for its refresh
  // flags (about four times a poll); returning the same slice for those
  // keeps every trip consumer from re-rendering on each one.
  const slice = useRef<Slice | null>(null);
  const getSlice = useCallback(() => {
    const s = store.getSnapshot();
    const prev = slice.current;
    if (
      prev &&
      prev.positions === s.positions &&
      prev.lastUpdated === s.lastUpdated &&
      prev.lastError === s.lastError &&
      prev.feedVehicleCount === s.feedVehicleCount &&
      prev.feedHealthByRoute === s.feedHealthByRoute
    ) {
      return prev;
    }
    const next: Slice = {
      positions: s.positions,
      lastUpdated: s.lastUpdated,
      lastError: s.lastError,
      feedVehicleCount: s.feedVehicleCount,
      feedHealthByRoute: s.feedHealthByRoute,
    };
    slice.current = next;
    return next;
  }, [store]);
  const snapshot = useSyncExternalStore((cb) => store.subscribe(cb), getSlice, getSlice);

  const positions = useMemo(() => {
    if (!routeCode) return snapshot.positions;
    return snapshot.positions.filter((p) => p.routeId === routeCode);
  }, [snapshot.positions, routeCode]);

  // A route is judged by its own network's feed: Rapid KL buses mustn't
  // mask a feeder outage, and a Kuantan route (no live feed) has no count.
  const health = routeCode ? snapshot.feedHealthByRoute?.[routeCode] : undefined;
  const error = health ? (health.error ?? snapshot.lastError) : snapshot.lastError;
  const feedVehicleCount = health ? health.vehicleCount : snapshot.feedVehicleCount;

  return useMemo(
    () => ({ positions, lastUpdated: snapshot.lastUpdated, error, feedVehicleCount }),
    [positions, snapshot.lastUpdated, error, feedVehicleCount],
  );
}

type Slice = Pick<
  RealtimeSnapshot,
  "positions" | "lastUpdated" | "lastError" | "feedVehicleCount" | "feedHealthByRoute"
>;
