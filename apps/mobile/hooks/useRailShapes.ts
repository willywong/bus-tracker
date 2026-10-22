import { useEffect, useState } from 'react';
import type { TransitNetwork } from '@bus-tracker/shared';

import { openDb } from '@/db/database';
import { loadRailShapes } from '@/db/railShapesStore';

const EMPTY: ReadonlyMap<string, Float32Array> = new Map();

/**
 * The stored rail line geometry (`rail_shapes`), by network route id. Read
 * on mount and again whenever `network` changes: a refresh writes the shapes
 * before the new network is loaded, so the two arrive together. A failed read
 * keeps what was there; the rail layer then draws station to station.
 */
export function useRailShapes(network: TransitNetwork | null): ReadonlyMap<string, Float32Array> {
  const [shapes, setShapes] = useState<ReadonlyMap<string, Float32Array>>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    openDb()
      .then(loadRailShapes)
      .then((next) => {
        if (cancelled) return;
        setShapes((prev) => (sameShapes(prev, next) ? prev : next));
      })
      .catch((err) => console.warn('[rail-shapes] load failed', err));
    return () => {
      cancelled = true;
    };
  }, [network]);
  return shapes;
}

/** Same routes and points: keeps the map's overlays from being re-added for nothing. */
function sameShapes(a: ReadonlyMap<string, Float32Array>, b: ReadonlyMap<string, Float32Array>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) {
    const w = a.get(k);
    if (!w || w.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) if (w[i] !== v[i]) return false;
  }
  return true;
}
