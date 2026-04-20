import { useEffect, useState } from "react";
import { bootstrapStaticGtfs, type BootstrapResult } from "@/db/bootstrap";

export interface StaticGtfsState {
  ready: boolean;
  error: Error | null;
  result: BootstrapResult | null;
}

export function useStaticGtfs(): StaticGtfsState {
  const [state, setState] = useState<StaticGtfsState>({
    ready: false,
    error: null,
    result: null,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await bootstrapStaticGtfs({ signal: ctrl.signal });
        if (cancelled) return;
        setState({ ready: true, error: null, result });
      } catch (err) {
        if (cancelled) return;
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
  }, []);

  return state;
}
