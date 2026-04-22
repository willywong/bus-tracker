import type { RouteSearchHit } from "@bus-tracker/shared";
import { useEffect, useRef, useState } from "react";
import { searchRoutes } from "@/services/routesSearch";

const DEBOUNCE_MS = 250;

export interface RouteSearchState {
  results: RouteSearchHit[];
  loading: boolean;
  error: Error | null;
}

const EMPTY: RouteSearchState = {
  results: [],
  loading: false,
  error: null,
};

export function useRouteSearch(query: string): RouteSearchState {
  const [state, setState] = useState<RouteSearchState>(EMPTY);
  const trimmed = query.trim();

  // Guard state updates against an unmounted consumer.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (trimmed.length === 0) {
      setState(EMPTY);
      return;
    }

    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const timer = setTimeout(() => {
      (async () => {
        try {
          const hits = await searchRoutes(trimmed, ctrl.signal);
          if (ctrl.signal.aborted || !mountedRef.current) return;
          setState({ results: hits, loading: false, error: null });
        } catch (err) {
          if (ctrl.signal.aborted || !mountedRef.current) return;
          if (err instanceof Error && err.name === "AbortError") return;
          setState({
            results: [],
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed]);

  return state;
}
