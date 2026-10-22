import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import type { LatLng } from './searchIndex';

/** A cached fix younger than this is good enough to rank and measure suggestions. */
const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Where you are, for ranking suggestions and their distances; null until a
 * fix arrives or without permission. Never asks for permission itself.
 */
export function useNear(granted: boolean): LatLng | null {
  const [near, setNear] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!granted) return;
    let cancelled = false;
    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS });
        const fix =
          last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (!cancelled && fix) setNear({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      } catch {
        // No fix: suggestions fall back to the Klang Valley box and no distances.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [granted]);
  return near;
}
