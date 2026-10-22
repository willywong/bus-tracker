/**
 * A location fix without the long wait (15/08). A cold `getCurrentPositionAsync`
 * can take ~10 s, so: a recent last-known fix if there is one; else a fresh
 * fix raced against a short timeout; on timeout an older last-known fix;
 * with none, the fresh fix after all, however long it takes (the Simulator
 * and a cold GPS have no last-known fix, and giving up would only show
 * "location isn't available"). Null when the fresh fix fails and nothing
 * else is there. Takes the location calls as arguments, so it runs under
 * `tsx --test`.
 */

/** "My location" trusts a last-known fix this old without asking for a new one. */
export const FRESH_FIX_MAX_AGE_MS = 60_000;
/** How long to wait for a fresh fix. */
export const CURRENT_FIX_TIMEOUT_MS = 4_000;
/** After a timeout, a last-known fix this old still beats no start at all. */
export const FALLBACK_FIX_MAX_AGE_MS = 10 * 60_000;

export interface QuickFixDeps<F> {
  /** `getLastKnownPositionAsync({ maxAge })`: null when there's none that recent. */
  lastKnown: (maxAgeMs: number) => Promise<F | null>;
  /** `getCurrentPositionAsync`. */
  current: () => Promise<F | null>;
}

export async function quickFix<F>(
  deps: QuickFixDeps<F>,
  opts: { freshMaxAgeMs?: number; timeoutMs?: number; fallbackMaxAgeMs?: number } = {},
): Promise<F | null> {
  const {
    freshMaxAgeMs = FRESH_FIX_MAX_AGE_MS,
    timeoutMs = CURRENT_FIX_TIMEOUT_MS,
    fallbackMaxAgeMs = FALLBACK_FIX_MAX_AGE_MS,
  } = opts;
  const recent = await deps.lastKnown(freshMaxAgeMs).catch(() => null);
  if (recent) return recent;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const pending = deps.current().catch(() => null);
  const fresh = await Promise.race([pending, timedOut]);
  clearTimeout(timer);
  if (fresh) return fresh;
  const older = fallbackMaxAgeMs > freshMaxAgeMs ? await deps.lastKnown(fallbackMaxAgeMs).catch(() => null) : null;
  return older ?? pending;
}
