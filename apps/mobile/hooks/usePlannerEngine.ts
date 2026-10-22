import {
  plan,
  plannerRealtimeRoutes,
  retime,
  runSteps,
  WALKING_METERS_PER_MINUTE,
  type FeedId,
  type Itinerary,
  type Place,
  type PlanQuery,
  type RetimeContext,
  type TransitNetwork,
} from '@bus-tracker/shared';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { openDb } from '@/db/database';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { quickFix } from '@/services/planner/quickFix';
import { runPlan, type PlanRun } from '@/services/planner/runPlan';
import { holdWorkspace } from '@/services/planner/workspace';
import {
  departAtOf,
  isLiveSkipped,
  isStale,
  LOADER_DELAY_MS,
  networkFor,
  queryKey,
  replanDue,
  UPDATED_FLASH_MS,
  updatedIds as findUpdatedIds,
  type When,
} from '@/services/planner/session';
import { realtimeStore, type RealtimeSnapshot, type RealtimeStore } from '@/services/realtime';
import { mockRealtimeStore } from '@/services/realtime-mock';
import { loadStoredNetwork } from '@/services/transitNetwork';
import { devNow } from '@/utils/devClock';

/** What the results list shows (15/04); read it as `usePlanner().run`. */
export interface PlannerRun {
  status: 'idle' | 'locating' | 'planning' | 'done' | 'no-network' | 'no-location' | 'error';
  /** At most five, ranked, already re-timed with the latest live positions. */
  itineraries: Itinerary[];
  /** +1 when a new query's first results land: the rows' stagger key. Never on a retime. */
  generation: number;
  /** Rows re-timed by a minute or more on the last retime; each leaves the set after 4 s. */
  updatedIds: ReadonlySet<string>;
  /** `PlanResult.excludedFeeds` as is: the feed notes, even with no itineraries. */
  excludedFeeds: FeedId[];
  /** A first-bus category isn't polled (no spare budget): rows stay "Scheduled". */
  liveSkipped: boolean;
  /** `plan()` has run for more than 150 ms. */
  showLoader: boolean;
  /** Query start (including the location fix) to first results, ms. */
  firstResultMs: number | null;
  /** The network the itineraries were planned on (today's, or tomorrow's for a later "Depart at…"). */
  network: TransitNetwork | null;
  /** The query behind `itineraries` (`from` resolved to coordinates for My location). */
  query: PlanQuery | null;
  /** `queryKey` of the query behind `itineraries`, so a screen can tell results from a stale query's. */
  key: string | null;
}

const IDLE: PlannerRun = {
  status: 'idle',
  itineraries: [],
  generation: 0,
  updatedIds: new Set(),
  excludedFeeds: [],
  liveSkipped: false,
  showLoader: false,
  firstResultMs: null,
  network: null,
  query: null,
  key: null,
};

const USE_MOCK =
  process.env.EXPO_PUBLIC_MOCK_REALTIME === '1' || process.env.EXPO_PUBLIC_MOCK_REALTIME === 'true';
/** The store the planner (and Go, 15/06) polls and re-times from: the mock when asked for. */
export const plannerStore: RealtimeStore = USE_MOCK ? mockRealtimeStore : realtimeStore;
const store = plannerStore;

/** How often a presented "Leave now" checks whether its first row has left (`replanDue`). */
const REPLAN_CHECK_MS = 10_000;

/**
 * "My location" as the start: a last-known fix under a minute old, else a
 * fresh one within 4 s, else one under 10 min old, else the fresh one when it
 * comes (`quickFix`). If that fails, the run ends `no-location` and the fix
 * watcher plans again on a fix.
 */
async function resolveHere(): Promise<Place | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const fix = await quickFix({
      lastKnown: (maxAge) => Location.getLastKnownPositionAsync({ maxAge }),
      current: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    });
    if (!fix) return null;
    return { kind: 'here', name: 'My location', lat: fix.coords.latitude, lng: fix.coords.longitude };
  } catch {
    return null;
  }
}

