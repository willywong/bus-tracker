const HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes";
const CACHE_TTL_MS = 15_000;

export interface TrafficEtaResult {
  trafficMinutes: number;
  source: "here";
  generatedAt: number;
}

export interface TrafficEtaQuery {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}

interface CacheEntry {
  fetchedAt: number;
  result: TrafficEtaResult;
}

type FetchFn = typeof fetch;

export class MissingHereKeyError extends Error {
  constructor() {
    super("HERE_API_KEY not configured");
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

export class TrafficEtaService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {}

  async getEta(q: TrafficEtaQuery): Promise<{
    result: TrafficEtaResult;
    cached: boolean;
  }> {
    if (!this.apiKey) throw new MissingHereKeyError();
    const key = cacheKey(q);
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && now - hit.fetchedAt < this.ttlMs) {
      return { result: hit.result, cached: true };
    }

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
    url.searchParams.set("apiKey", this.apiKey);

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      throw new UpstreamError(`HERE ${res.status}`, res.status);
    }
    const data = (await res.json()) as HereRoutesResponse;
    const seconds = firstSummarySeconds(data);
    if (seconds == null) {
      throw new UpstreamError("HERE response had no route summary", 502);
    }

    const result: TrafficEtaResult = {
      trafficMinutes: Math.round((seconds / 60) * 10) / 10,
      source: "here",
      generatedAt: now,
    };
    this.cache.set(key, { fetchedAt: now, result });
    return { result, cached: false };
  }
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

function firstSummarySeconds(data: HereRoutesResponse): number | null {
  const section = data.routes?.[0]?.sections?.[0]?.summary;
  if (!section) return null;
  const val = section.duration ?? section.baseDuration;
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function cacheKey(q: TrafficEtaQuery): string {
  return [
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
