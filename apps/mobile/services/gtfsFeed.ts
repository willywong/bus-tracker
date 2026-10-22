import {
  BUS_CATEGORIES,
  BUS_CATEGORY_INFO,
  FEED_INFO,
  TRAFFIC_SIGNALS,
  buildRouteSearchIndexFromZip,
  categoriesForKey,
  computeNextPollDelay,
  deserializeRouteSearchIndex,
  filterToRoutes,
  matchesCode,
  namespaceParsedGtfs,
  parseGtfsZipSteps,
  parseRetryAfterMs,
  runSteps,
  searchRouteIndexes,
  serializeRouteSearchIndex,
  vehiclePositionsUrl,
  type BusCategory,
  type FeedId,
  type RouteSearchHit,
  type RouteSearchIndex,
  type SerializedRouteSearchIndex,
  type T816Bundle,
} from "@bus-tracker/shared";
import { devStage } from "./devStages";

/**
 * data.gov.my GTFS feeds, fetched straight from the device — no BusBuddy
 * server in between. One static zip and one vehicle-position feed per
 * Prasarana bus category (see `BUS_CATEGORY_INFO`).
 * https://developer.data.gov.my/realtime-api
 */
export const GTFS_STATIC_URL = BUS_CATEGORY_INFO["rapid-bus-mrtfeeder"].staticUrls[0];
export { vehiclePositionsUrl };

/** Prasarana publishes static GTFS "as required"; refresh a few times a day. */
const STATIC_TTL_MS = 12 * 60 * 60 * 1000;
/** Raw zips are dropped after this long unused (adding routes in a row reuses them). */
const ZIP_IDLE_MS = 2 * 60 * 1000;
const RESULT_LIMIT = 25;

export class RouteNotFoundError extends Error {
  constructor(code: string) {
    super(`route ${code} not found`);
    this.name = "RouteNotFoundError";
  }
}

interface Cached<T> {
  fetchedAt: number;
  value: T;
}

/**
 * Where search indexes persist between launches (SQLite in the app; none in
 * tests). With one saved, search answers from it at once and refreshes it in
 * the background once it's older than {@link STATIC_TTL_MS}.
 */
export interface SearchIndexStore {
  load(category: BusCategory): Promise<{ fetchedAt: number; data: unknown } | null>;
  save(category: BusCategory, fetchedAt: number, data: SerializedRouteSearchIndex): Promise<void>;
}

let indexStore: SearchIndexStore | null = null;
export function setSearchIndexStore(store: SearchIndexStore | null): void {
  indexStore = store;
}

// Memory: raw zips (1.7–3.5 MB each) only while in use, and the small
// search indexes (well under 1 MB each). A whole feed is never parsed: the
// index streams stop_times, and a route bundle keeps only that route's rows.
const zips = new Map<BusCategory, Cached<Uint8Array>>();
const zipInflight = new Map<BusCategory, Promise<Uint8Array>>();
const indexes = new Map<BusCategory, Cached<RouteSearchIndex>>();
const indexInflight = new Map<BusCategory, Promise<RouteSearchIndex>>();
const refreshing = new Set<BusCategory>();
let zipIdleTimer: ReturnType<typeof setTimeout> | null = null;

/** (Re)starts the countdown that frees the raw zips once idle. */
function touchZips(): void {
  if (zipIdleTimer) clearTimeout(zipIdleTimer);
  zipIdleTimer = setTimeout(() => {
    zips.clear();
    zipIdleTimer = null;
  }, ZIP_IDLE_MS);
  // Node (tests) would otherwise wait for the timer before exiting.
  (zipIdleTimer as { unref?: () => void }).unref?.();
}

/**
 * data.gov.my allows 4 requests a minute for the static GTFS family. The app
 * uses at most 3 in any rolling minute and keeps the 4th as a spare for one
 * retry after a 429 (spec §3.6).
 */
export const STATIC_MAX_REQUESTS = 3;
export const STATIC_WINDOW_MS = 60_000;
/** Static zips on this host take a limiter slot; mirrors elsewhere (S3) don't. */
const STATIC_API = "https://api.data.gov.my/";

export interface StaticLimiter {
  /** Resolves once a request may go out, and records it. FIFO across callers. */
  acquire(opts?: { spare?: boolean; signal?: AbortSignal }): Promise<void>;
}

/**
 * Where the limiter records its grants so that they outlive the JS runtime:
 * a relaunch within the minute, or a second runtime in the same app process
 * (a dev reload can leave the old one running), still counts them.
 */
