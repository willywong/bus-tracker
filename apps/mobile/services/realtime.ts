import {
  computeNextPollDelay,
  createOutlierFilter,
  decodeFeed,
  dropImplausibleFixes,
  entitiesToPositions,
  parseRetryAfterMs,
  type TripRouteMap,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import { getTripToRouteMap } from "@/db/queries";
import { GTFS_VEHICLE_POSITIONS_URL } from "@/services/gtfsFeed";

// Polls data.gov.my's GTFS Realtime vehicle-position feed directly. One poll
// per 30 s matches the feed's update cadence; 429 / Retry-After responses
// back off via computeNextPollDelay.
const ENDPOINT = GTFS_VEHICLE_POSITIONS_URL;
const POLL_INTERVAL_MS = 30_000;

export interface RealtimeSnapshot {
  positions: VehiclePosition[];
  lastUpdated: number | null;
  lastError: Error | null;
  /** Epoch ms when the next scheduled tick will fire. Null when polling is stopped. */
  nextRefreshAt: number | null;
  /** True while a fetch is in flight. */
  isRefreshing: boolean;
}

export type PositionFilter = (incoming: VehiclePosition[]) => VehiclePosition[];

type Listener = () => void;

export interface RealtimeStore {
  getSnapshot(): RealtimeSnapshot;
  subscribe(listener: Listener): () => void;
  start(): void;
  stop(): void;
  /**
   * Forces an immediate poll, bypassing the 30 s timer. Used by pull-to-refresh.
   * Resolves once the tick finishes (success or fail). No-op if there are no
   * subscribers (refCount 0) or the app isn't active.
   */
  refresh(): Promise<void>;
  /**
   * Replaces the set of route codes the poller is watching. Clears the cached
   * tripMap so the next tick rebuilds it against the new set. Empty array
   * stops polling entirely.
   */
  setRouteCodes(codes: readonly string[]): void;
  setFilter(filter: PositionFilter): void;
  resetFilterState(): void;
  __forTests: {
    reset(): void;
    refCount(): number;
    tick(): Promise<void>;
    getRouteCodes(): readonly string[];
  };
}

export interface AppStateLike {
  /** RN 0.88 types this as `string | null | undefined`; we only compare to "active". */
  readonly currentState: AppStateStatus | string | null | undefined;
  addEventListener(
    type: "change",
    listener: (status: AppStateStatus) => void,
  ): { remove(): void };
}

/** Thrown when the realtime feed responds with a non-OK status. Carries the
 *  status and any parsed `Retry-After` so the store can back off intelligently.
 */
export class FeedFetchError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null) {
    super(`realtime ${status}`);
    this.name = "FeedFetchError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RealtimeDeps {
  fetchFeed: (signal: AbortSignal) => Promise<Uint8Array>;
  loadTripMap: (routeCodes: readonly string[]) => Promise<TripRouteMap>;
  appState: AppStateLike;
  now: () => number;
  pollIntervalMs: number;
  /** scheduler — lets tests swap in a manual clock */
  scheduleTick: (cb: () => void, ms: number) => () => void;
}

