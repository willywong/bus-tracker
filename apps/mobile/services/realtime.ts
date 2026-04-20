import {
  createOutlierFilter,
  decodeFeed,
  entitiesToPositions,
  type TripRouteMap,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import { getTripToRouteMap } from "@/db/queries";

const ENDPOINT =
  "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder";
const POLL_INTERVAL_MS = 30_000;
const ROUTE_CODES = ["T816", "T815"] as const;

export interface RealtimeSnapshot {
  positions: VehiclePosition[];
  lastUpdated: number | null;
  lastError: Error | null;
}

export type PositionFilter = (incoming: VehiclePosition[]) => VehiclePosition[];

type Listener = () => void;

export interface RealtimeStore {
  getSnapshot(): RealtimeSnapshot;
  subscribe(listener: Listener): () => void;
  start(): void;
  stop(): void;
  setFilter(filter: PositionFilter): void;
  resetFilterState(): void;
  __forTests: {
    reset(): void;
    refCount(): number;
    tick(): Promise<void>;
  };
}

export interface AppStateLike {
  readonly currentState: AppStateStatus;
  addEventListener(
    type: "change",
    listener: (status: AppStateStatus) => void,
  ): { remove(): void };
}

export interface RealtimeDeps {
  fetchFeed: (signal: AbortSignal) => Promise<Uint8Array>;
  loadTripMap: () => Promise<TripRouteMap>;
  appState: AppStateLike;
  now: () => number;
  pollIntervalMs: number;
  /** scheduler — lets tests swap in a manual clock */
  scheduleTick: (cb: () => void, ms: number) => () => void;
}

const defaultDeps: RealtimeDeps = {
  fetchFeed: async (signal) => {
    const res = await fetch(ENDPOINT, { signal });
    if (!res.ok) throw new Error(`realtime ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  loadTripMap: async () => {
    const db = await openDb();
    const raw = await getTripToRouteMap(db, ROUTE_CODES);
    const typed = new Map() as Map<string, VehiclePosition["routeId"]>;
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

export function createRealtimeStore(
  deps: Partial<RealtimeDeps> = {},
): RealtimeStore {
  const cfg: RealtimeDeps = { ...defaultDeps, ...deps };

  let snapshot: RealtimeSnapshot = {
    positions: [],
    lastUpdated: null,
    lastError: null,
  };
  const listeners = new Set<Listener>();
  let refCount = 0;

  let tripMap: TripRouteMap | null = null;
  let cancelTimer: (() => void) | null = null;
  let inflight: AbortController | null = null;
  let appStateSub: { remove(): void } | null = null;
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
    };
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
    if (cfg.appState.currentState !== "active") return;

    cancelInflight();
    const ctrl = new AbortController();
    inflight = ctrl;

    try {
      if (!tripMap) tripMap = await cfg.loadTripMap();
      const bytes = await cfg.fetchFeed(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const feed = decodeFeed(bytes);
      const raw = entitiesToPositions(feed, tripMap, cfg.now());
      const filtered = positionFilter(raw);
      if (__DEV__()) {
        console.log(
          `[realtime] ${filtered.length} positions (raw=${raw.length})`,
        );
      }
      commit({ positions: filtered, lastError: null }, true);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (isAbortError(err)) return;
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn("[realtime] tick failed:", e.message);
      commit({ lastError: e }, false);
    } finally {
      if (inflight === ctrl) inflight = null;
      if (refCount > 0 && cfg.appState.currentState === "active") {
        scheduleNext();
      }
    }
  }

  function scheduleNext() {
    clearTimer();
    cancelTimer = cfg.scheduleTick(() => {
      void tick();
    }, cfg.pollIntervalMs);
  }

  function onAppStateChange(status: AppStateStatus) {
    if (refCount === 0) return;
    if (status === "active") {
      void tick();
    } else {
      clearTimer();
      cancelInflight();
    }
  }

  function startPolling() {
    if (!appStateSub) {
      appStateSub = cfg.appState.addEventListener("change", onAppStateChange);
    }
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
        listeners.clear();
        snapshot = { positions: [], lastUpdated: null, lastError: null };
        positionFilter = (p) => p;
      },
      refCount() {
        return refCount;
      },
      tick: () => tick(),
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