export interface StaticRequestLog {
  /**
   * Records a request at `at` if fewer than `limit` are recorded in
   * `(at - windowMs, at]`, as one atomic step; whether it was recorded.
   */
  claim(at: number, windowMs: number, limit: number): Promise<boolean>;
  /** Recorded request times in `(since, until]`, oldest first. */
  between(since: number, until: number): Promise<number[]>;
}

let requestLog: StaticRequestLog | null = null;
/** Installs the persistent grant record (SQLite in the app; none in tests). */
export function setStaticRequestLog(log: StaticRequestLog | null): void {
  requestLog = log;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A rolling-window limiter: at most `max` grants in any `windowMs` (`max + 1`
 * for a `spare` acquire). Callers queue on one promise chain, so a later
 * caller can't jump an earlier one; an aborted caller rejects without taking
 * a slot.
 */
export function createStaticLimiter(
  deps: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    max?: number;
    windowMs?: number;
    /** The persistent grant record, looked up per request. */
    log?: () => StaticRequestLog | null;
  } = {},
): StaticLimiter {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const max = deps.max ?? STATIC_MAX_REQUESTS;
  const windowMs = deps.windowMs ?? STATIC_WINDOW_MS;
  const getLog = deps.log ?? (() => null);
  const granted: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  /** How long until `times` (oldest first) leave room for one more under `limit`. */
  const waitFor = (times: readonly number[], limit: number, t: number) =>
    times.length < limit ? 0 : times[times.length - limit] + windowMs - t;

  async function waitForSlot(spare: boolean, signal: AbortSignal | undefined): Promise<void> {
    const limit = spare ? max + 1 : max;
    for (;;) {
      if (signal?.aborted) throw abortError();
      const t = now();
      while (granted.length > 0 && t - granted[0] >= windowMs) granted.shift();
      let wait = waitFor(granted, limit, t);
      const log = wait > 0 ? null : getLog();
      if (log) {
        try {
          if (!(await log.claim(t, windowMs, limit))) {
            wait = Math.max(1, waitFor(await log.between(t - windowMs, t), limit, t));
          }
        } catch (err) {
          // An unreadable record mustn't stop downloads: this runtime's own
          // grants still hold the line.
          console.warn(`[gtfs] static request log failed: ${(err as Error)?.message ?? err}`);
        }
      }
      if (wait <= 0) {
        granted.push(t);
        return;
      }
      // Wait until enough of the oldest grants have left the window.
      await abortable(sleep(wait), signal);
    }
  }

  return {
    acquire({ spare = false, signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const turn = queue.then(() => waitForSlot(spare, signal));
      queue = turn.catch(() => {});
      return abortable(turn, signal);
    },
  };
}

/** The one limiter every static request to data.gov.my goes through. */
export let staticLimiter: StaticLimiter = createStaticLimiter({ log: () => requestLog });
/** Swaps the shared limiter (tests install one on a fake clock). */
export function setStaticLimiter(limiter: StaticLimiter): void {
  staticLimiter = limiter;
}

/** A static zip request that came back with an error status. */
export class StaticHttpError extends Error {
  constructor(
    readonly status: number,
    /** The raw `Retry-After` header, if any. */
    readonly retryAfter: string | null = null,
  ) {
    super(`GTFS static ${status}`);
    this.name = "StaticHttpError";
  }
}

/**
 * Dev only: `EXPO_PUBLIC_GTFS_STATIC_BASE` (e.g. `http://localhost:8080`)
 * serves the data.gov.my static zips from elsewhere, same paths and queries.
 * They still take limiter slots, so pacing can be checked against it.
 */
const STATIC_BASE_OVERRIDE = isDev() ? process.env.EXPO_PUBLIC_GTFS_STATIC_BASE : undefined;

/**
 * The `fetch` static zips are downloaded with. The app swaps in `expo/fetch`
 * (see `services/staticFetch.ts`): React Native's `arrayBuffer()` hands the
 * body over as base64 and decodes it in JS, a long stall for a 2 MB zip.
 * Defaults to the global `fetch`, looked up per call so tests can stub it.
 */
let staticFetch: (url: string) => Promise<Response> = (url) => fetch(url);
export function setStaticFetch(f: (url: string) => Promise<Response>): void {
  staticFetch = f;
}

/** `fetch` for a static zip: data.gov.my requests wait for a limiter slot first. */
async function fetchStatic(
  url: string,
  opts: { spare?: boolean; signal?: AbortSignal } = {},
): Promise<Response> {
  if (!url.startsWith(STATIC_API)) return staticFetch(url);
  await staticLimiter.acquire(opts);
  if (isDev()) {
    const at = new Date().toISOString().slice(11, 19);
    console.log(`[gtfs] static GET ${at}Z ${url}${opts.spare ? " (spare slot)" : ""}`);
  }
  const base = STATIC_BASE_OVERRIDE?.replace(/\/$/, "");
  return staticFetch(base ? base + url.slice(STATIC_API.length - 1) : url);
}

function fresh<T>(c: Cached<T> | undefined): c is Cached<T> {
  return !!c && Date.now() - c.fetchedAt < STATIC_TTL_MS;
}

async function fetchZip(category: BusCategory, opts: { spare?: boolean } = {}): Promise<Uint8Array> {
  const urls = BUS_CATEGORY_INFO[category].staticUrls;
  let lastStatus = 0;
  let retryAfter: string | null = null;
  for (const url of urls) {
    const res = await fetchStatic(url, opts);
    devStage(`zip ${category} response ${res.status}`);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      devStage(`zip ${category} body ${Math.round(bytes.length / 1024)} KB`);
      return bytes;
    }
    lastStatus = res.status;
    retryAfter = res.headers.get("retry-after");
    // A 404 means "not published here" — try the next mirror. Anything else
    // is a real failure.
    if (res.status !== 404) break;
  }
  throw new StaticHttpError(lastStatus, retryAfter);
}

