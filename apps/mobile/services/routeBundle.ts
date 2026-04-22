import type { T816Bundle } from "@bus-tracker/shared";
import { API_BASE_URL } from "@/config/env";

/**
 * In-memory cache keyed by route code, scoped to the running app process.
 * Keeps the Add Bus stop-picker snappy when the user bounces between search
 * results. Cleared naturally on app restart; the durable SQLite write happens
 * via `bootstrapStaticGtfs` once the route is favorited.
 */
const sessionCache = new Map<string, T816Bundle>();

export async function fetchRouteBundle(
  code: string,
  signal?: AbortSignal,
): Promise<T816Bundle> {
  const key = code.toUpperCase();
  const cached = sessionCache.get(key);
  if (cached) return cached;

  const url = `${API_BASE_URL}/api/route/${encodeURIComponent(code)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`route ${code}: ${res.status}`);
  const bundle = (await res.json()) as T816Bundle;
  sessionCache.set(key, bundle);
  return bundle;
}

export function resetRouteBundleCacheForTests(): void {
  sessionCache.clear();
}
