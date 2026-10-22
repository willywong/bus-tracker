import {
  computeNextPollDelay,
  createOutlierFilter,
  decodeFeed,
  dropImplausibleFixes,
  parseRetryAfterMs,
  vehiclePositionsUrl,
  type BusCategory,
  type PlannerFeedRoutes,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import { getRealtimeRoutes, getTripToRouteMap } from "@/db/queries";
import {
  buildRealtimePlan,
  FOLLOWED_INTERVAL_MS,
  mergeExtraRoutes,
  positionsFromFeed,
  routeFeedHealth,
  tripMapRouteCodes,
  type FeedHealth,
  type RealtimePlan,
  type RouteFeedHealth,
} from "@/services/realtimePlan";

// Polls data.gov.my's GTFS Realtime vehicle-position feeds directly — only
// the categories of the routes the user follows (feeder, Rapid KL, Penang),
// in parallel. One poll per 30 s matches the feeds' update cadence; 429 /
// Retry-After responses back off via computeNextPollDelay.
const POLL_INTERVAL_MS = 30_000;

export interface RealtimeSnapshot {
  /** Vehicles on **followed** routes only; planner-only buses never show as "my buses". */
  positions: VehiclePosition[];
  lastUpdated: number | null;
  lastError: Error | null;
  /** Epoch ms when the next scheduled tick will fire. Null when polling is stopped. */
  nextRefreshAt: number | null;
  /** True while a fetch is in flight. */
  isRefreshing: boolean;
  /**
   * Plausible vehicles in the whole feed (every route), from the last
   * successful poll. 0 during service hours means data.gov.my's live feed is
   * down, not that your route has no buses. Null until the first poll.
   */
  feedVehicleCount: number | null;
  /**
   * Feed health per followed route key. Prefer this over `feedVehicleCount`
   * and `lastError` when looking at one route: they span every polled
   * network, so a Rapid KL feed with buses can hide a feeder outage.
   */
  feedHealthByRoute?: Readonly<Record<string, RouteFeedHealth>>;
  /**
   * Every polled category's plausible vehicles on every route it is polled
   * for (followed and planner), with the time of its last good fetch. This
   * is the journey engine's `LiveSnapshot.byCategory` (spec §4.4).
   */
  byCategory: Record<string, { asOf: number; positions: VehiclePosition[] }>;
  /** Planner categories not polled for lack of budget: their itineraries stay "Scheduled". */
  plannerSkipped: BusCategory[];
}

export type PositionFilter = (incoming: VehiclePosition[]) => VehiclePosition[];

/** Who asked for extra routes: the planner's sheets (15/04), Go (15/06), or Nearby's route preview (17/05). */
export type ExtraRoutesSource = "planner" | "go" | "preview";

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
   * feed plan so the next tick rebuilds it against the new set. Empty array
   * stops polling entirely.
   */
  setRouteCodes(codes: readonly string[]): void;
  /**
   * Routes the journey planner wants live positions for
   * (`plannerRealtimeRoutes`). They ride along in followed categories; other
   * categories are polled every 60 s only from spare budget, else reported in
   * `plannerSkipped`. Clears the cached feed plan. Polling runs while there
   * are followed routes or extras. Each `source` owns its own list (the
   * planner's sheet, Go following a journey, and a previewed route), so one
   * clearing its routes never drops the others'; they are merged per category.
   */
  setExtraRoutes(source: ExtraRoutesSource, extra: readonly PlannerFeedRoutes[]): void;
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
  fetchFeed: (category: BusCategory, signal: AbortSignal) => Promise<Uint8Array>;
  loadPlan: (routeCodes: readonly string[], extra: readonly PlannerFeedRoutes[]) => Promise<RealtimePlan>;
  appState: AppStateLike;
  now: () => number;
  pollIntervalMs: number;
  /** scheduler — lets tests swap in a manual clock */
  scheduleTick: (cb: () => void, ms: number) => () => void;
}

