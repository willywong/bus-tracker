/**
 * Minimal fixed-window rate limiter backed by the shared Kv.
 *
 * Not atomic — the get/set race window at high concurrency can over- or
 * under-count by a few requests, which is fine for an abuse cap in front of
 * the upstream GTFS feed. If we ever need strict enforcement, switch to an Upstash
 * `INCR + EXPIRE` command instead.
 */

import type { Kv } from "./kv.js";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_PER_MINUTE = 10;

const KEY_PREFIX = "bt:rl:";

interface Bucket {
  windowStart: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  kv: Kv,
  bucketKey: string,
  nowMs: number,
  max: number = RATE_LIMIT_MAX_PER_MINUTE,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitDecision> {
  const key = KEY_PREFIX + bucketKey;
  let bucket: Bucket | null = null;
  try {
    bucket = await kv.get<Bucket>(key);
  } catch {
    // Fail open — a Kv outage shouldn't take the endpoint down.
    return { allowed: true, remaining: max, retryAfterSeconds: 0 };
  }

  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    bucket = { windowStart: nowMs, count: 1 };
    await kv.set(key, bucket).catch(() => {});
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStart + windowMs - nowMs) / 1000),
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  await kv.set(key, bucket).catch(() => {});
  return {
    allowed: true,
    remaining: max - bucket.count,
    retryAfterSeconds: 0,
  };
}
