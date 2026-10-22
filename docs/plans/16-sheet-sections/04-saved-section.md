# 16-Sheet-Sections / 04 — Saved Section

**Build impact:** JS-only (Metro reload).

## Context
- **From 02:** `components/sheet/SavedSection.tsx` is a stub `({ peek, scheme })` rendered when the section is `saved`. Peek gives 160 pt of section content.
- **Saved places:** `settings.savedPlaces` (`SavedPlace`), at most 6 pins. The rules are in `services/places/saved.ts` (`addPin`, `removePlace`, `placeToPlannerPlace`).
  - Editing (rename, remove, reorder) lives in Settings → `components/settings/PlacesSection.tsx`.
  - `components/plan/PlaceThumb.tsx` renders a `{ lat, lng, size }` map snapshot via `snapshotUri`, cached for 30 days.
- **Your routes:**
  - `settings.favoritedRoutes: string[]` and `settings.preferredStopByRoute`;
  - `settings.preferredRouteCode` is the route the trip sheet tracks;
  - `settings.setPreferredRouteCode(code)` switches it, which is what the map's top-left route menu does.
  - Stop names come from `getStopsByIds` in `db/queries`, as `hooks/useQuickActions.ts` builds "Track T816 · Hotel Lisa De Inn".
- **Settings** opens with `router.push('/settings')`; `FavoritesSection` there has Edit for routes.

## Goal
Saved shows your places as a strip of tiles and your routes as rows. A place plans to it, a route starts tracking it and switches to Nearby, and Edit opens Settings.

## Prerequisites
- 02 merged.
- Invoke `expo:expo-ui` and `apple-design`.
- This task writes only `components/sheet/SavedSection.tsx`, `components/sheet/savedModel.ts` and their tests.

## Data shape
```ts
// components/sheet/savedModel.ts (pure)
export type PlaceTile =
  | { kind: 'place'; place: SavedPlace; label: string; symbol: 'house.fill' | 'briefcase.fill' | 'mappin' }
  | { kind: 'add'; full: boolean };
export function placeTiles(saved: readonly SavedPlace[]): PlaceTile[];
export type RouteRow = { code: string; stopName: string | null; active: boolean };
export function routeRows(favorites: readonly string[], active: string | null, stopNames: Record<string, string>): RouteRow[];
```
- **Tile order:** Home, Work, then pins by `createdAt`. A final `add` tile has `full: true` once there are 6 pins; it then opens Settings instead of search.
- **Route rows** keep `favoritedRoutes` order and mark the active one.

## Steps
1. **Pure model.** Write `placeTiles` and `routeRows`, with tests in `components/sheet/__tests__/savedModel.test.ts`:
   - `home and work lead`
   - `pins follow by createdAt`
   - `add tile is full at 6 pins`
   - `active route is marked`
2. **Places strip.**
   - A horizontal `ScrollView` of 76 × 76 pt tiles: a `PlaceThumb` 44 with the SF Symbol overlaid, and the label below, matching artboard A's Saved grid.
   - The "Add" tile is dashed (`borderStyle: 'dashed'`, `color.hairline`).
   - Tapping a place calls `planner.setTo(toPlace(p))` and `router.push('/plan')`.
   - Tapping "Add" calls `planner.setTo(null)` and `router.push('/plan')`, or `/settings` when full.
3. **Your routes.**
   - Section title "Your routes" with an "Edit" text button on its right that opens `/settings`.
   - Each row is a route badge (the existing outlined route chip style from `SheetHeader`), the boarding stop name, and a checkmark when active.
   - Tapping a row calls `haptics.selection()`, then `settings.setPreferredRouteCode(code)`, then `settings.setSheetSection('nearby')`. This is the one place outside the picker that writes the section. The README allows it, and it is the same setter.
   - Stop names are loaded once per `favoritedRoutes` change from `getStopsByIds`.
4. **Peek.** Render the places strip only, which is about 100 pt.
5. **Empty.** With no places and no routes, show `EmptyState compact` with icon `bookmark`, title "Nothing saved yet" and message "Save a place from trip results, or add a route to track."

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator:**
  - **Tiles.** With Home, Work and 2 pins saved, 4 tiles plus Add show, with snapshots loading.
  - **Tap Work.** `plan` opens to results.
  - **Tap another route.** The sheet switches to Nearby, now tracking that route, and the map's route menu shows it too.
  - **Edit** opens Settings.
  - **At peek**, the strip shows and nothing clips.
- **VoiceOver:**
  - a tile reads "Work, button. Plans a trip";
  - a route row reads "T816, Hotel Lisa De Inn, selected" when it is active.

## Handoff to next step
- `SavedSection` is complete. `placeTiles` and `routeRows` are tested.
- Route switching from Saved writes `preferredRouteCode` and `sheetSection: 'nearby'`.
