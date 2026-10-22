# 15-Journey-Planner-UI / 03 — Plan Search Sheet

**Build impact:** JS-only (Metro reload)

## Context
- 02 registered `plan` as a full-height formSheet with a transparent header titled "Where to?" (`app/_layout.tsx`). It added `PlannerContext` (`from`, `to`, `when`) and pins the trip sheet at peek while `plan` is up.
- Spec §6.2 search state, in order:
  1. a searchable field;
  2. **From** ("My location", tappable, with a ⇅ swap);
  3. **When** (`Menu`: Leave now / Depart at… / Arrive by… disabled "Soon");
  4. Recents (6), Saved (Home, Work, ≤ 6 pins), then suggestions.

  Stations and stops come first, offline. Apple places follow (spec §5).
- `useTransitNetwork()` (phase 12) returns `{ network, health, status }`.
  - `network.stations` is `RailStation[]`, with `lines[].color` (`packages/shared/src/utils/rail.ts:8-34`).
  - `network.stops.name` / `.station` and `network.stopRoutes` give the routes per stop (spec §3.3).
- 01 provides `complete()` / `resolve()` and `placeSymbol()`. A completion carries only `title` and `subtitle`, with no coordinate or category, so category glyph and distance appear only once a completion is resolved.
- **Search field: `Stack.SearchBar`, not `@expo/ui` `searchable`.** Reasons:
  - `searchable` (`node_modules/@expo/ui/build/swift-ui/modifiers/searchable.d.ts:52-56`) attaches to a SwiftUI view inside a `NavigationStack` in a `Host` (its own example, :33-49). The whole result list would then have to be SwiftUI. Our rows need React Native: proportional journey bars, the Reanimated stagger (§7.5) and the bead loader (§7.7).
  - Its `onChange` doesn't fire for values written from JS (:22-23), and it has no imperative focus or setText.
  - `Stack.SearchBar` (`node_modules/expo-router/build/layouts/stack-utils/StackSearchBar.d.ts:30`) is the native header search bar. It is already proven in a formSheet (`app/add-route.tsx:111-116`, `autoFocus`, `hideWhenScrolling={false}`). Its `ref` exposes `SearchBarCommands` (`focus`, `blur`, `setText`, `clearText`; `node_modules/react-native-screens/lib/typescript/types.d.ts:13-20`), which picking a recent or swapping needs.
  - `searchToolbarBehavior('minimize')` (`searchable.d.ts:83`) is iOS 26 toolbar chrome and is not used.
- Calm Mono rows:
  - `SectionLabel` (`components/trip/Rows.tsx:14`) over `Hairline` rows (:41);
  - glyphs are SF Symbols via `expo-symbols`;
  - minutes are plural past one (`mins()`, `components/trip/model.ts:664`);
  - distances use `formatDistance` (`components/map/format.ts:86`).
- The memory note's glass-menu pattern (`Menu` with a ReactNode `HStack` label, `glassEffect` on the `HStack`) is the only menu trigger that renders icon + text reliably.

## Goal
`app/plan.tsx` search state. Typing shows local stations and stops within one frame and Apple places within about 300 ms. Picking one sets `planner.to` and hands over to the results state (04). From, swap and When work. Recents persist. In airplane mode, stations and stops still work.

## Prerequisites
- 02 merged. Phase 12 `useTransitNetwork` available. Phase 13 for station line colours (falls back to `RailStation.lines`, which already exist).
- Invoke `expo:expo-ui`, `expo:expo-router`, `apple-design`.

## Steps

1. **Local index (pure).** In `components/plan/searchIndex.ts`:
   ```ts
   export type LocalHit =
     | { kind: 'station'; id: string; name: string; lat: number; lng: number; lineColors: string[]; lineCount: number }
     | { kind: 'stop'; id: string; name: string; lat: number; lng: number; routes: string[] };
   export function buildLocalIndex(net: TransitNetwork, stations: readonly RailStation[]): LocalIndex;
   export function searchLocal(ix: LocalIndex, query: string, near: LatLng | null, limit = 6): LocalHit[];
   ```
   - Normalise by lower-casing, folding accents, stripping punctuation and collapsing spaces.
   - Stop entries are grouped by display name within 150 m, so both sides of a road appear once. Use the nearer one to `near`.
   - Stops whose `station ≥ 0` are left out, because the station row covers them.
   - Rank: whole-name prefix > word prefix > substring. Stations win ties, then the nearer entry.
   - `routes` are unique route labels from `stopRoutes` → `patterns.route` → `routes.label`, capped at 3 plus a count.
   - Build once per `network.meta.builtAt` in a `useMemo`. The build target is < 30 ms on iPhone 13; log it in dev.

