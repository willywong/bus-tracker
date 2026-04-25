/**
 * Server-side proxy cache for the Prasarana GTFS Realtime vehicle-position
 * feed. N mobile clients collapse to ~2 upstream fetches/min regardless of
 * client count, keeping us inside the provider's 4-req/min rate limit.
 *
 * Storage: Upstash-compatible KV (shared `Kv` abstraction). The envelope
 * embeds its own `fetchedAt` timestamp so expiry is evaluated on read and we
 * can still serve stale bytes during an upstream outage.
 */

import type { Kv } from "./kv.js";

const UPSTREAM_URL =
  process.env.GTFS_RT_UPSTREAM_URL ??
  "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder";

export const ALERTS_UPSTREAM_URL =
  process.env.GTFS_ALERTS_UPSTREAM_URL ??
  "https://api.data.gov.my/gtfs-realtime/service-alerts/prasarana?category=rapid-bus-mrtfeeder";

export const TRIP_UPDATES_UPSTREAM_URL =
  process.env.GTFS_TRIP_UPDATES_UPSTREAM_URL ??
  "https://api.data.gov.my/gtfs-realtime/trip-updates/prasarana?category=rapid-bus-mrtfeeder";

const CACHE_KEY = "bt:gtfs-rt:prasarana:rapid-bus-mrtfeeder";
export const ALERTS_CACHE_KEY = "bt:gtfs-alerts:prasarana:rapid-bus-mrtfeeder";
export const TRIP_UPDATES_CACHE_KEY =
  "bt:gtfs-tu:prasarana:rapid-bus-mrtfeeder";
/** How long a fresh blob is served as HIT. Matches upstream update cadence. */
export const FRESH_TTL_MS = 30_000;
/** Alerts change slowly; longer freshness keeps upstream load minimal. */
export const ALERTS_FRESH_TTL_MS = 60_000;
/** How long a stale blob may cover an upstream failure before we give up. */
export const STALE_GRACE_MS = 2 * 60_000;

export interface RealtimeEnvelope {
  bytesBase64: string;
  fetchedAt: number;
}

export type FetchOutcome = "HIT" | "MISS" | "STALE";

export interface GetFeedResult {
  bytes: Uint8Array;
  outcome: FetchOutcome;
  fetchedAt: number;
  /** Age (ms) of the bytes being served, relative to `now`. */
  ageMs: number;
}

export class GtfsRealtimeUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GtfsRealtimeUpstreamError";
  }
}

export interface GtfsRealtimeServiceDeps {
  kv: Kv;
  fetchUpstream?: (signal?: AbortSignal) => Promise<Uint8Array>;
  now?: () => number;
  freshTtlMs?: number;
  staleGraceMs?: number;
  cacheKey?: string;
}

async function defaultFetchUpstream(
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return fetchUpstreamFromUrl(UPSTREAM_URL, signal);
}

export async function fetchUpstreamFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new GtfsRealtimeUpstreamError(`upstream ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available on Vercel Edge + modern Node (>=16).
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class GtfsRealtimeService {
  private readonly kv: Kv;
  private readonly fetchUpstream: (s?: AbortSignal) => Promise<Uint8Array>;
  private readonly now: () => number;
  private readonly freshTtlMs: number;
  private readonly staleGraceMs: number;
  private readonly cacheKey: string;
  private inflight: Promise<Uint8Array> | null = null;

  constructor(deps: GtfsRealtimeServiceDeps) {
    this.kv = deps.kv;
    this.fetchUpstream = deps.fetchUpstream ?? defaultFetchUpstream;
    this.now = deps.now ?? Date.now;
    this.freshTtlMs = deps.freshTtlMs ?? FRESH_TTL_MS;
    this.staleGraceMs = deps.staleGraceMs ?? STALE_GRACE_MS;
    this.cacheKey = deps.cacheKey ?? CACHE_KEY;
  }

  async getFeed(): Promise<GetFeedResult> {
    const now = this.now();
    let cached: RealtimeEnvelope | null = null;
    try {
      cached = await this.kv.get<RealtimeEnvelope>(this.cacheKey);
    } catch {
      // Fail open — a KV outage shouldn't take the endpoint down.
      cached = null;
    }

    if (cached && now - cached.fetchedAt < this.freshTtlMs) {
      return {
        bytes: base64ToBytes(cached.bytesBase64),
        outcome: "HIT",
        fetchedAt: cached.fetchedAt,
        ageMs: now - cached.fetchedAt,
      };
    }

    // Coalesce concurrent misses inside a single invocation. Cross-invocation
    // races are acceptable — worst case ~2 duplicate upstream fetches per 30s.
    if (!this.inflight) {
      this.inflight = this.fetchUpstream().finally(() => {
        this.inflight = null;
      });
    }

    try {
      const bytes = await this.inflight;
      const fetchedAt = this.now();
      await this.kv
        .set<RealtimeEnvelope>(this.cacheKey, {
          bytesBase64: bytesToBase64(bytes),
          fetchedAt,
        })
        .catch(() => {});
      return { bytes, outcome: "MISS", fetchedAt, ageMs: 0 };
    } catch (err) {
      if (cached && now - cached.fetchedAt < this.staleGraceMs) {
        return {
          bytes: base64ToBytes(cached.bytesBase64),
          outcome: "STALE",
          fetchedAt: cached.fetchedAt,
          ageMs: now - cached.fetchedAt,
        };
      }
      if (err instanceof GtfsRealtimeUpstreamError) throw err;
      throw new GtfsRealtimeUpstreamError(String(err));
    }
  }
}
