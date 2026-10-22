# 13-Rail-Experience / 05 — Entry Points

**Build impact:** JS-only (Metro reload)

## Context

- `Connections` (`apps/mobile/components/trip/Connections.tsx:20-58`) lists rail stations near a stop as plain, non-tappable `View` rows with a full VoiceOver label (`:28-36`). It is rendered by the trip sheet (`app/trip.tsx:371-375`) and the stop detail (`components/detail/DetailSheet.tsx:100-104`). Station ids are `RAIL_STATIONS` slugs (`packages/shared/src/data/rail-stations.ts`).
- Map selection: `MapSelection` is `stop | bus` (`state/TripContext.tsx:96`). `select()` swaps the trip sheet into `DetailSheet` and toggles off on a repeat pick (`:126-135`); a route or stop change clears it (`:137-140`). `index.tsx` frames a selection through `selectedPoint` (`index.tsx:193-204`) and re-frames when it changes (`:275-282`).
- Sheet presentation: `usePresentTripSheet` (`index.tsx:531-540`) pushes `/trip` whenever it is not on the stack; `unstable_settings.initialRouteName = 'index'` (`_layout.tsx:31-33`) keeps the map under deep links.
- Deep links: scheme `t816` (`apps/mobile/app.json`). Today only bare `t816://` is used (Live Activity `hooks/useBusLiveActivity.ts:122, 198`; widget `widgets/NextBusWidget.tsx:205-224`). Expo Router supports `app/+native-intent.tsx` with `redirectSystemPath` (`expo-router/build/types.d.ts:28-47`).
- Quick actions: `hooks/useQuickActions.ts:20-68`, up to `MAX_ACTIONS = 4` (`:13`), one "Track <route>" per favourite; mounted in `AppStack` (`_layout.tsx:66`).
- `RowButton` (`components/ui/RowButton.tsx:9-35`) is the pressed-state row; `LinkRow` shows the chevron pattern (`components/trip/Rows.tsx:180-213`).

## Goal

Every place a station appears opens it: Connections rows, map station squares, deep links `t816://station/<id>` (and `t816://line/<routeId>/<dir>`), plus an optional "Nearest station" quick action. While `station` or `line` is open, the map focuses that station or line.

## Prerequisites

- 13/02 (`RailLayer` with `focus`, `onStationPress`), 13/03 (`/station`), 13/04 (`/line`).

## Steps

1. **Connections rows open stations.** Add `onOpenStation?: (stationId: string) => void` to `Connections`. When set, wrap each row in `RowButton` and append a `chevron.right` 13 pt `color.tertiaryLabel` glyph, as `LinkRow` does. Keep the existing label and add `accessibilityHint="Shows departures"`. Without the prop the rows stay static, so nothing else changes.
2. **Call sites** pass `(id) => router.push({ pathname: '/station', params: { station: id } })`: `app/trip.tsx:373` and `components/detail/DetailSheet.tsx:102` (add `useRouter` from `expo-router`). No haptic: this is navigation.
3. **Rail focus in `TripContext`, separate from `MapSelection`.** Stations are their own sheet, not a trip-sheet detail. Adding them to `MapSelection` would route them into `DetailSheet` and inherit its toggle-off and clear-on-route-change rules. Add:
   ```ts
   export interface RailFocus { stationId: string | null; routeIds: string[]; point: LatLng | null }
   // TripContextValue (TripContext.tsx:57-93)
   railFocus: RailFocus | null;
   setRailFocus: (f: RailFocus | null) => void;
   ```
   Plain `useState` in `TripProvider`, included in the memoised value next to `selection`.
4. **Screens own their focus.** In `app/station.tsx` and `app/line.tsx` use `useFocusEffect` (`expo-router`) to call `setRailFocus(...)` on focus and `setRailFocus(null)` in its cleanup. Station: `routeIds` = the network route ids of its lines, `point` = station lat/lng. Line: `routeIds = [routeId]`, `point = null`. A station opened over a line re-focuses, and closing it restores the line's focus.
5. **Map reacts** in `app/index.tsx`:
   - `RailLayer focus={trip.railFocus?.routeIds ?? null}` and `selectedStationId={trip.railFocus?.stationId ?? null}` (draw it solid ink, like the selected stop in `RouteLayer.tsx:139-146`).
   - In `frameTrip` (`index.tsx:209-248`), when `railFocus.point` is set, frame that point plus your stop, with `bottom` padding `(windowHeight − insets.top) · 0.5 + 32`, the station sheet's 0.5 detent.
   - Add an effect like `index.tsx:275-282` keyed on `railFocus?.stationId ?? railFocus?.routeIds.join()`: `setUserPanned(false); frameRef.current(true)`. Clearing focus re-frames the trip.
