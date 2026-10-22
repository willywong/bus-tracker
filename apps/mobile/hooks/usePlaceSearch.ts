import { useEffect, useRef, useState } from 'react';

import { complete, KLANG_VALLEY, mapsErrorCode, resolve, type LatLng } from '@/modules/transit-maps';
import {
  createPlaceSearch,
  EMPTY_PLACES,
  type PlaceSearch,
  type PlaceSearchState,
} from '@/services/places/placeSearch';

export type { PlaceHit } from '@/services/places/placeSearch';

const schedule = (fn: () => void, ms: number) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

/**
 * Apple place suggestions for `query` (spec §5): debounced, superseded
 * batches dropped, the top 3 resolved for a glyph and distance once typing
 * pauses. The rules live in `services/places/placeSearch.ts`.
 */
export function usePlaceSearch(
  query: string,
  near: LatLng | null,
): PlaceSearchState & { reportOffline: () => void } {
  const [state, setState] = useState<PlaceSearchState>(EMPTY_PLACES);
  const search = useRef<PlaceSearch | null>(null);

  useEffect(() => {
    const s = createPlaceSearch(
      { complete, resolve, schedule, errorCode: mapsErrorCode, fallbackRegion: KLANG_VALLEY },
      setState,
    );
    search.current = s;
    return () => {
      s.dispose();
      search.current = null;
    };
  }, []);

  // `near` only matters per query, so a GPS fix arriving mid-typing doesn't
  // restart the search.
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    search.current?.setQuery(query, nearRef.current);
  }, [query]);

  const reportOffline = useRef(() => search.current?.reportOffline()).current;
  return { ...state, reportOffline };
}
