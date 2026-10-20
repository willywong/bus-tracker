// Fetchers for MET Malaysia's forecast and warning endpoints on
// api.data.gov.my (free, no key). The Weather API family has its own
// 4 requests/min bucket, separate from GTFS.
//
// Neither fetcher ever throws. On 429, a network error, an abort or a bad
// body, each returns the last good cached value (even if stale), or null.
// Results are cached in memory for 30 minutes per URL, and calls for the
// same URL while a request is in flight share it.
//
// Query parameters (official docs: datagovmy-front apps/docs/pages/
// request-query.en.mdx and realtime-api/weather.en.mdx):
// - Forecast: `contains=<id>@location__location_id` returns the 7 daily rows
//   for one location (about 1.5 KB) instead of all 3,080 rows (about 0.9 MB).
//   This is the docs' own example, and community clients use it
//   (zubir2k/homeassistant-malaysiaweather, timothylee58/Jalur-ApexGP with
//   Ds064). floodguard-penang saw 7 rows for St003. Location ids are fixed
//   at 5 characters, so `contains` is effectively an exact match.
// - Warnings: not filtered on the server. The feed only holds current
//   bulletins (about 4 records, about 8 KB). `timestamp_start` on
//   warning_issue__issued was seen NOT to filter (floodguard-penang ACCESS.md,
//   2026-09-24). Expired records still come back, so nudge.ts filters on
//   valid_to.
// - A trailing slash avoids an extra 301 redirect (junmob/final-year-project
//   scripts/download_weather.py).

import type { ForecastRow, WarningRow } from "./types";

export const WEATHER_API_BASE = "https://api.data.gov.my/weather";
export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
/** Back-off after a 429 that has no usable Retry-After header. */
const DEFAULT_429_BACKOFF_MS = 60 * 1000;
const MAX_429_BACKOFF_MS = 10 * 60 * 1000;

export function forecastUrl(locationId: string): string {
  const params = new URLSearchParams({ contains: `${locationId}@location__location_id` });
  return `${WEATHER_API_BASE}/forecast/?${params.toString()}`;
}

export const WARNINGS_URL = `${WEATHER_API_BASE}/warning/`;

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface WeatherClientOptions {
  /** Defaults to globalThis.fetch. */
  fetchImpl?: FetchLike;
  /** Defaults to Date.now. */
  now?: () => number;
  ttlMs?: number;
}

export interface WeatherClient {
  fetchForecast(locationId: string, signal?: AbortSignal): Promise<ForecastRow[] | null>;
  fetchWarnings(signal?: AbortSignal): Promise<WarningRow[] | null>;
  /** Drops cached data and back-off state. */
  clear(): void;
}

interface CacheEntry {
  data: unknown[];
  fetchedAt: number;
}

function retryAfterMs(header: string | null, nowMs: number): number {
  if (!header) return DEFAULT_429_BACKOFF_MS;
  const secs = Number(header);
  let ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) ms = DEFAULT_429_BACKOFF_MS;
  return Math.min(ms, MAX_429_BACKOFF_MS);
}

function isForecastRow(v: unknown): v is ForecastRow {
  if (!v || typeof v !== "object") return false;
  const r = v as { location?: { location_id?: unknown }; date?: unknown };
  return typeof r.location?.location_id === "string" && typeof r.date === "string";
}

function isWarningRow(v: unknown): v is WarningRow {
  return !!v && typeof v === "object";
}

export function createWeatherClient(options: WeatherClientOptions = {}): WeatherClient {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? WEATHER_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<unknown[] | null>>();
  // One back-off for the whole Weather family, because the limit is per family.
  let blockedUntil = 0;

  const getFetch = (): FetchLike | null =>
    options.fetchImpl ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : null);

  async function load<T>(
    url: string,
    guard: (v: unknown) => v is T,
    signal?: AbortSignal,
  ): Promise<T[] | null> {
    const cached = cache.get(url);
    const fallback = (cached?.data as T[] | undefined) ?? null;
    const t = now();
    if (cached && t - cached.fetchedAt < ttlMs) return fallback;
    if (t < blockedUntil || signal?.aborted) return fallback;

    const pending = inFlight.get(url);
    if (pending) return ((await pending) as T[] | null) ?? fallback;

    const doFetch = getFetch();
    if (!doFetch) return fallback;

    const request = (async (): Promise<unknown[] | null> => {
      try {
        const res = await doFetch(url, { signal, headers: { Accept: "application/json" } });
        if (res.status === 429) {
          blockedUntil = now() + retryAfterMs(res.headers.get("retry-after"), now());
          return null;
        }
        if (!res.ok) return null;
        const body = await res.json();
        // Errors come back as { status, errors }, not as an array.
        if (!Array.isArray(body)) return null;
        const rows = body.filter(guard);
        cache.set(url, { data: rows, fetchedAt: now() });
        return rows;
      } catch {
        return null; // network error or abort
      }
    })();

    inFlight.set(url, request);
    try {
      const result = await request;
      return (result as T[] | null) ?? fallback;
    } finally {
      inFlight.delete(url);
    }
  }

  return {
    fetchForecast(locationId, signal) {
      if (!/^[A-Za-z]{2}\d{3}$/.test(locationId)) return Promise.resolve(null);
      return load(forecastUrl(locationId), isForecastRow, signal);
    },
    fetchWarnings(signal) {
      return load(WARNINGS_URL, isWarningRow, signal);
    },
    clear() {
      cache.clear();
      inFlight.clear();
      blockedUntil = 0;
    },
  };
}

const defaultClient = createWeatherClient();

/** 7 daily forecast rows for one MET location id, e.g. "Ds057". Never throws. */
export function fetchForecast(locationId: string, signal?: AbortSignal): Promise<ForecastRow[] | null> {
  return defaultClient.fetchForecast(locationId, signal);
}

/** All current MET warning records, unfiltered. Never throws. */
export function fetchWarnings(signal?: AbortSignal): Promise<WarningRow[] | null> {
  return defaultClient.fetchWarnings(signal);
}

export function resetWeatherCacheForTests(): void {
  defaultClient.clear();
}

export { defaultClient as defaultWeatherClient };
