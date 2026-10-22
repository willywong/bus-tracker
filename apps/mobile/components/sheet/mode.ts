/**
 * What the trip sheet shows, from what's going on. Go, an active ride and a
 * stop or bus detail are modes that take the whole sheet; otherwise it shows
 * its sections (Plan · Nearby · Saved). Computed each render, never stored.
 */
export type SheetMode = 'go' | 'ride' | 'detail' | 'sections';

/** Go wins over a ride, a ride over a detail, a detail over the sections. */
export function sheetMode(s: { go: boolean; riding: boolean; detail: boolean }): SheetMode {
  if (s.go) return 'go';
  if (s.riding) return 'ride';
  if (s.detail) return 'detail';
  return 'sections';
}