const defaultDeps: RealtimeDeps = {
  fetchFeed: async (signal) => {
    const res = await fetch(ENDPOINT, { signal });
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(
        res.headers.get("Retry-After"),
        Date.now(),
      );
      throw new FeedFetchError(res.status, retryAfterMs);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
  loadTripMap: async (routeCodes) => {
    if (routeCodes.length === 0) return new Map();
    const db = await openDb();
    const raw = await getTripToRouteMap(db, routeCodes);
    const typed = new Map<string, VehiclePosition["routeId"]>();
    for (const [tripId, code] of raw) {
      typed.set(tripId, code as VehiclePosition["routeId"]);
    }
    return typed;
  },
  appState: AppState,
  now: Date.now,
  pollIntervalMs: POLL_INTERVAL_MS,
  scheduleTick: (cb, ms) => {
    const handle = setTimeout(cb, ms);
    return () => clearTimeout(handle);
  },
};

function sameRouteCodes(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

export function createRealtimeStore(
  deps: Partial<RealtimeDeps> = {},
): RealtimeStore {
  const cfg: RealtimeDeps = { ...defaultDeps, ...deps };

  let snapshot: RealtimeSnapshot = {
    positions: [],
    lastUpdated: null,
    lastError: null,
    nextRefreshAt: null,
    isRefreshing: false,
  };
  const listeners = new Set<Listener>();
  let refCount = 0;

  let routeCodes: readonly string[] = [];
  let tripMap: TripRouteMap | null = null;
  let cancelTimer: (() => void) | null = null;
  let inflight: AbortController | null = null;
  let appStateSub: { remove(): void } | null = null;
  let consecutiveFailures = 0;
  const outlier = createOutlierFilter();
  let positionFilter: PositionFilter = (p) => outlier.accept(p);

  function notify() {
    for (const l of listeners) l();
  }

  function commit(patch: Partial<RealtimeSnapshot>, touched: boolean) {
    snapshot = {
      positions: patch.positions ?? snapshot.positions,
      lastUpdated: touched ? cfg.now() : snapshot.lastUpdated,
      lastError: patch.lastError ?? null,
      // Preserve the current next-refresh estimate across tick results;
      // scheduleNext() rewrites it when the follow-up timer is armed.
      nextRefreshAt: snapshot.nextRefreshAt,
      isRefreshing: snapshot.isRefreshing,
    };
    notify();
  }

  function setRefreshing(flag: boolean) {
    if (snapshot.isRefreshing === flag) return;
    snapshot = { ...snapshot, isRefreshing: flag };
    notify();
  }

  function setNextRefreshAt(value: number | null) {
    if (snapshot.nextRefreshAt === value) return;
    snapshot = { ...snapshot, nextRefreshAt: value };
    notify();
  }

  function cancelInflight() {
    inflight?.abort();
    inflight = null;
  }

  function clearTimer() {
    cancelTimer?.();
    cancelTimer = null;
  }

  async function tick(): Promise<void> {
    if (refCount === 0) return;
    if (routeCodes.length === 0) return;
    if (cfg.appState.currentState !== "active") return;

    cancelInflight();
    const ctrl = new AbortController();
    inflight = ctrl;
    setRefreshing(true);

    try {
      if (!tripMap) tripMap = await cfg.loadTripMap(routeCodes);
      const bytes = await cfg.fetchFeed(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const feed = decodeFeed(bytes);
      // Allow `vehicle.trip.route_id` (route short-name e.g. "T816") to
      // resolve a position when the static `trip_id` lookup misses, so
      // upstream date-prefix drift between the static bundle and the
      // realtime feed doesn't drop every vehicle on the floor.
      const allowed = new Set(
        routeCodes as readonly VehiclePosition["routeId"][],
      );
      const raw = dropImplausibleFixes(
        entitiesToPositions(feed, tripMap, cfg.now(), allowed),
        cfg.now(),
      );
      const filtered = positionFilter(raw);
      // Dedup by vehicleId — keep the latest-observed entry per id. The GTFS-RT
      // fallback chain in entitiesToPositions drops to trip_id when all vehicle
      // identifiers are missing, which can produce sibling collisions on the
      // `<MarkerAnimated key={p.vehicleId}>` map layer and crash Fabric during
      // unmount. Defensive — noop when ids are already unique.
      const byId = new Map<string, (typeof filtered)[number]>();
      for (const p of filtered) {
        const prev = byId.get(p.vehicleId);
        if (!prev || p.observedAt >= prev.observedAt) byId.set(p.vehicleId, p);
      }
      const deduped = Array.from(byId.values());
      if (__DEV__()) {
        console.log(
          `[realtime] ${deduped.length} positions (filtered=${filtered.length}, raw=${raw.length})`,
        );
        if (deduped.length !== filtered.length) {
          console.warn(
            '[realtime] dropped',
            filtered.length - deduped.length,
            'duplicate vehicleId entries',
          );
        }
      }
      commit({ positions: deduped, lastError: null }, true);
      consecutiveFailures = 0;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (isAbortError(err)) return;
      const e = err instanceof Error ? err : new Error(String(err));
      consecutiveFailures += 1;
      console.warn("[realtime] tick failed:", e.message);
      commit({ lastError: e }, false);
    } finally {
      if (inflight === ctrl) inflight = null;
      setRefreshing(false);
      if (
        refCount > 0 &&
        routeCodes.length > 0 &&
        cfg.appState.currentState === "active"
      ) {
        scheduleNext();
      } else {
        setNextRefreshAt(null);
      }
    }
  }

  function scheduleNext() {
    clearTimer();
    const lastErr = snapshot.lastError;
    const status = lastErr instanceof FeedFetchError ? lastErr.status : undefined;
    const retryAfterMs =
      lastErr instanceof FeedFetchError && lastErr.retryAfterMs != null
        ? lastErr.retryAfterMs
        : undefined;
    const delayMs = computeNextPollDelay({
      baseMs: cfg.pollIntervalMs,
      consecutiveFailures,
      status,
      retryAfterMs,
    });
    setNextRefreshAt(cfg.now() + delayMs);
    cancelTimer = cfg.scheduleTick(() => {
      void tick();
    }, delayMs);
  }

  function onAppStateChange(status: AppStateStatus) {
    if (refCount === 0) return;
    if (status === "active") {
      // Clear accumulated backoff — a foreground resume is a fresh attempt,
      // not a continuation of the prior failure streak.
      consecutiveFailures = 0;
      void tick();
    } else {
      clearTimer();
      cancelInflight();
      setRefreshing(false);
      setNextRefreshAt(null);
    }
  }

  function startPolling() {
    if (!appStateSub) {
      appStateSub = cfg.appState.addEventListener("change", onAppStateChange);
    }
    if (routeCodes.length === 0) return;
    if (cfg.appState.currentState === "active") {
      void tick();
    }
  }

  function stopPolling() {
    clearTimer();
    cancelInflight();
    tripMap = null;
    outlier.reset();
    appStateSub?.remove();
    appStateSub = null;
    setRefreshing(false);
    setNextRefreshAt(null);
  }

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      refCount += 1;
      if (refCount === 1) startPolling();
    },
    stop() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) stopPolling();
    },
    refresh: () => tick(),
    setRouteCodes(next) {
      if (sameRouteCodes(routeCodes, next)) return;
      routeCodes = [...next];
      tripMap = null;
      if (routeCodes.length === 0) {
        clearTimer();
        cancelInflight();
        setRefreshing(false);
        setNextRefreshAt(null);
        commit({ positions: [] }, false);
        return;
      }
      if (refCount > 0 && cfg.appState.currentState === "active") {
        void tick();
      }
    },
    setFilter(filter) {
      positionFilter = filter;
    },
    resetFilterState() {
      outlier.reset();
    },
    __forTests: {
      reset() {
        stopPolling();
        refCount = 0;
        routeCodes = [];
        listeners.clear();
        consecutiveFailures = 0;
        snapshot = {
          positions: [],
          lastUpdated: null,
          lastError: null,
          nextRefreshAt: null,
          isRefreshing: false,
        };
        positionFilter = (p) => p;
      },
      refCount() {
        return refCount;
      },
      tick: () => tick(),
      getRouteCodes: () => routeCodes,
    },
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// `__DEV__` is a RN global — shim for unit tests.
function __DEV__(): boolean {
  const g = globalThis as unknown as { __DEV__?: boolean };
  return g.__DEV__ ?? false;
}

/** Default singleton used by the app and by `useBusPosition`. */
export const realtimeStore: RealtimeStore = createRealtimeStore();
