import {
  BUS_CATEGORIES,
  BUS_CATEGORY_INFO,
  TRAFFIC_SIGNALS,
  buildRouteSearchIndexFromZip,
  categoriesForKey,
  deserializeRouteSearchIndex,
  filterToRoutes,
  matchesCode,
  namespaceParsedGtfs,
  parseGtfsZip,
  searchRouteIndexes,
  serializeRouteSearchIndex,
  vehiclePositionsUrl,
  type BusCategory,
  type RouteSearchHit,
  type RouteSearchIndex,
  type SerializedRouteSearchIndex,
  type T816Bundle,
} from "@bus-tracker/shared";

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

function fresh<T>(c: Cached<T> | undefined): c is Cached<T> {
  return !!c && Date.now() - c.fetchedAt < STATIC_TTL_MS;
}

/** Lets the UI paint (a spinner, the keystroke) before synchronous parsing. */
function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function fetchZip(category: BusCategory): Promise<Uint8Array> {
  const urls = BUS_CATEGORY_INFO[category].staticUrls;
  let lastStatus = 0;
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    lastStatus = res.status;
    // A 404 means "not published here" — try the next mirror. Anything else
    // is a real failure.
    if (res.status !== 404) break;
  }
  throw new Error(`GTFS static ${lastStatus}`);
}

/** One category's static zip; concurrent callers share one download. */
function getZip(category: BusCategory): Promise<Uint8Array> {
  const cached = zips.get(category);
  if (fresh(cached)) {
    touchZips();
    return Promise.resolve(cached.value);
  }
  let p = zipInflight.get(category);
  if (!p) {
    p = fetchZip(category)
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
  const index = await enqueueBuild(() => buildRouteSearchIndexFromZip(bytes, category));
  const fetchedAt = Date.now();
  indexes.set(category, { fetchedAt, value: index });
  void indexStore?.save(category, fetchedAt, serializeRouteSearchIndex(index)).catch(() => {});
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
    try {
      bytes = await abortable(getZip(category), signal);
    } catch (err) {
      // One feed being down mustn't hide a route in the next candidate feed.
      if (err instanceof Error && err.name === "AbortError") throw err;
      firstError ??= err;
      continue;
    }
    await yieldToUi();
    if (signal?.aborted) throw abortError();
    const parsed = namespaceParsedGtfs(
      parseGtfsZip(bytes, { keepRoute: (r) => matchesCode(r, key, category) }),
      category,
    );
    const bundle = filterToRoutes(parsed, [key], Date.now, { category });
    if (bundle.routes.length === 0) continue;
    // Traffic signals were collected for feeder routes only.
    const routeCode = bundle.routes[0].code;
    const signals =
      category === "rapid-bus-mrtfeeder" ? TRAFFIC_SIGNALS[routeCode] : undefined;
    return { ...bundle, trafficSignals: signals ? { [routeCode]: signals } : {} };
  }
  throw firstError ?? new RouteNotFoundError(key);
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
}