2. **Index tests.** Add `components/plan/__tests__/searchIndex.test.ts` using a small hand-built network fixture:
   - `prefix beats substring`
   - `station outranks a stop with the same name`
   - `stops in a station are folded into it`
   - `twin stops across a road appear once`
   - `nearer wins a tie`
   - `empty query returns nothing`

3. **Recents.** In `services/places/recents.ts`:
   - Storage key: SecureStore `bt.planRecents`, holding JSON `RecentPlace[]` where `RecentPlace = Place & { usedAt: number }`.
   - Pure `mergeRecent(list, place, now): RecentPlace[]` dedupes by `ref` or by coordinates rounded to 4 dp, puts the newest first and caps at 6.
   - Add `loadRecents()` and `saveRecents()`.
   - Tests in `services/places/__tests__/recents.test.ts`:
     - `newest first`
     - `dedupes by ref`
     - `dedupes by rounded coords`
     - `caps at six`

   SecureStore matches how settings persist (`hooks/useSettings.ts:182-190`) and needs no SQLite migration.

4. **Place search.** The debounce, supersede and resolve-top-3 logic goes in a pure `services/places/placeSearch.ts`: `createPlaceSearch({ complete, resolve, schedule })`, with the module calls and timers injected. Test it in `services/places/__tests__/placeSearch.test.ts`:
   - `debounces keystrokes`
   - `drops superseded batches`
   - `resolves only the top three after idle`
   - `offline error clears places`

   The hook is a thin wrapper, because the test glob skips `hooks/`. `hooks/usePlaceSearch.ts(query: string, near: LatLng | null)` returns `{ places: PlaceHit[]; offline: boolean; loading: boolean }`, where `PlaceHit = Completion & { symbol: SFSymbol; meters: number | null; resolved?: ResolvedPlace }`.
   - Debounce by 120 ms and skip queries shorter than 2 characters.
   - Call `complete(query, near ? 20 km box : KLANG_VALLEY)` and drop superseded batches.
   - After 400 ms with no typing, `resolve()` the top 3 one after another. Fill in `placeSymbol(category)` and the distance from `near` (haversine).
   - `ERR_OFFLINE` sets `offline: true` and clears `places`.

5. **Screen header.** `app/plan.tsx` renders:
   ```tsx
   <Stack.SearchBar ref={searchRef} placeholder="Search places, stations, stops" placement="stacked"
     autoFocus={planner.to == null} hideWhenScrolling={false} autoCapitalize="none"
     onChangeText={(e) => setQuery(e.nativeEvent.text)} onSearchButtonPress={pickFirst} />
   <Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} /></Stack.Toolbar>
   ```
   The body is an RN `ScrollView` with `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`, horizontal padding `MARGIN` and `contentInsetAdjustmentBehavior="automatic"`.

6. **From row and swap.** `components/plan/FromWhen.tsx`:
   - The From row has a `location.fill` glyph, then "From", then the name ("My location" when `from.kind === 'here'`).
   - Tapping it sets `editing = 'from'`. The search bar then edits the start point: `searchRef.current?.setText('')` and focus. Picking a result sets `planner.setFrom`.
   - A 44pt `arrow.up.arrow.down` button on the trailing edge calls `planner.swap()` with `haptics.selection()`. Its label is "Swap start and destination".
   - "My location" is resolved at plan time (04).
   - If foreground location permission isn't granted, the row reads "Choose a starting point" in secondary ink. A tap asks for permission in context (`Location.requestForegroundPermissionsAsync`), never at launch.

7. **When menu.** Use the memory glass-menu pattern in a `Host matchContents`:
   - The `Menu` label is an `HStack` holding `clock` + label + `chevron.down`, with `padding({ horizontal: 14, vertical: 8 })` and `glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })`.
   - Items:
     - `Button` "Leave now" (`checkmark` when active);
     - `Button` "Depart at…";
     - `Button` "Arrive by… · Soon" with `disabled()`.
   - "Depart at…" reveals an inline `DatePicker` row under the menu (`DatePicker/index.d.ts`: `selection`, `range`, `displayedComponents`, `onDateChange`):
     - `displayedComponents={['date', 'hourAndMinute']}`;
     - `range={{ start: now, end: networkEnd }}`. `networkEnd` is 04:00 MYT at the end of the next service day. The service day switches at 04:00, and `useTransitNetwork` serves `serviceDate(now − 4 h)` plus the next day (spec §3.5, phase 12/06);
     - `datePickerStyle('compact')`.

     It writes `planner.setWhen({ kind: 'depart', at })`.
   - The label reads "Leave now" or "Depart 08:40" (`formatClockHHMM`).

