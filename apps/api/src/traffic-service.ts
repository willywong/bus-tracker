import type { Kv } from "./kv.js";

const HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes";
const TOMTOM_ROUTING_URL = "https://api.tomtom.com/routing/1/calculateRoute";
// 60s absorbs the mobile hook's 30s refresh floor and any cron beat.
const CACHE_TTL_MS = 60_000;
const KV_KEY_PREFIX = "bt:traffic-eta:";

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

export interface TrafficEtaServiceOptions {
  /**
   * Shared cache (Upstash Redis in prod, in-memory for dev/tests). When
   * provided, acts as an L2 cache in front of the HERE/TomTom API so cold
   * serverless instances reuse each other's results.
   */
  kv?: Kv;
  /**
   * Structured logger. Defaults to console.log on prod runtimes so cache
   * hit/miss rate is visible in Vercel function logs. Pass a no-op in tests.
   */
  log?: (event: Record<string, unknown>) => void;
}

export type TrafficCacheLayer = "l1" | "l2" | "miss";

export class TrafficEtaService {
  private l1 = new Map<string, CacheEntry>();
  private readonly keys: TrafficEtaServiceKeys;
  private readonly kv: Kv | undefined;
  private readonly log: (event: Record<string, unknown>) => void;

  constructor(
    keys: string | TrafficEtaServiceKeys | undefined,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
    options: TrafficEtaServiceOptions = {},
  ) {
    this.keys = typeof keys === "string" || keys === undefined
      ? { here: keys }
      : keys;
    this.kv = options.kv;
    this.log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  }

  async getEta(q: TrafficEtaQuery): Promise<{
    result: TrafficEtaResult;
    cached: boolean;
    /** Which cache layer served this — useful for tuning logs/tests. */
    layer: TrafficCacheLayer;
  }> {
    const provider: TrafficProvider = q.provider ?? "here";
    const apiKey = this.keys[provider];
    if (!apiKey) {
      throw provider === "here"
        ? new MissingHereKeyError()
        : new MissingProviderKeyError(provider);
    }

    const key = cacheKey(q, provider);
    const now = this.now();

    const l1hit = this.l1.get(key);
    if (l1hit && now - l1hit.fetchedAt < this.ttlMs) {
      this.emit({ event: "traffic_eta_cache", layer: "l1", provider });
      return { result: l1hit.result, cached: true, layer: "l1" };
    }

    if (this.kv) {
      const l2hit = await this.readKv(key);
      if (l2hit && now - l2hit.fetchedAt < this.ttlMs) {
        this.l1.set(key, l2hit);
        this.emit({ event: "traffic_eta_cache", layer: "l2", provider });
        return { result: l2hit.result, cached: true, layer: "l2" };
      }
    }

    const seconds = await (provider === "here"
      ? fetchHereSeconds(this.fetchImpl, apiKey, q)
      : fetchTomTomSeconds(this.fetchImpl, apiKey, q));

    const result: TrafficEtaResult = {
      trafficMinutes: Math.round((seconds / 60) * 10) / 10,
      source: provider,
      generatedAt: now,
    };
    const entry: CacheEntry = { fetchedAt: now, result };
    this.l1.set(key, entry);
    if (this.kv) await this.writeKv(key, entry);
    this.emit({ event: "traffic_eta_cache", layer: "miss", provider });
    return { result, cached: false, layer: "miss" };
  }

  private async readKv(key: string): Promise<CacheEntry | null> {
    try {
      return (await this.kv!.get<CacheEntry>(KV_KEY_PREFIX + key)) ?? null;
    } catch (err) {
      // Cache is advisory — a KV outage shouldn't take down the endpoint.
      this.emit({ event: "traffic_eta_kv_read_failed", error: String(err) });
      return null;
    }
  }

  private async writeKv(key: string, entry: CacheEntry): Promise<void> {
    try {
      await this.kv!.set(KV_KEY_PREFIX + key, entry);
    } catch (err) {
      this.emit({ event: "traffic_eta_kv_write_failed", error: String(err) });
    }
  }

  private emit(event: Record<string, unknown>): void {
    try {
      this.log(event);
    } catch {
      // Never let logging break a request.
    }
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
