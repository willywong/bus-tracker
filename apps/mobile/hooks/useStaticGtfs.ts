import { useEffect, useRef, useState } from "react";
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
}

/**
 * Drives per-favorite GTFS bundle fetching. Runs an initial bootstrap for the
 * user's favorites and re-runs whenever the favorites list changes. When a
 * code is removed from favorites, its rows are pruned from SQLite.
 */
export function useStaticGtfs(): StaticGtfsState {
  const { ready: settingsReady, favoritedRoutes } = useSettings();
  const [state, setState] = useState<StaticGtfsState>({
    ready: false,
    error: null,
    result: null,
  });
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
        }
        prevFavoritesRef.current = [...favoritedRoutes];

        const result = await bootstrapStaticGtfs({
          routes: favoritedRoutes,
          signal: ctrl.signal,
        });
        if (cancelled) return;
        setState({ ready: true, error: null, result });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setState({
          ready: false,
          error: err instanceof Error ? err : new Error(String(err)),
          result: null,
        });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, favoritesKey]);

  return state;
}
