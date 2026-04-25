import {
  decodeFeed,
  entitiesToAlerts,
  filterAlertsForScope,
  type ServiceAlert,
} from "@bus-tracker/shared";
import { AppState, type AppStateStatus } from "react-native";

import { API_BASE_URL } from "@/config/env";

const ENDPOINT = `${API_BASE_URL}/api/gtfs-alerts`;
const POLL_INTERVAL_MS = 5 * 60_000;

export interface AlertsSnapshot {
  alerts: ServiceAlert[];
  lastUpdated: number | null;
  lastError: Error | null;
  isRefreshing: boolean;
}

type Listener = () => void;

export interface AlertsStore {
  getSnapshot(): AlertsSnapshot;
  subscribe(l: Listener): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  setScope(opts: {
    routeCodes?: readonly string[];
    stopIds?: readonly string[];
  }): void;
}

interface AlertsDeps {
  fetchFeed: (signal: AbortSignal) => Promise<Uint8Array>;
  appState: {
    readonly currentState: AppStateStatus;
    addEventListener(
      t: "change",
      l: (s: AppStateStatus) => void,
    ): { remove(): void };
  };
  now: () => number;
  pollIntervalMs: number;
  scheduleTick: (cb: () => void, ms: number) => () => void;
}

const defaultDeps: AlertsDeps = {
  fetchFeed: async (signal) => {
    const res = await fetch(ENDPOINT, { signal });
    if (!res.ok) throw new Error(`alerts ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  appState: AppState,
  now: Date.now,
  pollIntervalMs: POLL_INTERVAL_MS,
  scheduleTick: (cb, ms) => {
    const h = setTimeout(cb, ms);
    return () => clearTimeout(h);
  },
};

export function createAlertsStore(
  deps: Partial<AlertsDeps> = {},
): AlertsStore {
  const cfg: AlertsDeps = { ...defaultDeps, ...deps };

  let snapshot: AlertsSnapshot = {
    alerts: [],
    lastUpdated: null,
    lastError: null,
    isRefreshing: false,
  };
  const listeners = new Set<Listener>();
  let refCount = 0;
  let cancelTimer: (() => void) | null = null;
  let inflight: AbortController | null = null;
  let appStateSub: { remove(): void } | null = null;
  let rawAlerts: ServiceAlert[] = [];
  let routeCodes = new Set<string>();
  let stopIds = new Set<string>();

  function notify() {
    for (const l of listeners) l();
  }

  function recomputeFiltered() {
    const filtered = filterAlertsForScope(rawAlerts, {
      routeCodes,
      stopIds,
    });
    snapshot = { ...snapshot, alerts: filtered };
  }

  async function tick(): Promise<void> {
    if (refCount === 0) return;
    if (cfg.appState.currentState !== "active") return;
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    snapshot = { ...snapshot, isRefreshing: true };
    notify();
    try {
      const bytes = await cfg.fetchFeed(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const feed = decodeFeed(bytes);
      rawAlerts = entitiesToAlerts(feed);
      recomputeFiltered();
      snapshot = {
        ...snapshot,
        lastUpdated: cfg.now(),
        lastError: null,
        isRefreshing: false,
      };
      notify();
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err instanceof Error && err.name === "AbortError") return;
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn("[alerts] tick failed", e.message);
      snapshot = { ...snapshot, lastError: e, isRefreshing: false };
      notify();
    } finally {
      if (inflight === ctrl) inflight = null;
      if (refCount > 0 && cfg.appState.currentState === "active") {
        cancelTimer?.();
        cancelTimer = cfg.scheduleTick(() => {
          void tick();
        }, cfg.pollIntervalMs);
      }
    }
  }

  function onAppStateChange(s: AppStateStatus) {
    if (refCount === 0) return;
    if (s === "active") void tick();
    else {
      cancelTimer?.();
      cancelTimer = null;
      inflight?.abort();
      inflight = null;
    }
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
      if (refCount === 1) {
        appStateSub = cfg.appState.addEventListener("change", onAppStateChange);
        if (cfg.appState.currentState === "active") void tick();
      }
    },
    stop() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) {
        cancelTimer?.();
        cancelTimer = null;
        inflight?.abort();
        inflight = null;
        appStateSub?.remove();
        appStateSub = null;
      }
    },
    refresh: () => tick(),
    setScope({ routeCodes: codes, stopIds: stops }) {
      if (codes) routeCodes = new Set(codes);
      if (stops) stopIds = new Set(stops);
      recomputeFiltered();
      notify();
    },
  };
}

export const alertsStore: AlertsStore = createAlertsStore();