/**
 * One category's static zip; concurrent callers share one download.
 * `spare` lets a retry after a 429 use the limiter's spare slot.
 */
function getZip(category: BusCategory, opts: { spare?: boolean } = {}): Promise<Uint8Array> {
  const cached = zips.get(category);
  if (fresh(cached)) {
    touchZips();
    return Promise.resolve(cached.value);
  }
  let p = zipInflight.get(category);
  if (!p) {
    p = fetchZip(category, opts)
      .then((bytes) => {
        zips.set(category, { fetchedAt: Date.now(), value: bytes });
        touchZips();
        return bytes;
      })
      .finally(() => zipInflight.delete(category));
    zipInflight.set(category, p);
  }
  return p;
}

/**
 * Index builds run one at a time. Each pauses every few ms to let typing
 * through, but four running at once would have their slices run back to
 * back in one timer flush.
 */
let buildQueue: Promise<unknown> = Promise.resolve();
function enqueueBuild<T>(build: () => Promise<T>): Promise<T> {
  const run = buildQueue.then(build);
  buildQueue = run.catch(() => {});
  return run;
}

/** Downloads the feed, builds its index from the zip, keeps and saves it. */
async function buildIndex(category: BusCategory): Promise<RouteSearchIndex> {
  const bytes = await getZip(category);
  devStage(`search index ${category} zip ready`);
  const index = await enqueueBuild(() => buildRouteSearchIndexFromZip(bytes, category));
  devStage(`search index ${category} built`);
  const fetchedAt = Date.now();
  indexes.set(category, { fetchedAt, value: index });
  const serialized = serializeRouteSearchIndex(index);
  devStage(`search index ${category} serialized`);
  void indexStore
    ?.save(category, fetchedAt, serialized)
    .then(() => devStage(`search index ${category} saved`))
    .catch(() => {});
  return index;
}

function refreshIndexInBackground(category: BusCategory): void {
  if (refreshing.has(category) || indexInflight.has(category)) return;
  refreshing.add(category);
  void buildIndex(category)
    .catch(() => {})
    .finally(() => refreshing.delete(category));
}

/**
 * One feed's search index: from memory, else the saved copy, else built
 * from a download. A stale one is answered from at once and rebuilt behind.
 */
function getSearchIndex(category: BusCategory): Promise<RouteSearchIndex> {
  const mem = indexes.get(category);
  if (mem) {
    if (!fresh(mem)) refreshIndexInBackground(category);
    return Promise.resolve(mem.value);
  }
  let p = indexInflight.get(category);
  if (!p) {
    p = (async () => {
      const saved = indexStore ? await indexStore.load(category).catch(() => null) : null;
      const index = saved ? deserializeRouteSearchIndex(saved.data) : null;
      if (saved && index) {
        indexes.set(category, { fetchedAt: saved.fetchedAt, value: index });
        return index;
      }
      return buildIndex(category);
    })().finally(() => {
      indexInflight.delete(category);
      const got = indexes.get(category);
      if (got && !fresh(got)) refreshIndexInBackground(category);
    });
    indexInflight.set(category, p);
  }
  return p;
}

