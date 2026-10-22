import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { healthNote, runSteps, type NetworkHealth, type TransitNetwork } from "@bus-tracker/shared";
import { openDb } from "@/db/database";
import { downloadTransitFeeds } from "@/services/gtfsFeed";
import {
  loadHealth,
  loadTodayNetwork,
  refreshTransitNetwork,
  serviceDatesFor,
  type NetworkDeps,
} from "@/services/transitNetwork";

export type TransitNetworkStatus = "loading" | "ready" | "refreshing" | "offline" | "error";

export interface TransitNetworkState {
  /** Today's compiled network (service day from 04:00 MYT), or null before the first build. */
  network: TransitNetwork | null;
  /**
   * Per-feed health on today's service date (spec §3.6); a feed never
   * downloaded is absent. Null until first read from the database.
   * Recomputed on load, after each refresh, and whenever the app comes back
   * to the foreground, so expiry shows without a download.
   */
  health: NetworkHealth | null;
  status: TransitNetworkStatus;
  /** The planner's one-line note about expired feeds left out of routing, or null. */
  note: string | null;
}

/** How long the first refresh waits for an idle moment before running anyway. */
const IDLE_TIMEOUT_MS = 5_000;
/** Dev: a frame gap during a refresh longer than this is logged as it happens. */
const FRAME_GAP_LOG_MS = 100;

const TransitNetworkContext = createContext<TransitNetworkState | null>(null);

function log(msg: string): void {
  console.log(`[transit-network] ${msg}`);
}

/**
 * Runs `fn` once the JS thread is idle (at most {@link IDLE_TIMEOUT_MS}
 * later). RN 0.88 defines `requestIdleCallback` (and no longer ships
 * `InteractionManager`); a timer covers any runtime without it. Returns a
 * cancel function.
 */
export function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, IDLE_TIMEOUT_MS);
  return () => clearTimeout(handle);
}

/**
 * Dev builds: starts timing the gaps between animation frames, the longest
 * the UI froze (task 00's measure). The returned function stops and returns
 * the longest gap in ms (0 in release builds).
 */
