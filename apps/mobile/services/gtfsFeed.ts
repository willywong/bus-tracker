import {
  TRAFFIC_SIGNALS,
  filterToRoutes,
  parseGtfsZip,
  searchRoutes,
  type ParsedGtfs,
  type RouteSearchHit,
  type T816Bundle,
} from "@bus-tracker/shared";

/**
 * data.gov.my GTFS feeds, fetched straight from the device — no BusBuddy
 * server in between. See https://developer.data.gov.my/realtime-api.
 */
const FEED_CATEGORY = "rapid-bus-mrtfeeder";
export const GTFS_STATIC_URL = `https://api.data.gov.my/gtfs-static/prasarana?category=${FEED_CATEGORY}`;
export const GTFS_VEHICLE_POSITIONS_URL = `https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=${FEED_CATEGORY}`;

/** Prasarana publishes static GTFS "as required"; refresh a few times a day. */
const PARSED_TTL_MS = 12 * 60 * 60 * 1000;

export class RouteNotFoundError extends Error {
  constructor(code: string) {
    super(`route ${code} not found`);
    this.name = "RouteNotFoundError";
  }
}

interface ParsedCache {
  fetchedAt: number;
  parsed: ParsedGtfs;
}

let cache: ParsedCache | null = null;
let inflight: Promise<ParsedGtfs> | null = null;

/**
 * The whole feeder-bus feed, downloaded and parsed once and kept in memory
 * for the session (refreshed after {@link PARSED_TTL_MS}). Concurrent callers
 * share one download. Parsing is synchronous and takes a moment on device,
 * so it's deferred a tick to let the UI paint its loading state first.
 */
export async function getParsedGtfs(signal?: AbortSignal): Promise<ParsedGtfs> {
  if (cache && Date.now() - cache.fetchedAt < PARSED_TTL_MS) return cache.parsed;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(GTFS_STATIC_URL);
      if (!res.ok) throw new Error(`GTFS static ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await new Promise((r) => setTimeout(r, 0));
      const parsed = parseGtfsZip(bytes);
      cache = { fetchedAt: Date.now(), parsed };
      return parsed;
    })().finally(() => {
      inflight = null;
    });
  }
  return abortable(inflight, signal);
}

/** Route search over the feed (route code, name, or a stop it serves). */
export async function searchFeedRoutes(
  query: string,
  signal?: AbortSignal,
): Promise<RouteSearchHit[]> {
  const parsed = await getParsedGtfs(signal);
  return searchRoutes(parsed, query, 25);
}

/**
 * Everything the app stores for one route: its trips, stops, stop times,
 * shapes and calendar, plus OSM traffic signals along it when we have them.
 */
export async function getRouteBundle(
  code: string,
  signal?: AbortSignal,
): Promise<T816Bundle> {
  const normalized = code.trim().toUpperCase();
  const parsed = await getParsedGtfs(signal);
  const bundle = filterToRoutes(parsed, [normalized]);
  if (bundle.routes.length === 0) throw new RouteNotFoundError(normalized);
  const signals = TRAFFIC_SIGNALS[normalized];
  return { ...bundle, trafficSignals: signals ? { [normalized]: signals } : {} };
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
  cache = null;
  inflight = null;
}