/** Mutable engine state: one writer (this hook), never rendered directly. */
interface Engine {
  /** Bumped by every new run; a stale async step compares and bails. */
  token: number;
  key: string | null;
  /** Service date of the in-memory network the last run saw. */
  seenDate: string | null;
  status: PlannerRun['status'];
  plannedAt: number | null;
  /** The sliced `plan()` in flight. Never retime while it is set (shared RAPTOR workspace). */
  inflight: PlanRun<unknown> | null;
  loaderTimer: ReturnType<typeof setTimeout> | null;
  /** `plan()`'s own output: `retime` always starts from it, never from a retimed list. */
  base: Itinerary[] | null;
  baseNet: TransitNetwork | null;
  ctx: RetimeContext | null;
  /** What the rows show now, to find the ones a retime moved. */
  shown: Itinerary[];
  flashTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Tomorrow's network, loaded once for a later "Depart at…". */
  other: TransitNetwork | null;
  /** Set by the "Leave now" clock check: the next plan effect runs even for the same key. */
  replanDue: boolean;
}

/**
 * The journey planner's engine (15/04): turns the planner query into up to
 * five itineraries and keeps them re-timed with live bus positions. Called
 * once, inside `PlannerProvider`; screens read `usePlanner().run`.
 *
 * - Runs only while a planner sheet is presented with a destination. A new
 *   `from|to|when` key cancels the run in flight; the same key keeps the
 *   results (a "Leave now" older than 2 min is planned again, and so is one
 *   whose first row left over 30 s ago while the sheet is up).
 * - `plan()` is stepped in ~8 ms slices; a 150 ms timer shows the loader.
 * - After a plan, its first-bus routes go to the realtime store
 *   (`setExtraRoutes('planner', …)`); each new poll re-times the plan's own
 *   output with `{ byCategory }`. A retime never runs while a plan is in
 *   flight: they share the network's RAPTOR workspace.
 * - On dismiss the planner's routes are dropped; the results stay.
 */
