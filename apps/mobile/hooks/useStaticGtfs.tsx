import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  bootstrapStaticGtfs,
  pruneRoute,
  type BootstrapResult,
} from "@/db/bootstrap";
import { openDb } from "@/db/database";
import { useSettings } from "@/hooks/useSettings";

export interface StaticGtfsState {
  ready: boolean;
  error: Error | null;
  result: BootstrapResult | null;
  /** Route codes whose most recent fetch attempt failed. */
  failed: ReadonlySet<string>;
  /** Route codes currently being (re)fetched — either initial bootstrap or a user-triggered retry. */
  refreshing: ReadonlySet<string>;
  /** Bumps whenever a bootstrap or retry settles. Consumers that re-query SQLite should depend on this. */
  lastSettledAt: number;
  /** Force-refetches a single route, bypassing the module-level inflight dedupe. */
  retry: (code: string) => Promise<void>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

const StaticGtfsContext = createContext<StaticGtfsState | null>(null);

/**
 * Drives per-favorite GTFS bundle fetching. Runs an initial bootstrap for the
 * user's favorites and re-runs whenever the favorites list changes. When a
 * code is removed from favorites, its rows are pruned from SQLite.
 *
 * Also surfaces per-route failure + retry so the UI can distinguish "no data"
 * from "failed to load" and let the user recover without removing the favorite.
 */
export function StaticGtfsProvider({
  children,
}: {
  children: ReactNode;
}): ReturnType<typeof createElement> {
  const { ready: settingsReady, favoritedRoutes } = useSettings();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [lastSettledAt, setLastSettledAt] = useState(0);
  const prevFavoritesRef = useRef<string[]>([]);

  const favoritesKey = favoritedRoutes.join(",");

  useEffect(() => {
    if (!settingsReady) return;
    const ctrl = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const prev = prevFavoritesRef.current;
        const removed = prev.filter((c) => !favoritedRoutes.includes(c));
        if (removed.length > 0) {
          const db = await openDb();
          for (const code of removed) {
            try {
              await pruneRoute(db, code);
            } catch (err) {
              console.warn(`[gtfs] prune ${code} failed`, err);
            }
          }
          // Pruned codes are no longer favorites — clear any stale failure entries.
          setFailed((prev) => {
            if (prev.size === 0) return prev;
            let changed = false;
            const next = new Set(prev);
            for (const code of removed) {
              if (next.delete(code)) changed = true;
            }
            return changed ? next : prev;
          });
        }
        prevFavoritesRef.current = [...favoritedRoutes];

        // Mark everything about to be attempted as refreshing so consumers
        // can show a spinner rather than a stale "Pick a stop" state.
        setRefreshing((prev) => {
          if (favoritedRoutes.length === 0) return EMPTY_SET;
          const next = new Set(prev);
          for (const code of favoritedRoutes) next.add(code);
          return next;
        });

        const bootstrapResult = await bootstrapStaticGtfs({
          routes: favoritedRoutes,
          signal: ctrl.signal,
        });
        if (cancelled) return;

        const nextFailed = new Set(bootstrapResult.failed);
        setFailed(nextFailed);
        setRefreshing((prev) => {
          // Clear refreshing flags for everything that was part of this run.
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          for (const code of favoritedRoutes) next.delete(code);
          return next;
        });
        setResult(bootstrapResult);
        setError(null);
        setReady(true);
        setLastSettledAt(Date.now());
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setReady(false);
        setRefreshing(EMPTY_SET);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, favoritesKey]);

  const retry = useCallback(async (code: string): Promise<void> => {
    setRefreshing((prev) => {
      if (prev.has(code)) return prev;
      const next = new Set(prev);
      next.add(code);
      return next;
    });
    try {
      const bootstrapResult = await bootstrapStaticGtfs({
        routes: [code],
        force: true,
      });
      const succeeded = !bootstrapResult.failed.includes(code);
      setFailed((prev) => {
        const next = new Set(prev);
        if (succeeded) next.delete(code);
        else next.add(code);
        return next;
      });
      setResult((prev) => {
        if (!prev) return bootstrapResult;
        const maxGen = Math.max(
          prev.generatedAt ?? 0,
          bootstrapResult.generatedAt ?? 0,
        );
        return {
          refreshed: Array.from(
            new Set([...prev.refreshed, ...bootstrapResult.refreshed]),
          ),
          failed: Array.from(
            new Set([
              ...prev.failed.filter((c) => c !== code),
              ...bootstrapResult.failed,
            ]),
          ),
          generatedAt: maxGen > 0 ? maxGen : null,
        };
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setFailed((prev) => {
        const next = new Set(prev);
        next.add(code);
        return next;
      });
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setRefreshing((prev) => {
        if (!prev.has(code)) return prev;
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
      setLastSettledAt(Date.now());
    }
  }, []);

  const value = useMemo<StaticGtfsState>(
    () => ({
      ready,
      error,
      result,
      failed,
      refreshing,
      lastSettledAt,
      retry,
    }),
    [ready, error, result, failed, refreshing, lastSettledAt, retry],
  );

  return createElement(StaticGtfsContext.Provider, { value }, children);
}

export function useStaticGtfs(): StaticGtfsState {
  const ctx = useContext(StaticGtfsContext);
  if (!ctx) {
    throw new Error("useStaticGtfs must be used within <StaticGtfsProvider>");
  }
  return ctx;
}
