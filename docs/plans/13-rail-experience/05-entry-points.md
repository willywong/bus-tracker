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

## Implementation notes

- **Focus API (for 15/05).** `RailFocus` lives in `components/rail/railFocus.ts` (pure, tested) and is re-exported as a type from `state/TripContext.tsx`.
  - `TripContext` exposes `railFocus: RailFocus | null` and `setRailFocus(owner: string, f: RailFocus | null)`. This differs from the sketch's `setRailFocus(f)`. Focus is a stack of claims, one per owner, and the newest claim wins. `null` releases only that owner's claim.
  - **Why owners.** React Navigation runs the new screen's focus effect and the old screen's blur cleanup in either order. With a single `set(null)` on blur, a station opened over a line could end unfocused, and so could a line once a station over it closes. The `railFocus.test.ts` order test covers both cases.
  - **Screens call `useRailFocus(focus)`** (`hooks/useRailFocus.ts`). It claims under `useId()` from a `useFocusEffect` and releases on blur or unmount. It re-claims only when `railFocusKey(focus)` changes, not when a new object arrives every 15 s.
  - **15/05:** call `useRailFocus({ stationId: null, routeIds: railLegRouteIds, point: null })` in `itinerary`, and don't touch `TripContext` directly.
  - `railFocus` isn't cleared on a route or stop change (step 10), unlike `selection`.
- **Station** focuses its `model.lines[].routeId`s (deduped, non-null) and its lat/lng. **Line** focuses `[model.routeId]` with `point: null`. A missing station or line claims nothing.
- **Map.** `index.tsx` passes `mapRailFocus(railFocus, drawnRouteIds)` to `RailLayer`, keeping only the focused ids that are drawn.
  - The task file doesn't cover the case where none match. Without a rail network the bundled lines are keyed by `RailLine.code` (13/02), and the stations' network ids match nothing. The focus is then null, so every line stays at full strength instead of dropping to 15%.
  - `RailLayer` gains `selectedStationId`. That square is drawn in solid ink with a paper border, at `zIndex` 2 and `displayPriority` 'required', and shows below zoom 12 too. Its label gets ", selected".
  - **Framing.**
    - `frameTrip` frames `focus.point` plus your stop, with bottom padding `(windowHeight − insets.top) · 0.5 + 32`.
    - It no longer needs a route when a point is set, so a cold deep link with no favourites still frames the station.
    - A line focus (`point: null`) keeps the trip framing. The task specifies no line-geometry framing.
    - The re-frame effect is keyed on `stationId ?? routeIds.join()`.
- **Map station taps use `router.navigate`, not `dangerouslySingular`.** This deviates from step 6.
  - In expo-router 58 a singular `station` id is the route name. Its PUSH/NAVIGATE does `findLast`, which would pull a station from under an open `line` sheet to the top of the stack. That's a native modal reorder, e.g. station → badge → line → row → station.
  - `navigate` gets what step 6 asks for without that. With a station sheet on top, NAVIGATE to the same route name updates its params in place (base `StackRouter`). Otherwise it pushes.
  - Connections rows and line rows keep `push`.
- **Trip sheet under deep links.** `containsRoute` and `NavStateLike` moved from `index.tsx` to `components/trip/sheetStack.ts`, alongside `shouldPresentTrip(nav)`. The trip sheet waits behind `station`, `line` or `network`. Every other route behaves as before.
- **Deep links.** `components/rail/deepLink.ts` `railDeepLink(path)` handles three forms: `[scheme://]station/<id>`, `[scheme://]line/<routeId>/<0|1>`, and a leading `/` or a trailing `/`. Ids are decoded and re-encoded, so `rail%3AKJ` stays as it is and `rail:KJ` becomes `rail%3AKJ`. It returns null for:
  - query forms;
  - bare `t816://`;
  - extra segments;
  - bad dirs;
  - malformed `%`.

  `app/+native-intent.tsx` exports `redirectSystemPath`. Unknown slugs still map; the sheet says "Station not found".
- **Step 9 (quick action) skipped**, as the step allows: 15/02 landed first. Adding the item would also change 15/02's "never more than four" contract (`min(4, n + 1)`) and compete with 15/07's Home/Work for the slots. `services/quickActions.ts` and `hooks/useQuickActions.ts` are untouched.
- **Connections.** `onOpenStation?` wraps each row in `RowButton` (hint "Shows departures") and adds a 13 pt `chevron.right` in `color.tertiaryLabel`. Without the prop the rows are unchanged. `app/trip.tsx` and `StopDetailSheet` both push `/station`, with no haptic.
- **`/station` cast removed** in `index.tsx`, along with the unused `Href` import.
- **Tests:**
  - `components/rail/__tests__/deepLink.test.ts` (4, as named);
  - `components/trip/__tests__/sheetStack.test.ts` (3 named, plus 1 for an unready navigator);
  - `components/rail/__tests__/railFocus.test.ts` (5: claim/release, either effect order, no-op identity, key, map focus).
- **Build impact:** JS-only (Metro reload). `+native-intent.tsx` is JS. There are no app.json, plugin or native module changes.