export function usePlannerEngine(input: { presented: boolean; from: Place; to: Place | null; when: When }): PlannerRun {
  const { presented, from, to, when } = input;
  const { network } = useTransitNetwork();
  const [run, setRun] = useState<PlannerRun>(IDLE);
  const engine = useRef<Engine>({
    token: 0,
    key: null,
    seenDate: null,
    status: 'idle',
    plannedAt: null,
    inflight: null,
    loaderTimer: null,
    base: null,
    baseNet: null,
    ctx: null,
    shown: [],
    flashTimers: new Map(),
    other: null,
    replanDue: false,
  });

  // No fix when the plan ran: plan again as soon as one arrives (a cold GPS start).
  const [fixes, setFixes] = useState(0);
  const waitingForFix = presented && run.status === 'no-location' && from.kind === 'here';
  useEffect(() => {
    if (!waitingForFix) return;
    let live = true;
    let sub: Location.LocationSubscription | null = null;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || !live) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced }, () => setFixes((n) => n + 1));
      if (!live) sub.remove();
    })().catch(() => {});
    return () => {
      live = false;
      sub?.remove();
    };
  }, [waitingForFix]);

  const key = to ? queryKey(from, to, when) : null;
  // The effect reads these through a ref so a new `from` object with the same key doesn't re-run it.
  const latest = useRef({ from, to, when, network });
  latest.current = { from, to, when, network };

  // "Leave now" with the sheet up: once the first row has left, plan again
  // (at most once a minute). Checked on this clock, never from a retime.
  const [replans, setReplans] = useState(0);
  const watchLeaving = presented && when.kind === 'now' && run.status === 'done' && run.itineraries.length > 0;
  useEffect(() => {
    if (!watchLeaving) return;
    const id = setInterval(() => {
      const e = engine.current;
      if (e.inflight || e.status !== 'done') return;
      if (!replanDue(latest.current.when, e.shown, e.plannedAt, devNow())) return;
      e.replanDue = true;
      setReplans((n) => n + 1);
    }, REPLAN_CHECK_MS);
    return () => clearInterval(id);
  }, [watchLeaving]);

  // Plan.
  useEffect(() => {
    const e = engine.current;
    if (!presented || key == null) return;
    const net = latest.current.network;
    const date = net?.meta.serviceDate ?? null;
    const same =
      e.key === key &&
      e.status === 'done' &&
      // A refresh that swaps in a new object for the same day keeps the results.
      e.seenDate === date &&
      !e.replanDue &&
      !isStale(latest.current.when, e.plannedAt, devNow());
    if (same) {
      registerRoutes(e);
      return;
    }
    e.replanDue = false;

    cancel(e);
    const token = ++e.token;
    e.key = key;
    e.seenDate = date;
    const { from: start, to: end, when: at } = latest.current;
    if (!end) return;
    const startedAt = performance.now();
    const set = (patch: Partial<PlannerRun>) => {
      if (token !== e.token) return;
      if (patch.status) e.status = patch.status;
      setRun((r) => ({ ...r, ...patch }));
    };
    const finish = (status: PlannerRun['status']) => {
      clearLoader(e);
      set({ status, itineraries: [], updatedIds: new Set(), showLoader: false, liveSkipped: false, key });
    };

    set({ status: start.kind === 'here' ? 'locating' : 'planning', itineraries: [], updatedIds: new Set(), showLoader: false });
    e.base = null;
    e.shown = [];
    e.loaderTimer = setTimeout(() => {
      e.loaderTimer = null;
      if (token === e.token && (e.status === 'planning' || e.status === 'locating')) set({ showLoader: true });
    }, LOADER_DELAY_MS);

    void (async () => {
      const fromPlace = start.kind === 'here' ? await resolveHere() : start;
      if (token !== e.token) return;
      if (!fromPlace) return finish('no-location');

      const departAt = departAtOf(at, devNow());
      const which = networkFor(departAt, date, devNow());
      let planNet: TransitNetwork | null = null;
      if (which === 'loaded') planNet = net;
      else if (which) planNet = await otherNetwork(e, which.date);
      if (token !== e.token) return;
      if (!planNet) return finish('no-network');
      set({ status: 'planning' });

      const q: PlanQuery = { from: fromPlace, to: end, departAt, walkMetersPerMin: WALKING_METERS_PER_MINUTE };
      const handle = runPlan(plan(planNet, q));
      e.inflight = handle;
      // Go's retimes on this network wait until the plan is done (shared workspace).
      const release = holdWorkspace(planNet);
      let result: Awaited<typeof handle.promise>;
      try {
        result = await handle.promise;
      } finally {
        release();
      }
      if (e.inflight === handle) e.inflight = null;
      if (!result || token !== e.token) return;

      clearLoader(e);
      e.base = result.itineraries;
      e.baseNet = planNet;
      e.ctx = { to: end, walkMetersPerMin: WALKING_METERS_PER_MINUTE, modes: q.modes };
      e.plannedAt = devNow();
      // The plan has finished, so retiming on its network is safe now.
      const snap = store.getSnapshot();
      const its = retimed(e, snap);
      e.shown = its;
      const firstResultMs = Math.round(performance.now() - startedAt);
      if (__DEV__) console.log(`[planner] ${its.length} itineraries in ${firstResultMs} ms (${key})`);
      e.status = 'done';
      setRun((r) => ({
        status: 'done',
        itineraries: its,
        generation: r.generation + 1,
        updatedIds: new Set(),
        excludedFeeds: result.excludedFeeds,
        liveSkipped: liveSkipped(e, snap),
        showLoader: false,
        firstResultMs,
        network: planNet,
        query: q,
        key,
      }));
      registerRoutes(e);
    })().catch((err: unknown) => {
      if (token !== e.token) return;
      e.inflight = null;
      console.warn('[planner] plan failed', err);
      finish('error');
    });
  }, [presented, key, network, fixes, replans]);

  // Live re-timing while a planner sheet is up.
  useEffect(() => {
    const e = engine.current;
    if (!presented) return;
    store.start();
    registerRoutes(e);
    let last: RealtimeSnapshot | null = null;
    const onChange = () => {
      const snap = store.getSnapshot();
      if (last && snap.lastUpdated === last.lastUpdated && snap.plannerSkipped === last.plannerSkipped) return;
      last = snap;
      // A plan in flight owns the workspace; its own finish retimes with the latest snapshot.
      if (!e.base || e.inflight) return;
      const next = retimed(e, snap);
      const moved = findUpdatedIds(e.shown, next);
      e.shown = next;
      for (const id of moved) {
        const t = e.flashTimers.get(id);
        if (t) clearTimeout(t);
        e.flashTimers.set(
          id,
          setTimeout(() => {
            e.flashTimers.delete(id);
            setRun((r) => {
              if (!r.updatedIds.has(id)) return r;
              const ids = new Set(r.updatedIds);
              ids.delete(id);
              return { ...r, updatedIds: ids };
            });
          }, UPDATED_FLASH_MS),
        );
      }
      setRun((r) => ({
        ...r,
        itineraries: next,
        updatedIds: moved.length > 0 ? new Set([...r.updatedIds, ...moved]) : r.updatedIds,
        liveSkipped: liveSkipped(e, snap),
      }));
      // The live horizon moves with the clock: keep the polled routes current.
      registerRoutes(e);
    };
    const unsubscribe = store.subscribe(onChange);
    return () => {
      unsubscribe();
      store.setExtraRoutes('planner', []);
      store.stop();
    };
  }, [presented]);

  // Unmount: nothing left running.
  useEffect(() => {
    const e = engine.current;
    return () => {
      cancel(e);
      e.token++;
      for (const t of e.flashTimers.values()) clearTimeout(t);
      e.flashTimers.clear();
    };
  }, []);

  return run;
}

