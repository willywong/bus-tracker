import type { Itinerary } from '@bus-tracker/shared';
import { useEffect, useRef } from 'react';

import { walkRequests } from '@/components/map/itineraryGeometry';
import { mapsErrorCode, walk } from '@/modules/transit-maps';
import { usePlanner } from '@/state/PlannerContext';

/**
 * Apple's walking paths for the open itinerary's walks (spec §5, 15/05):
 * one `walk()` per walk leg of 40 m or more, at most four, one at a time,
 * each stored in `planner.walkPaths` as it arrives. Only the opened
 * itinerary is ever asked for, once per id. Offline, throttled, no path (or
 * no module, off iOS): the walk stays a straight dotted line, silently.
 */
export function useWalkPaths(it: Itinerary | null): void {
  const { walkPaths, setWalkPath } = usePlanner();
  const latest = useRef({ it, have: it ? walkPaths[it.id] : undefined });
  latest.current = { it, have: it ? walkPaths[it.id] : undefined };
  const id = it?.id ?? null;

  useEffect(() => {
    const { it: open, have } = latest.current;
    if (!open || id == null) return;
    const wanted = walkRequests(open).filter((r) => !have?.[r.index]);
    if (wanted.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const r of wanted) {
        if (cancelled) return;
        try {
          const path = await walk(r.from, r.to);
          if (cancelled) return;
          if (path.coords.length >= 2) setWalkPath(id, r.index, path.coords);
        } catch (e) {
          // Throttled: asking for the next walk now would be throttled too.
          if (mapsErrorCode(e) === 'ERR_THROTTLED') return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, setWalkPath]);
}