/**
 * Loads every feed's search index ahead of the first keystroke (the add-route
 * screen calls this on open), so typing answers from memory.
 */
export function prewarmRouteSearch(): void {
  for (const c of BUS_CATEGORIES) void getSearchIndex(c).catch(() => {});
}

/**
 * Route search across every Prasarana bus feed (route code, name, or a stop
 * it serves). `onPartial` gets the hits so far each time another feed's
 * index arrives, so results appear before the slowest feed is in. A feed
 * that fails to load is skipped; only when all fail does the search fail.
 */
export async function searchFeedRoutes(
  query: string,
  signal?: AbortSignal,
  onPartial?: (hits: RouteSearchHit[]) => void,
): Promise<RouteSearchHit[]> {
  const run = (async () => {
    const loaded = new Map<BusCategory, RouteSearchIndex>();
    // Ties rank in BUS_CATEGORIES order, however the feeds arrive.
    const search = () =>
      searchRouteIndexes(
        BUS_CATEGORIES.flatMap((c) => (loaded.has(c) ? [loaded.get(c)!] : [])),
        query,
        RESULT_LIMIT,
      );
    let firstError: unknown = null;
    await Promise.all(
      BUS_CATEGORIES.map(async (c) => {
        try {
          loaded.set(c, await getSearchIndex(c));
          if (onPartial && !signal?.aborted && loaded.size < BUS_CATEGORIES.length) {
            onPartial(search());
          }
        } catch (err) {
          firstError ??= err;
          console.warn(`[gtfs] ${c} feed unavailable: ${(err as Error)?.message ?? err}`);
        }
      }),
    );
    if (loaded.size === 0) throw firstError ?? new Error("GTFS static unavailable");
    return search();
  })();
  return abortable(run, signal);
}

/**
 * Everything the app stores for one route: its trips, stops, stop times,
 * shapes and calendar, plus OSM traffic signals along it when we have them.
 * `code` is a route key ("T816", "400", "401 Penang"). Bare keys are looked
 * up in the feeder feed, then Rapid KL; `categoryHint` (from SQLite) skips
 * straight to the right feed. Only the route's own rows are ever parsed.
 */
export async function getRouteBundle(
  code: string,
  signal?: AbortSignal,
  categoryHint?: BusCategory | null,
): Promise<T816Bundle> {
  const key = code.trim();
  const candidates = categoriesForKey(key);
  const order =
    categoryHint && candidates.includes(categoryHint)
      ? [categoryHint, ...candidates.filter((c) => c !== categoryHint)]
      : candidates;
  let firstError: unknown = null;
  for (const category of order) {
    let bytes: Uint8Array;
    devStage(`bundle ${key} from ${category}`);
    try {
      bytes = await abortable(getZip(category), signal);
    } catch (err) {
      // One feed being down mustn't hide a route in the next candidate feed.
      if (err instanceof Error && err.name === "AbortError") throw err;
      firstError ??= err;
      continue;
    }
    // Stepped: parsing a whole feed for one route is 0.5–0.8 s of work on
    // Hermes, and bootstrap runs it per favourite at launch.
    const raw = await runSteps(
      untilAborted(parseGtfsZipSteps(bytes, { keepRoute: (r) => matchesCode(r, key, category) }), signal),
      BUNDLE_SLICE_MS,
    );
    devStage(`bundle ${key} parsed`);
    const parsed = namespaceParsedGtfs(raw, category);
    const bundle = filterToRoutes(parsed, [key], Date.now, { category });
    devStage(`bundle ${key} cut (${bundle.routes.length} routes)`);
    if (bundle.routes.length === 0) continue;
    // Traffic signals were collected for feeder routes only.
    const routeCode = bundle.routes[0].code;
    const signals =
      category === "rapid-bus-mrtfeeder" ? TRAFFIC_SIGNALS[routeCode] : undefined;
    return { ...bundle, trafficSignals: signals ? { [routeCode]: signals } : {} };
  }
  throw firstError ?? new RouteNotFoundError(key);
}

export interface FeedDownload {
  feed: FeedId;
  bytes: Uint8Array;
  etag: string | null;
}

/** Whether downloading `feed` now sends a request (rather than sharing a cached or in-flight zip). */
function feedNeedsRequest(feed: FeedId): boolean {
  const category = FEED_INFO[feed].category;
  return !category || !(fresh(zips.get(category)) || zipInflight.has(category));
}

