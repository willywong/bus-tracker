# 13-Rail-Experience / 04 — Line Strip Map

**Build impact:** JS-only (Metro reload)

## Context

- Spec §6.5 and §7.2: a vertical strip map for one line and direction, with a 6 pt line-colour rail, station beads, interchange colour squares, your nearest station as the standing-figure pin, and **estimated trains**. These are dashed-outline discs spaced by the current headway, moving at template run times, static under Reduce Motion, with a caption. Line sheet detents are `[0.6, 1]` (spec §2).
- Network data (spec §3.3): `patterns.stopStart/stopLen/stops`, `runOffset[stopStart + s]` (seconds from first stop), frequency windows `fStart/fEnd/fHeadway` at the first stop. `lineDirections`, `serviceClock` and `boardText` come from 13/01.
- Existing motion to copy: `RouteShimmer` drives one shared value on the UI thread, checks `useReducedMotion()` (`components/map/RouteShimmer.tsx:51`) and cancels on cleanup (`:103`). The "scheduled, not live" encoding is the dashed ring of `GhostBusMarker` (`components/map/BusMarker.tsx:156-171`, style `borderStyle: 'dashed'`, `borderWidth: 2` at `:221-232`). The figure pin is `RouteLayer`'s `pin` + `figure.stand` (`components/map/RouteLayer.tsx:195-206`, styles `:308-316`).
- Libraries: Reanimated 4.7.1 (`useFrameCallback`, `useSharedValue`, `useAnimatedStyle`, `interpolate`, `useReducedMotion` exported from `react-native-reanimated`), `useIsFocused` from `expo-router` (`expo-router/build/exports.d.ts:22`), `@expo/ui` `Picker` + `pickerStyle('segmented')` + `tag()` (used in `app/settings.tsx:130-158`).
- Glyphs (spec §7): LRT/BRT `tram.fill`, MRT/KTM `train.side.front.car`, Monorail `lightrail.fill`.

## Goal

`app/line.tsx` shows the whole line for either direction as a strip map, with estimated trains gliding at timetable spacing from one shared UI-thread clock. No more than 12 animated views on screen, paused when unseen, and static under Reduce Motion.

## Prerequisites

- 13/01 (`lineDirections`, `serviceClock`, `boardText`), 13/03 (`LineBadge`, `/line` links from the station sheet).

## Steps

1. **Register** in `_layout.tsx`, beside `station`: `name="line"`, `presentation: 'formSheet'`, `sheetAllowedDetents: [0.6, 1]`, `sheetGrabberVisible: true`, `sheetLargestUndimmedDetentIndex: 0`, `headerShown: true`, `headerTransparent: true`, `contentStyle: { backgroundColor: SHEET_BACKGROUND }` (`_layout.tsx:37`).
2. **Pure model** `packages/shared/src/transit/strip.ts`:
   ```ts
   export interface StripStation { stopIndex: number; stationId: string | null; name: string; offsetSec: number; otherLineColors: string[] }
   export interface StripModel {
     route: number; pattern: number; towards: string;
     stations: StripStation[]; totalRunSec: number;
     window: { headwaySec: number; startSec: number; endSec: number } | null;  // active window at first stop
     first: number | null; last: number | null;                              // epoch ms
   }
   export function stripModel(net: TransitNetwork, routeIndex: number, dir: 0 | 1, nowEpochMs: number): StripModel | null;
   /** Run times (s since leaving the first stop) of trains on the line at service-second t. */
   export function trainRunTimes(m: StripModel, t: number): number[];
   ```
   `trainRunTimes`: departures on the grid `startSec + k·h ≤ min(t, endSec)`; keep those with `0 ≤ t − dep ≤ totalRunSec`. Trains that left in an earlier window with another headway are ignored; the caption covers the simplification.
