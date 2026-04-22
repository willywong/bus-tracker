/**
 * Pure helper for computing the next poll delay after a failure. Extracted so
 * the realtime-store backoff policy can be unit-tested without standing up
 * React Native / AppState machinery.
 *
 * Policy:
 *   - On HTTP 429: honour `Retry-After` if the server sent one, otherwise wait
 *     the base interval. Never faster than the base interval — we never want
 *     to hammer an upstream that just told us to slow down.
 *   - On any other failure: exponential backoff (2^failures * base), capped.
 *   - On success: caller resets the failure counter and passes 0.
 */

export interface NextPollDelayArgs {
  /** Base interval between successful polls, in ms. */
  baseMs: number;
  /** Number of *consecutive* failures including the one being handled. 0 = success. */
  consecutiveFailures: number;
  /** HTTP status from the failed response, if known. */
  status?: number;
  /** Parsed `Retry-After` header value in ms (caller normalises seconds → ms). */
  retryAfterMs?: number;
  /** Upper bound for backoff. Defaults to 4× base. */
  maxMs?: number;
}

export function computeNextPollDelay(args: NextPollDelayArgs): number {
  const { baseMs, consecutiveFailures, status, retryAfterMs } = args;
  const maxMs = args.maxMs ?? baseMs * 4;

  if (consecutiveFailures <= 0) return baseMs;

  if (status === 429) {
    const hinted = typeof retryAfterMs === "number" && retryAfterMs > 0
      ? retryAfterMs
      : baseMs;
    return Math.min(maxMs, Math.max(baseMs, hinted));
  }

  const exp = baseMs * 2 ** (consecutiveFailures - 1);
  return Math.min(maxMs, Math.max(baseMs, exp));
}

/** Parse a `Retry-After` header into ms. Returns null when absent/invalid. */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number,
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === "") return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    return Math.max(0, Math.round(asNumber * 1000));
  }
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - nowMs);
  }
  return null;
}
