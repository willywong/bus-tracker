import type { NearbyView } from '@/state/nearbyStack';

/**
 * What the trip sheet shows, from what's going on. Go, an active ride and a
 * stop or bus detail are modes that take the whole sheet; then Nearby's own
 * views (your bus's trip, a place, a route preview); otherwise it shows its
 * sections (Plan · Nearby · Saved). Computed each render, never stored.
 */
export type SheetMode = 'go' | 'ride' | 'detail' | 'trip' | 'place' | 'preview' | 'sections';

/** Go wins over a ride, a ride over a detail, a detail over a Nearby view, that over the sections. */
export function sheetMode(s: {
  go: boolean;
  riding: boolean;
  detail: boolean;
  /** The Nearby view on top; pass 'list' when Nearby isn't the section. */
  nearby: NearbyView['kind'];
}): SheetMode {
  if (s.go) return 'go';
  if (s.riding) return 'ride';
  if (s.detail) return 'detail';
  if (s.nearby === 'trip') return 'trip';
  if (s.nearby === 'stop' || s.nearby === 'station') return 'place';
  if (s.nearby === 'route') return 'preview';
  return 'sections';
}