/**
 * The network refresh spaces its own requests at least this far apart, on
 * top of the limiter, so a refresh never spends a minute's slots in a burst
 * and leaves search waiting (spec: feeds fetched sequentially, ≥ 16 s apart).
 */
export const TRANSIT_FEED_SPACING_MS = 16_000;

async function downloadFeed(feed: FeedId, spare: boolean, signal?: AbortSignal): Promise<FeedDownload> {
  const category = FEED_INFO[feed].category;
  // The bus feeds share search's download (and its in-memory copy).
  if (category) return { feed, bytes: await abortable(getZip(category, { spare }), signal), etag: null };
  const res = await fetchStatic(FEED_INFO[feed].staticUrl, { spare, signal });
  devStage(`zip ${feed} response ${res.status}`);
  if (!res.ok) throw new StaticHttpError(res.status, res.headers.get("retry-after"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  devStage(`zip ${feed} body ${Math.round(bytes.length / 1024)} KB`);
  return { feed, bytes, etag: res.headers.get("etag") };
}

/**
 * Downloads the transit network's feed zips one at a time, each request at
 * least {@link TRANSIT_FEED_SPACING_MS} after the last and paced by
 * {@link staticLimiter}. A 429 waits (honouring `Retry-After`) and retries
 * once on the spare slot; a feed that still fails is reported in `failed`
 * and the rest carry on.
 */
export async function downloadTransitFeeds(
  feeds: readonly FeedId[],
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: AbortSignal } = {},
): Promise<{ ok: FeedDownload[]; failed: FeedId[] }> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const { signal } = deps;
  const ok: FeedDownload[] = [];
  const failed: FeedId[] = [];
  let lastRequestAt: number | null = null;
  /** Downloads `feed`, first waiting out the spacing if it will send a request. */
  const attempt = async (feed: FeedId, spare: boolean) => {
    devStage(`download ${feed}`);
    if (!feedNeedsRequest(feed)) return downloadFeed(feed, spare, signal);
    const wait = lastRequestAt === null ? 0 : lastRequestAt + TRANSIT_FEED_SPACING_MS - now();
    if (wait > 0) await abortable(sleep(wait), signal);
    try {
      return await downloadFeed(feed, spare, signal);
    } finally {
      // Counted from when the response is in, which is after the limiter let
      // the request go, so the next one goes out at least the spacing later.
      lastRequestAt = now();
    }
  };
  for (const feed of feeds) {
    if (signal?.aborted) throw abortError();
    try {
      ok.push(await attempt(feed, false));
      continue;
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (!(err instanceof StaticHttpError && err.status === 429)) {
        console.warn(`[gtfs] ${feed} download failed: ${(err as Error)?.message ?? err}`);
        failed.push(feed);
        continue;
      }
      const wait = computeNextPollDelay({
        baseMs: STATIC_WINDOW_MS / STATIC_MAX_REQUESTS,
        consecutiveFailures: 1,
        status: 429,
        retryAfterMs: parseRetryAfterMs(err.retryAfter, now()) ?? undefined,
        maxMs: 120_000,
      });
      console.warn(`[gtfs] ${feed} got 429; retrying in ${Math.round(wait / 1000)} s`);
      await abortable(sleep(wait), signal);
    }
    try {
      ok.push(await attempt(feed, true));
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn(`[gtfs] ${feed} retry failed: ${(err as Error)?.message ?? err}`);
      failed.push(feed);
    }
  }
  return { ok, failed };
}

/** Pause for the UI after this much route-bundle parsing (the network build's slice). */
const BUNDLE_SLICE_MS = 12;

/** Runs `steps`, throwing an AbortError at the next step once `signal` aborts. */
function* untilAborted<T>(steps: Generator<void, T, void>, signal?: AbortSignal): Generator<void, T, void> {
  for (;;) {
    if (signal?.aborted) throw abortError();
    const step = steps.next();
    if (step.done) return step.value;
    yield;
  }
}

/** Lets a caller stop waiting without cancelling the shared download. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// `__DEV__` is a RN global — shim for unit tests.
function isDev(): boolean {
  return (globalThis as unknown as { __DEV__?: boolean }).__DEV__ ?? false;
}

export function resetGtfsFeedCacheForTests(): void {
  zips.clear();
  zipInflight.clear();
  indexes.clear();
  indexInflight.clear();
  refreshing.clear();
  buildQueue = Promise.resolve();
  indexStore = null;
  if (zipIdleTimer) clearTimeout(zipIdleTimer);
  zipIdleTimer = null;
  requestLog = null;
  staticLimiter = createStaticLimiter({ log: () => requestLog });
}