function watchFrameGaps(): () => number {
  if (!__DEV__ || typeof requestAnimationFrame !== "function") return () => 0;
  let running = true;
  const start = performance.now();
  let last = start;
  let longest = 0;
  const frame = () => {
    const t = performance.now();
    // Backgrounded, frames stop altogether; that isn't a stall.
    if (AppState.currentState === "active") {
      const gap = t - last;
      longest = Math.max(longest, gap);
      // Logged as it happens, so it lands between the refresh's own log lines.
      if (gap > FRAME_GAP_LOG_MS) {
        log(`frame gap ${Math.round(gap)} ms at +${Math.round(last - start)} ms`);
      }
    }
    last = t;
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => {
    running = false;
    return longest;
  };
}

/**
 * Serves the whole transit network app-wide. On mount it loads today's
 * stored network (so it works offline after one successful build), then
 * refreshes feeds and blobs in idle time and swaps the new network in. When
 * the app comes back on a new service day it switches to that day's blob
 * (built the day before as "tomorrow") and refreshes again.
 */
export function TransitNetworkProvider({
  children,
}: {
  children: ReactNode;
}): ReturnType<typeof createElement> {
  const [network, setNetwork] = useState<TransitNetwork | null>(null);
  const [status, setStatus] = useState<TransitNetworkStatus>("loading");
  const [health, setHealth] = useState<NetworkHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    let current: TransitNetwork | null = null;
    let loadedDate: string | null = null;
    let running = false;
    let again = false;
    let cancelIdle: (() => void) | null = null;
    const depsPromise: Promise<NetworkDeps> = openDb().then((db) => ({
      db,
      now: Date.now,
      download: downloadTransitFeeds,
      runSteps,
      log,
    }));

    async function load(): Promise<TransitNetwork | null> {
      const deps = await depsPromise;
      const date = serviceDatesFor(deps.now())[0];
      const net = await loadTodayNetwork(deps);
      if (!cancelled) {
        loadedDate = date;
        current = net;
        setNetwork(net);
      }
      return net;
    }

    /** Feed health for the current service date; never throws. */
    async function updateHealth(): Promise<void> {
      try {
        const deps = await depsPromise;
        const h = await loadHealth(deps, current?.meta);
        const states = Object.values(h).map((f) => `${f.feed} ${f.state} to ${f.validUntil}`);
        const note = healthNote(h);
        log(`health: ${states.join(", ") || "no feeds yet"}${note ? ` · note: ${note}` : ""}`);
        if (!cancelled) setHealth(h);
      } catch (err) {
        console.warn("[transit-network] health failed", err);
      }
    }

    async function refresh(): Promise<void> {
      // One refresh at a time; a request during one runs once it's done.
      if (running) {
        again = true;
        return;
      }
      running = true;
      if (current) setStatus("refreshing");
      const startedAt = Date.now();
      let stopFrameGaps = () => 0;
      try {
        const deps = await depsPromise;
        log("refresh start");
        // From here: the wait for the database belongs to app start-up.
        stopFrameGaps = watchFrameGaps();
        const result = await refreshTransitNetwork(deps);
        // Keep the network object when today's blob wasn't rebuilt: a new one
        // re-renders every consumer and drops their per-network caches.
        const today = serviceDatesFor(deps.now())[0];
        const net =
          current && loadedDate === today && !result.rebuilt.includes(today) ? current : await load();
        await updateHealth();
        const next: TransitNetworkStatus = net ? (result.offline ? "offline" : "ready") : "error";
        log(
          `refresh done in ${Date.now() - startedAt} ms: rebuilt [${result.rebuilt.join(", ")}]` +
            (result.failedFeeds.length > 0 ? `, failed feeds [${result.failedFeeds.join(", ")}]` : "") +
            (result.failedDates.length > 0 ? `, failed builds [${result.failedDates.join(", ")}]` : "") +
            ` → ${next}${net ? ` (${net.meta.serviceDate}, ${net.stops.count} stops)` : ""}` +
            (__DEV__ ? `, longest frame gap ${Math.round(stopFrameGaps())} ms` : ""),
        );
        if (!cancelled) setStatus(next);
      } catch (err) {
        console.warn("[transit-network] refresh failed", err);
        if (!cancelled) setStatus(current ? "offline" : "error");
      } finally {
        stopFrameGaps();
        running = false;
        if (again && !cancelled) {
          again = false;
          void refresh();
        }
      }
    }

    function scheduleRefresh(): void {
      cancelIdle?.();
      cancelIdle = whenIdle(() => {
        cancelIdle = null;
        void refresh();
      });
    }

    void (async () => {
      try {
        const net = await load();
        if (net && !cancelled) setStatus("ready");
        log(net ? `loaded ${net.meta.serviceDate} (built ${new Date(net.meta.builtAt).toISOString()})` : "no stored network for today");
      } catch (err) {
        console.warn("[transit-network] load failed", err);
      }
      await updateHealth();
      if (!cancelled) scheduleRefresh();
    })();

    // Back in the foreground: feed health is recomputed for the new date, so
    // an expiry shows without a download. On a new service day (04:00 MYT)
    // since the last load, switch to its blob at once, then refresh feeds and
    // build the next "tomorrow".
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active" || loadedDate === null) return;
      const today = serviceDatesFor(Date.now())[0];
      if (today === loadedDate) {
        void updateHealth();
        return;
      }
      log(`new service day ${today} (was ${loadedDate})`);
      void load()
        .then((net) => {
          if (!cancelled && !running) setStatus(net ? "ready" : "loading");
        })
        .catch((err) => console.warn("[transit-network] load failed", err))
        .then(updateHealth);
      scheduleRefresh();
    });

    return () => {
      cancelled = true;
      cancelIdle?.();
      sub.remove();
    };
  }, []);

  const value = useMemo<TransitNetworkState>(
    () => ({ network, health, status, note: health ? healthNote(health) : null }),
    [network, health, status],
  );

  return createElement(TransitNetworkContext.Provider, { value }, children);
}

export function useTransitNetwork(): TransitNetworkState {
  const ctx = useContext(TransitNetworkContext);
  if (!ctx) {
    throw new Error("useTransitNetwork must be used within <TransitNetworkProvider>");
  }
  return ctx;
}
