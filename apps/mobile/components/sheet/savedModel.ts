import type { SavedPlace } from '@/hooks/useSettings';
import { MAX_PINS } from '@/services/places/saved';

/**
 * The Saved section's model (plan 16/04): your places as a strip of tiles,
 * then your routes as rows. Pure, so the order and the "full" rule are tested
 * without the sheet.
 */

export type PlaceTile =
  | { kind: 'place'; place: SavedPlace; label: string; symbol: 'house.fill' | 'briefcase.fill' | 'mappin' }
  | { kind: 'add'; full: boolean };

/**
 * Home, Work, then pins oldest first (the order they were saved in), then
 * "Add". Add is `full` once six are pinned: it opens Settings instead of search.
 */
export function placeTiles(saved: readonly SavedPlace[]): PlaceTile[] {
  const home = saved.find((p) => p.kind === 'home');
  const work = saved.find((p) => p.kind === 'work');
  const pins = saved.filter((p) => p.kind === 'pin').sort((a, b) => a.createdAt - b.createdAt);
  const tiles: PlaceTile[] = [];
  if (home) tiles.push({ kind: 'place', place: home, label: 'Home', symbol: 'house.fill' });
  if (work) tiles.push({ kind: 'place', place: work, label: 'Work', symbol: 'briefcase.fill' });
  for (const p of pins) tiles.push({ kind: 'place', place: p, label: p.name, symbol: 'mappin' });
  tiles.push({ kind: 'add', full: pins.length >= MAX_PINS });
  return tiles;
}

export type RouteRow = { code: string; stopName: string | null; active: boolean };

/** Your favourite routes in their saved order, each with its boarding stop; the tracked one is active. */
export function routeRows(
  favorites: readonly string[],
  active: string | null,
  stopNames: Record<string, string>,
): RouteRow[] {
  return favorites.map((code) => ({ code, stopName: stopNames[code] ?? null, active: code === active }));
}
