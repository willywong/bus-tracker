const HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes";
const TOMTOM_ROUTING_URL = "https://api.tomtom.com/routing/1/calculateRoute";
const CACHE_TTL_MS = 15_000;

export type TrafficProvider = "here" | "tomtom";
export const TRAFFIC_PROVIDERS: readonly TrafficProvider[] = ["here", "tomtom"];

export interface TrafficEtaResult {
  trafficMinutes: number;
  source: TrafficProvider;
  generatedAt: number;
}

export interface TrafficEtaQuery {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  provider?: TrafficProvider;
}

interface CacheEntry {
  fetchedAt: number;
  result: TrafficEtaResult;
}

type FetchFn = typeof fetch;

export class MissingProviderKeyError extends Error {
  constructor(readonly provider: TrafficProvider) {
    super(
      provider === "here"
        ? "HERE_API_KEY not configured"
        : "TOMTOM_API_KEY not configured",
    );
    this.name = "MissingProviderKeyError";
  }
}

/** @deprecated use MissingProviderKeyError */
export class MissingHereKeyError extends MissingProviderKeyError {
  constructor() {
    super("here");
    this.name = "MissingHereKeyError";
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface TrafficEtaServiceKeys {
  here?: string;
  tomtom?: string;
}

export class TrafficEtaService {
  private cache = new Map<string, CacheEntry>();
  private readonly keys: TrafficEtaServiceKeys;

  constructor(
    keys: string | TrafficEtaServiceKeys | undefined,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {
    this.keys = typeof keys === "string" || keys === undefined
      ? { here: keys }
      : keys;
  }

  async getEta(q: TrafficEtaQuery): Promise<{
    result: TrafficEtaResult;
    cached: boolean;
  }> {
    const provider: TrafficProvider = q.provider ?? "here";
    const apiKey = this.keys[provider];
    if (!apiKey) {
      throw provider === "here"
        ? new MissingHereKeyError()
        : new MissingProviderKeyError(provider);
    }

    const key = cacheKey(q, provider);
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && now - hit.fetchedAt < this.ttlMs) {
      return { result: hit.result, cached: true };
    }

    const seconds = await (provider === "here"
      ? fetchHereSeconds(this.fetchImpl, apiKey, q)
      : fetchTomTomSeconds(this.fetchImpl, apiKey, q));

    const result: TrafficEtaResult = {
      trafficMinutes: Math.round((seconds / 60) * 10) / 10,
      source: provider,
      generatedAt: now,
    };
    this.cache.set(key, { fetchedAt: now, result });
    return { result, cached: false };
  }
}

async function fetchHereSeconds(
  fetchImpl: FetchFn,
  apiKey: string,
  q: TrafficEtaQuery,
): Promise<number> {
  const url = new URL(HERE_ROUTES_URL);
  url.searchParams.set("transportMode", "bus");
  url.searchParams.set(
    "origin",
    `${q.originLat.toFixed(6)},${q.originLng.toFixed(6)}`,
  );
  url.searchParams.set(
    "destination",
    `${q.destLat.toFixed(6)},${q.destLng.toFixed(6)}`,
  );
  url.searchParams.set("return", "summary");
  // HERE Routing v8: omitting departureTime (or passing an ISO timestamp) uses
  // live traffic. "any" gives typical/no-traffic, which we don't want.
  url.searchParams.set("apiKey", apiKey);

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new UpstreamError(`HERE ${res.status}`, res.status);
  const data = (await res.json()) as HereRoutesResponse;
  const section = data.routes?.[0]?.sections?.[0]?.summary;
  const val = section?.duration ?? section?.baseDuration;
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new UpstreamError("HERE response had no route summary", 502);
  }
  return val;
}

async function fetchTomTomSeconds(
  fetchImpl: FetchFn,
  apiKey: string,
  q: TrafficEtaQuery,
): Promise<number> {
  // TomTom Routing API path contains origin:destination coordinates.
  // Use `travelMode=bus` + `traffic=true` so we get a live-traffic estimate.
  const coords =
    `${q.originLat.toFixed(6)},${q.originLng.toFixed(6)}` +
    ":" +
    `${q.destLat.toFixed(6)},${q.destLng.toFixed(6)}`;
  const url = new URL(`${TOMTOM_ROUTING_URL}/${coords}/json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("traffic", "true");
  url.searchParams.set("travelMode", "bus");
  url.searchParams.set("routeType", "fastest");

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new UpstreamError(`TomTom ${res.status}`, res.status);
  const data = (await res.json()) as TomTomRoutesResponse;
  const summary = data.routes?.[0]?.summary;
  const val = summary?.travelTimeInSeconds ?? summary?.noTrafficTravelTimeInSeconds;
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new UpstreamError("TomTom response had no route summary", 502);
  }
  return val;
}

interface HereRoutesResponse {
  routes?: Array<{
    sections?: Array<{
      summary?: {
        duration?: number;
        baseDuration?: number;
      };
    }>;
  }>;
}

interface TomTomRoutesResponse {
  routes?: Array<{
    summary?: {
      travelTimeInSeconds?: number;
      noTrafficTravelTimeInSeconds?: number;
    };
  }>;
}

function cacheKey(q: TrafficEtaQuery, provider: TrafficProvider): string {
  return [
    provider,
    q.originLat.toFixed(4),
    q.originLng.toFixed(4),
    q.destLat.toFixed(4),
    q.destLng.toFixed(4),
  ].join(",");
}

export function parseLatLngPair(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lat = Number.parseFloat(parts[0]);
  const lng = Number.parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

export function parseTrafficProvider(
  value: string | undefined,
): TrafficProvider | null {
  if (!value) return "here";
  const lower = value.toLowerCase();
  return TRAFFIC_PROVIDERS.includes(lower as TrafficProvider)
    ? (lower as TrafficProvider)
    : null;
}
