import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

const WALK_STARTED_KEY = 't816.walkStartedAt';

export interface UseWalkTimerResult {
  /** Seconds remaining in the walk, or null when not walking. */
  remainingSeconds: number | null;
  /** True while the walk timer is active. */
  isWalking: boolean;
  /** Begin a walk of `walkMinutes` length — persists the start time. */
  start: () => Promise<void>;
  /** Cancel any active walk. */
  cancel: () => Promise<void>;
}

export function useWalkTimer(walkMinutes: number): UseWalkTimerResult {
  const [walkStartedAt, setWalkStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await SecureStore.getItemAsync(WALK_STARTED_KEY);
      if (cancelled) return;
      const ts = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(ts)) setWalkStartedAt(ts);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (walkStartedAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [walkStartedAt]);

  const walkDurationMs = walkMinutes * 60_000;
  const elapsedMs = walkStartedAt == null ? 0 : now - walkStartedAt;
  const isWalking =
    walkStartedAt != null && elapsedMs >= 0 && elapsedMs < walkDurationMs;
  const remainingSeconds = isWalking
    ? Math.max(0, Math.ceil((walkDurationMs - elapsedMs) / 1000))
    : null;

  useEffect(() => {
    if (walkStartedAt != null && !isWalking) {
      SecureStore.deleteItemAsync(WALK_STARTED_KEY).catch(() => {});
      setWalkStartedAt(null);
    }
  }, [walkStartedAt, isWalking]);

  const start = useCallback(async () => {
    const ts = Date.now();
    await SecureStore.setItemAsync(WALK_STARTED_KEY, String(ts));
    setWalkStartedAt(ts);
    setNow(ts);
  }, []);

  const cancel = useCallback(async () => {
    await SecureStore.deleteItemAsync(WALK_STARTED_KEY);
    setWalkStartedAt(null);
  }, []);

  return { remainingSeconds, isWalking, start, cancel };
}