const defaultDeps: RealtimeDeps = {
  fetchFeed: async (category, signal) => {
    const res = await fetch(vehiclePositionsUrl(category), { signal });
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(
        res.headers.get("Retry-After"),
        Date.now(),
      );
      throw new FeedFetchError(res.status, retryAfterMs);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
  loadPlan: async (routeCodes, extra) => {
    if (routeCodes.length === 0) return buildRealtimePlan([], [], new Map(), extra);
    const db = await openDb();
    const stored = await getRealtimeRoutes(db, routeCodes);
    // Headway networks' vehicles resolve by route_id; skip their trip ids.
    const tripMap = await getTripToRouteMap(db, tripMapRouteCodes(stored));
    return buildRealtimePlan(routeCodes, stored, tripMap, extra);
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

function sameExtraRoutes(
  a: readonly PlannerFeedRoutes[],
  b: readonly PlannerFeedRoutes[],
): boolean {
  const key = (x: readonly PlannerFeedRoutes[]) =>
    x.map((f) => `${f.category}:${[...f.routes].sort().join(",")}`).sort();
  return sameRouteCodes(key(a), key(b));
}

const EMPTY_SNAPSHOT: RealtimeSnapshot = {
  positions: [],
  lastUpdated: null,
  lastError: null,
  nextRefreshAt: null,
  isRefreshing: false,
  feedVehicleCount: null,
  byCategory: {},
  plannerSkipped: [],
};

export function createRealtimeStore(
  deps: Partial<RealtimeDeps> = {},
): RealtimeStore {
  const cfg: RealtimeDeps = { ...defaultDeps, ...deps };

  let snapshot: RealtimeSnapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<Listener>();
  let refCount = 0;

  let routeCodes: readonly string[] = [];
  let extraRoutes: readonly PlannerFeedRoutes[] = [];
  /** Each source's own extras; `extraRoutes` is their merge. */
  const extraBySource = new Map<ExtraRoutesSource, readonly PlannerFeedRoutes[]>();
  /** Followed routes or planner extras: something to poll for. */
  const wanted = () => routeCodes.length > 0 || extraRoutes.length > 0;
  /** Cached once every followed route is in SQLite; rebuilt each poll until then. */
  let plan: RealtimePlan | null = null;
  /** Last good positions per feed, so one feed failing doesn't blank the others' buses. */
  const lastByCategory = new Map<BusCategory, VehiclePosition[]>();
  /** When each feed was last fetched (attempted), so a 60 s planner feed is skipped on the ticks in between. */
  const lastFetchAt = new Map<BusCategory, number>();
  /** When each feed last answered: `byCategory[c].asOf`. */
  const lastOkAt = new Map<BusCategory, number>();
  const healthByCategory = new Map<BusCategory, FeedHealth>();
  /** A 429 / Retry-After from one feed while others succeeded; slows the next poll. */
  let partialThrottle: FeedFetchError | null = null;
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
      feedVehicleCount:
        patch.feedVehicleCount !== undefined
          ? patch.feedVehicleCount
          : snapshot.feedVehicleCount,
      feedHealthByRoute: patch.feedHealthByRoute ?? snapshot.feedHealthByRoute,
      byCategory: patch.byCategory ?? snapshot.byCategory,
      plannerSkipped: patch.plannerSkipped ?? snapshot.plannerSkipped,
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
    if (!wanted()) return;
    if (cfg.appState.currentState !== "active") return;

    cancelInflight();
    const ctrl = new AbortController();
    inflight = ctrl;
    setRefreshing(true);

    const codesForTick = routeCodes;
    const extrasForTick = extraRoutes;
    let current: RealtimePlan | null = plan;
    try {
      current ??= await cfg.loadPlan(codesForTick, extrasForTick);
      // Only cache a plan built for the codes still being watched: a tick
      // aborted by setRouteCodes/stop can resume after the newer one.
      if (ctrl.signal.aborted || codesForTick !== routeCodes || extrasForTick !== extraRoutes) return;
      if (current.complete) plan = current;
      const feedsForTick = current.feeds;
      // A planner-only feed (60 s) is fetched every other tick; a followed
      // feed every tick, so pull-to-refresh and resume stay immediate.
      const startedAt = cfg.now();
      const dueFeeds = feedsForTick.filter(
        (f) =>
          f.intervalMs <= cfg.pollIntervalMs ||
          startedAt - (lastFetchAt.get(f.category) ?? -Infinity) >= f.intervalMs - 1_000,
      );
      for (const f of dueFeeds) lastFetchAt.set(f.category, startedAt);
      const results = await Promise.allSettled(
        dueFeeds.map(async (f) => ({
          plan: f,
          feed: decodeFeed(await cfg.fetchFeed(f.category, ctrl.signal)),
        })),
      );
      if (ctrl.signal.aborted) return;
      const now = cfg.now();
      const followedFeeds = feedsForTick.filter((f) => f.intervalMs === FOLLOWED_INTERVAL_MS);
      let feedVehicleCount: number | null = followedFeeds.length > 0 ? 0 : null;
      let firstError: unknown = null;
      partialThrottle = null;
      for (const [i, r] of results.entries()) {
        const category = dueFeeds[i].category;
        const followedFeed = dueFeeds[i].intervalMs === FOLLOWED_INTERVAL_MS;
        if (r.status === "fulfilled") {
          // Vehicles resolve by static trip_id first, then by the feed's
          // `trip.route_id` — date-prefix drift between the static bundle
          // and the realtime feed, and Rapid KL's headway templates, both
          // miss the trip lookup.
          lastByCategory.set(category, positionsFromFeed(r.value.plan, r.value.feed, now));
          lastOkAt.set(category, now);
          const count = countPlausibleVehicles(r.value.feed, now);
          healthByCategory.set(category, { vehicleCount: count, error: null });
          if (followedFeed) feedVehicleCount = (feedVehicleCount ?? 0) + count;
        } else {
          if (isAbortError(r.reason)) return;
          firstError ??= r.reason;
          healthByCategory.set(category, { vehicleCount: null, error: asError(r.reason) });
          if (r.reason instanceof FeedFetchError && (r.reason.status === 429 || r.reason.retryAfterMs != null)) {
            partialThrottle ??= r.reason;
          }
        }
      }
      if (firstError && results.every((r) => r.status === "rejected")) throw firstError;
      if (firstError) {
        console.warn("[realtime] a feed failed; keeping its last positions:", (firstError as Error)?.message ?? firstError);
      }
      const feedHealthByRoute = routeFeedHealth(codesForTick, current, healthByCategory);
      const byCategory: RealtimeSnapshot["byCategory"] = {};
      for (const f of feedsForTick) {
        const positions = lastByCategory.get(f.category);
        const asOf = lastOkAt.get(f.category);
        if (positions && asOf !== undefined) {
          byCategory[f.category] = { asOf, positions: dropImplausibleFixes(positions, now) };
        }
      }
      // Map markers and ETAs: followed routes only.
      const followed = new Set(codesForTick);
      const raw = dropImplausibleFixes(
        feedsForTick.flatMap((f) => lastByCategory.get(f.category) ?? []),
        now,
      ).filter((p) => followed.has(p.routeId));
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
          `[realtime] ${deduped.length} positions (filtered=${filtered.length}, raw=${raw.length}, feeds=${feedsForTick.map((f) => f.category).join("+") || "none"})`,
        );
        if (deduped.length !== filtered.length) {
          console.warn(
            '[realtime] dropped',
            filtered.length - deduped.length,
            'duplicate vehicleId entries',
          );
        }
      }
      commit(
        {
          positions: deduped,
          lastError: null,
          feedVehicleCount,
          feedHealthByRoute,
          byCategory,
          plannerSkipped: current.plannerSkipped,
        },
        true,
      );
      consecutiveFailures = 0;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (isAbortError(err)) return;
      const e = asError(err);
      consecutiveFailures += 1;
      console.warn("[realtime] tick failed:", e.message);
      const feedHealthByRoute = current
        ? routeFeedHealth(codesForTick, current, healthByCategory)
        : undefined;
      commit({ lastError: e, feedHealthByRoute }, false);
    } finally {
      if (inflight === ctrl) inflight = null;
      setRefreshing(false);
      if (
        refCount > 0 &&
        wanted() &&
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
    const lastErr = snapshot.lastError ?? partialThrottle;
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
    if (!wanted()) return;
    if (cfg.appState.currentState === "active") {
      void tick();
    }
  }

  function stopPolling() {
    clearTimer();
    cancelInflight();
    plan = null;
    lastByCategory.clear();
    lastFetchAt.clear();
    lastOkAt.clear();
    healthByCategory.clear();
    partialThrottle = null;
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
      plan = null;
      lastByCategory.clear();
      lastFetchAt.clear();
      lastOkAt.clear();
      healthByCategory.clear();
      partialThrottle = null;
      if (!wanted()) {
        clearTimer();
        cancelInflight();
        setRefreshing(false);
        setNextRefreshAt(null);
        commit({ positions: [], byCategory: {}, plannerSkipped: [] }, false);
        return;
      }
      if (refCount > 0 && cfg.appState.currentState === "active") {
        void tick();
      }
    },
    setExtraRoutes(source, list) {
      extraBySource.set(source, [...list]);
      const next = mergeExtraRoutes([...extraBySource.values()]);
      if (sameExtraRoutes(extraRoutes, next)) return;
      const wasPolling = wanted();
      extraRoutes = next;
      plan = null;
      if (!wanted()) {
        clearTimer();
        cancelInflight();
        setRefreshing(false);
        setNextRefreshAt(null);
        commit({ positions: [], byCategory: {}, plannerSkipped: [] }, false);
        return;
      }
      // Already polling: the next scheduled tick picks the new plan up, so
      // the planner never adds requests outside the poll cadence.
      if (!wasPolling && refCount > 0 && cfg.appState.currentState === "active") {
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
        extraRoutes = [];
        extraBySource.clear();
        listeners.clear();
        consecutiveFailures = 0;
        snapshot = EMPTY_SNAPSHOT;
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

/** Vehicles with a position and a believable timestamp, across all routes. */
function countPlausibleVehicles(
  feed: ReturnType<typeof decodeFeed>,
  now: number,
): number {
  let n = 0;
  for (const e of feed.entity) {
    const v = e.vehicle;
    if (!v?.position || e.is_deleted) continue;
    const ts = typeof v.timestamp === "number" && v.timestamp > 0 ? v.timestamp * 1000 : now;
    if (dropImplausibleFixes([{ observedAt: ts }], now).length === 1) n++;
  }
  return n;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
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