6. **Map station taps:** `onStationPress={(id) => router.push({ pathname: '/station', params: { station: id } })}`. Mark the `station` screen `dangerouslySingular` (expo-router `useScreens.d.ts:29`) so tapping another square while the sheet is open at 0.5 reuses the one sheet instead of stacking. Confirm on device that the params update.
7. **Keep the trip sheet under deep links.** A cold `t816://station/…` builds `[index, station]`, and `usePresentTripSheet` would then push `trip` **over** the station. Make it wait while a rail sheet is open, and present `trip` once those close.
   - Move `containsRoute` (`index.tsx:520-525`) into a pure `components/trip/sheetStack.ts` with `shouldPresentTrip(nav: NavStateLike): boolean`: `true` only when no `trip`, `station`, `line` (or, later, `network`) route is on the stack.
   - `usePresentTripSheet` (`index.tsx:531-540`) calls it; behaviour for every existing route is unchanged.
8. **Deep links.** Pure parser `apps/mobile/components/rail/deepLink.ts`:
   ```ts
   export function railDeepLink(path: string): string | null
   // 'station/pasar-seni'            → '/station?station=pasar-seni'
   // 't816://station/pasar-seni'     → same
   // 'line/rail%3AKJ/1'              → '/line?line=rail%3AKJ&dir=1'
   // anything else                    → null (leave untouched)
   ```
   `app/+native-intent.tsx`: `export function redirectSystemPath({ path }) { try { return railDeepLink(path) ?? path; } catch { return path; } }`. Bare `t816://` from the Live Activity and widget passes through unchanged. Query forms (`t816://station?station=…`) already work through file routing.
9. **Quick action (optional, skip if 15/02 lands first).** In `useQuickActions`, when `favoritedRoutes.length < MAX_ACTIONS`, append `{ id: 'nearest-station', title: 'Nearest station', icon: 'symbol:tram.fill', params: { station: 'nearest' } }`. In the handler (`useQuickActions.ts:30-33`), when `params.station === 'nearest'`, get `Location.getLastKnownPositionAsync()`, then `nearbyRailStations(point, { radiusMeters: 2000, limit: 1 })` (`packages/shared/src/utils/rail.ts:59-80`), and `router.push` the station; with no fix or no hit, do nothing. 15/02's "Where to?" quick action takes priority for the slot.
10. **Edge cases to handle, not design around:**
    - Unknown slug in a link → `station` shows its "Station not found" state (03); no redirect.
    - Rail feed expired → links still open (bundled `RAIL_STATIONS`); boards read "Timetable unavailable".
    - Route or stop switched while a station is open → `railFocus` stays (it is owned by the open sheet, not the trip), unlike `selection`, which `TripContext.tsx:137-140` clears.
11. **Tests**
    - `apps/mobile/components/rail/__tests__/deepLink.test.ts`:
      - `station path with and without scheme maps to /station?station=`
      - `line path maps routeId and dir, encoding preserved`
      - `bare t816:// and unknown paths return null`
      - `invalid dir (not 0/1) returns null`
    - `apps/mobile/components/trip/__tests__/sheetStack.test.ts`:
      - `presents trip on a bare [index] stack`
      - `waits while station or line is on the stack`
      - `does not present when trip is already nested`

## Verification

- `pnpm --filter mobile test`, `pnpm --filter @bus-tracker/shared test`, `pnpm type-check` all green.
- Device (Metro reload):
  - Trip sheet → large → "Rail nearby" row → station opens; the map focuses that station's lines (others at 15%) and frames it above the 0.5 sheet; close → lines return to full and the camera re-frames the trip.
  - Tap two different map squares in a row → one station sheet with updated content.
  - `xcrun simctl openurl booted "t816://station/pasar-seni"` cold and warm → map, then the station sheet on top; the trip sheet returns after closing it. `t816://` still opens the trip (Live Activity tap).
  - `xcrun simctl openurl booted "t816://line/rail%3AKJ/1"` → line sheet, direction 1.
  - Quick action (if built) with location off → nothing happens, no crash.
- VoiceOver: Connections rows announce as buttons with the hint. Light/dark and Dynamic Type XL: the chevron stays visible and the row wraps.

## Handoff to next step ([06-network-diagram-stretch.md](./06-network-diagram-stretch.md))

- Entry contract for phase 15: push `/station?station=<slug>` or `/line?line=<routeId>&dir=0|1`; deep links `t816://station/<id>` and `t816://line/<routeId>/<dir>`.
- `TripContext.railFocus` is the one place map focus lives; 15/05's itinerary view sets it with its rail legs' route ids.
- Phase 13's required scope ends here. 06 is optional.