8. **Rows.** In `components/plan/SuggestionRow.tsx`: a `Pressable` row, min height 52, with a 24pt leading glyph column (the same width as `ROW_ICON`, `Rows.tsx:23`) and a `Hairline inset={ROW_ICON_INSET}` between rows.
   - **Station:** line-colour squares (8pt, radius 2, up to 4, then "+n"), the name (`type.body`), and "3 lines" (`type.footnote`, secondary).
   - **Stop:** `bus.fill` glyph, the name, and the routes ("T816 · T815 · +2").
   - **Place:** the `symbol` glyph (generic `mappin` until resolved), title, subtitle on one line (secondary), and the trailing distance once known.
   - **Recent:** `clock.arrow.circlepath`, otherwise the same as its kind.
   - **Saved:** `house.fill` / `briefcase.fill` / `mappin`. Snapshots arrive in 07.
   - `accessibilityLabel`: "Station, Pasar Seni, 2 lines" / "Bus stop, Hotel Lisa De Inn, routes T816 and T815" / "Place, Pavilion Kuala Lumpur, Bukit Bintang, 1.2 kilometres".

9. **Sections.**
   - Empty query: "Recent" (≤ 6) then "Saved" (Home, Work, pins from `settings.savedPlaces`). If both are empty, show one quiet line: "Search for a station, a stop or a place."
   - While typing: "Stations and stops" (instant, ≤ 6), then "Places" (≤ 8).
   - Offline: the Places section is one row with `wifi.slash`: "Places need a connection".
   - Network not ready (`status !== 'ready'`): the local section is one row, "Stations appear once today's timetable has downloaded."
   - No match at all: `ContentUnavailableView` (`systemImage="magnifyingglass"`, `title={\`No results for "${q}"\`}`, `description="Try a station, a stop or a place name."`), as at `app/add-route.tsx:171`.

10. **Picking.**
    - A local hit becomes a `Place` of `kind: 'station' | 'stop'` with `ref: id`.
    - A place hit calls `resolve(id)` if it isn't resolved yet. On `ERR_OFFLINE`, keep the sheet and switch the Places section to the offline row. On success it becomes `kind: 'place'`.
    - Then `planner.setTo(place)` (or `setFrom` when editing From), `saveRecents(mergeRecent(…))`, `searchRef.current?.setText(place.name)`, `blur()`, and `haptics.selection()`.
    - `plan.tsx` switches to the results state when `planner.to != null && !editing`. 04 renders that state. Until then, show the name and address only.

11. **Preset destination.** When `plan` opens with `planner.to` already set (a Home circle or a recent), skip `autoFocus` and go straight to results. Tapping the search bar clears `to` and returns to the search state.

## Verification
- `pnpm --filter mobile test`: `searchIndex.test.ts`, `recents.test.ts` and `placeSearch.test.ts` pass.
- `pnpm type-check`.
- Device (iPhone 13, network built):
  - Typing "pasar" shows Pasar Seni (station squares) on the first keystroke frame.
  - "klcc" shows places within about 300 ms, and the top 3 gain glyph and distance shortly after.
  - Fast typing never flashes stale place rows.
- From and swap: set a destination, swap, and the From row shows it. Swap again restores. Swap with no destination does nothing.
- When: "Depart at…" shows the compact DatePicker, limited to today and tomorrow. "Arrive by… · Soon" is greyed out and can't be tapped.
- Relaunch: Recents keeps the last 6 picks, newest first.
- Airplane mode: stations and stops still match, and Places shows "Places need a connection" (success criterion 6).
- Location permission denied: From reads "Choose a starting point", and no prompt appears until it's tapped.
- VoiceOver: each row reads as in step 8, and the swap button is labelled.

## Handoff to next step ([04-results-list.md](./04-results-list.md))
- `planner.from`, `planner.to` and `planner.when` are set by real UI. `plan.tsx` has a results slot that renders once `to` is chosen.
- `searchLocal`, `usePlaceSearch`, recents and `SuggestionRow` are reusable. 07 reuses the Saved section and `SuggestionRow`.
- Known gap: an Apple place shows a category glyph and distance only after `resolve()`, top 3 only.