function clearLoader(e: Engine): void {
  if (e.loaderTimer) clearTimeout(e.loaderTimer);
  e.loaderTimer = null;
}

/** Cancels the run in flight: its token goes stale, the loader timer stops, the generator closes. */
function cancel(e: Engine): void {
  clearLoader(e);
  e.inflight?.cancel();
  e.inflight = null;
}

function retimed(e: Engine, snap: RealtimeSnapshot): Itinerary[] {
  if (!e.base || !e.baseNet || !e.ctx) return [];
  if (Object.keys(snap.byCategory).length === 0) return e.base;
  return retime(e.base, { byCategory: snap.byCategory }, e.baseNet, e.ctx);
}

function liveSkipped(e: Engine, snap: RealtimeSnapshot): boolean {
  if (!e.base || !e.baseNet || snap.plannerSkipped.length === 0) return false;
  return isLiveSkipped(plannerRealtimeRoutes(e.base, e.baseNet, devNow()), snap.plannerSkipped);
}

/** First-bus routes boarding within the hour go to the poller; it admits them from spare budget. */
function registerRoutes(e: Engine): void {
  if (!e.base || !e.baseNet) return;
  store.setExtraRoutes('planner', plannerRealtimeRoutes(e.base, e.baseNet, devNow()));
}

/** Another service day's stored network (tomorrow's), decoded in slices and kept for reuse. */
async function otherNetwork(e: Engine, date: string): Promise<TransitNetwork | null> {
  if (e.other?.meta.serviceDate === date) return e.other;
  try {
    const db = await openDb();
    const net = await loadStoredNetwork({ db, runSteps }, date);
    if (net) e.other = net;
    return net;
  } catch (err) {
    console.warn('[planner] could not load the network for', date, err);
    return null;
  }
}