3. **Layout helpers** `apps/mobile/components/rail/stripLayout.ts`: `ROW_H = 56`, `beadY(i) = i · ROW_H + ROW_H / 2`, `slotWindow(phaseSec, h, totalRunSec, viewTopY, viewBottomY, offsets): { kMin: number; count: number }` (count ≤ `MAX_TRAINS = 12`, the slots whose current y falls in the viewport ± one row).
4. **Screen** `app/line.tsx`, params `useLocalSearchParams<{ line: string; dir?: string }>()`; resolve `routeIndex` by `net.routes.id`. Toolbar close `xmark` as in `app/stops.tsx:34-36`; `Stack.Screen options={{ title: '' }}`.
   - **Header:** `LineBadge`, full name (`type.title`), `"every 3 mins now"` (from `window.headwaySec` with `mins()`; `"No more trains today"` / `"First 6:00"` when `window` is null), and `"First 6:00 · Last 23:25"` in `type.footnote`.
   - **Caption** under the header, `type.footnote`, `color.secondaryLabel`, exactly: `Trains shown at timetable spacing — Rapid Rail doesn't publish live positions.` For KTM (timetabled) the same component shows `Trains shown at scheduled times — KTM doesn't publish live Komuter positions.`
   - **Direction picker:** `<Host matchContents><Picker selection={dir} onSelectionChange={…} modifiers={[pickerStyle('segmented')]}>` with two `Text` children tagged `0`/`1`, labelled `To Gombak` / `To Putra Heights` (each pattern's `towards`). On change: `haptics.selection()` (a decision; `utils/haptics.ts:21`), `router.setParams({ dir })`.
5. **Strip** `components/rail/StripMap.tsx` inside a `ScrollView` (`contentInsetAdjustmentBehavior="automatic"`):
   - Rail: one absolutely positioned `View`, 6 pt wide, `backgroundColor = line.color`, from the first to the last bead.
   - Beads: 14 pt paper circle with a 3 pt line-colour border at `beadY(i)`, plus name (`type.body`) to the right; interchanges add 8 pt squares (`borderRadius: 2`) in `otherLineColors` after the name.
   - Nearest station: replace its bead with the ink figure pin (28 pt, `figure.stand`, as `RouteLayer.tsx:195-206`). Location: `Location.getLastKnownPositionAsync()` once on open (no prompt, permission comes from `useLocationPermission`), else the trip's `route.userStop`; nearest by `haversineMeters`, shown only within 2 km.
   - Rows are `RowButton`s (`components/ui/RowButton.tsx`) → `router.push({ pathname: '/station', params: { station: stationId } })`.
6. **Estimated trains** `components/rail/EstimatedTrains.tsx`, one shared clock:
   ```ts
   const phase = useSharedValue(initialPhase);   // s since the latest departure, in [0, h)
   const seed = useSharedValue({ phase: initialPhase, at: -1 });   // at = frame timestamp of the seed
   const clock = useFrameCallback(({ timestamp }) => {
     const s = seed.get();
     if (s.at < 0) { seed.set({ phase: s.phase, at: timestamp }); return; }
     phase.set((s.phase + (timestamp - s.at) / 1000) % h);
   }, false);
   ```
   Reseeding (`seed.set({ phase: fromWallClock, at: -1 })`) is how JS hands the UI thread a fresh honest position; the seed makes pause/resume explicit instead of depending on how `timeSinceFirstFrame` behaves across `setActive` toggles.
   - Slot `k ∈ [kMin, kMin + count)` renders one `Animated.View`; its style reads `r = phase.get() + k·h`, sets `translateY = interpolate(r, offsets, beadYs, Extrapolation.CLAMP)` (linear within each segment = template run time), and `opacity` ramps 0→1 over the first and last 15 s of the run, 0 past `totalRunSec`. When `phase` wraps, slot `k` takes the place slot `k − 1` had, so motion is seamless without per-train timers.
   - Disc: 24 pt, paper fill, `borderWidth: 2`, `borderStyle: 'dashed'`, ink border, mode glyph 13 pt in ink, centred on the rail. `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`: the caption and header speak for them.
   - Reseed and recompute `h`, `kMin/count` in JS on: scroll end, the `useTrip().now` 15 s tick (`state/TripContext.tsx:117-121`), window change, direction change. Never per frame.
7. **Pause rules:** `clock.setActive(active)` with `active = isFocused && appState === 'active' && !reduceMotion && window != null`. Trains scrolled out of view are not mounted at all (`slotWindow`). `isFocused` from `useIsFocused()`; `appState` from `AppState.addEventListener('change')`; on resume, reseed from the wall clock so trains jump to the honest position rather than continue from where they paused.
8. **Reduce Motion:** `clock` stays inactive; `phase` is set from the wall clock on each 15 s tick with no transition, giving static dots that move in steps.
9. **Accessibility:** header group label `"Kelana Jaya Line towards Putra Heights, every 3 minutes now. First train 6:00, last train 23:25. Trains shown at timetable spacing."`; each station row `"Pasar Seni, change for Kajang Line"` (+ `", nearest to you"`); Picker labels are the visible text.
10. **Tests**
    - `packages/shared/src/transit/__tests__/strip.test.ts`: `trainRunTimes spaces trains by headway`, `trainRunTimes drops trains past the terminus`, `no trains before the first window`, `after the window ends only running trains remain`, `stripModel lists other-line colours at interchanges`, `stripModel dir 1 reverses the station order`.
    - `apps/mobile/components/rail/__tests__/stripLayout.test.ts`: `slotWindow never exceeds 12 slots`, `slotWindow centres on the viewport`, `beadY is ROW_H-spaced and centred`.

## Verification

- `pnpm --filter @bus-tracker/shared test`, `pnpm --filter mobile test`, `pnpm type-check` all green.
- Device (Metro reload), Kelana Jaya at 08:00: about 12 dashed discs in view, spacing equals the headway, crossing slow and fast segments at different speeds; flip direction with the picker; the caption is present and verbatim.
- Perf: React DevTools shows ≤ 12 `EstimatedTrain` views; Perf Monitor UI thread at 60 fps and JS thread idle while trains move.
- Background the app 2 min → return: trains jump to the current position. Push `station` over `line`: the clock pauses (`isFocused` false).
- Reduce Motion on: discs still, updated every 15 s, no glide. Light/dark: rail, beads and dashed discs legible; yellow PY line keeps ink glyphs readable.
- VoiceOver: the header and station rows read as above; trains are skipped. Dynamic Type XL: names wrap, beads stay on the rail (rows grow, `beadY` uses measured row heights if needed).

## Handoff to next step ([05-entry-points.md](./05-entry-points.md))

- `/line?line=<routeId>&dir=0|1` exists and opens `station` per row.
- `strip.ts` (`stripModel`, `trainRunTimes`) is reusable for 15/06 go-mode rail progress ("about").
- 05 wires the remaining entry points and the map focus (`RailLayer.focus` = this line while the sheet is open).
