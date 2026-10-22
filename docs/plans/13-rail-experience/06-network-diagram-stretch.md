# 13-Rail-Experience / 06 — Network Diagram (Stretch)

**Build impact:** Native — npx expo prebuild + Xcode build

> **Optional.** Phase 13 is complete without this task (README success criteria 1–6). Start it only after 01–05 ship and there is appetite for a native rebuild. It adds `react-native-svg`, the phase's only new native dependency (spec §7, "No new native animation libraries… a full schematic network diagram is a stretch item").

## Context

- No SVG library is installed (`node_modules/react-native-svg` absent); `@expo/ui` has no `Path`/`Canvas` (only `Rectangle`, `RoundedRectangle`, `Ellipse`, `Capsule`, `Circle` in `@expo/ui/build/swift-ui/Shapes/index.d.ts`). A schematic needs real paths and text, hence `react-native-svg`.
- Gestures: `react-native-gesture-handler` 3.3.0 exports the hook API, including `usePinchGesture`, `usePanGesture`, `useTapGesture` and `useSimultaneousGestures` (`lib/typescript/v3/index.d.ts:7`). The pattern in this repo is `components/trip/EdgeSwipeBack.tsx:36-68`: worklet callbacks write shared values, `scheduleOnRN` (react-native-worklets) crosses to JS once, and `GestureHandlerRootView` wraps the detector.
- Data: 8 lines and 160 stations in `RAIL_LINES` / `RAIL_STATIONS` (`packages/shared/src/data/rail-stations.ts:9-18`), plus KTM Komuter stations inside the Klang Valley box from phase 12 (`network.stations`, mode `KTM`).
- OTA: `runtimeVersion.policy = "appVersion"` with EAS Updates (`apps/mobile/app.json`). JS that imports `react-native-svg` must not reach binaries built without it.
- Entry: the More menu in `MapToolbar` (`app/index.tsx:489-514`); sheets are registered in `_layout.tsx` with `SHEET_BACKGROUND` (`:37`).

## Goal

A hand-authored, octilinear schematic of KL rail (8 lines + KTM Komuter), pinch-zoomable and pannable, where tapping a station opens the station sheet. VoiceOver users get an equivalent list.

## Prerequisites

- 13/01–05 merged and released. A Mac with Xcode for the native build.

## Steps

1. **Install and rebuild.**
   - `cd apps/mobile && npx expo install react-native-svg` (SDK 58 pins the version).
   - Bump `expo.version` in `app.json` (e.g. `1.1.0` → `1.2.0`) so the `appVersion` runtime keeps this JS away from older binaries.
   - `npx expo prebuild -p ios`, then build `ios/BusBuddy.xcworkspace` in Xcode on device.
2. **Coordinates file** `apps/mobile/components/rail/diagram/klRailDiagram.ts` (hand-authored, no runtime projection):
   ```ts
   export const GRID = 24;                                  // points per grid unit at scale 1
   export interface DiagramStation { id: string; x: number; y: number;  // grid units
     label: { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' } }
   export interface DiagramLine { code: string; color: string; branches: string[][] }  // station ids in order
   export const DIAGRAM_STATIONS: readonly DiagramStation[];
   export const DIAGRAM_LINES: readonly DiagramLine[];       // AG, SP, KJ, KG, PY, MR, BRT, SA, KTM Seremban, KTM Port Klang
   ```
   - Rules: every segment horizontal, vertical or 45°; interchanges share one station point; the KL Sentral / Pasar Seni / Masjid Jamek core uses the same relative layout as the official Rapid KL map; labels never cross lines (checked by eye at scale 1 and 2).
   - Ids are the `RAIL_STATIONS` slugs, plus the phase 12 KTM slugs.
   - Authoring order, so the file stays reviewable:
     1. Place the city-core interchanges first (KL Sentral, Pasar Seni, Masjid Jamek, Hang Tuah, Bukit Bintang, Chan Sow Lin, Ampang Park, Bandaraya, Putra Heights, USJ 7, Subang Jaya).
     2. Run each line between its interchanges on the 45° grid, one entry per station in code order.
     3. Add KTM last, running parallel to KJ where they share a corridor (Subang Jaya).
     4. Nudge labels only; do not move stations once tests pass.
   - Keep the file data-only: no imports besides types, so a later web or widget renderer can reuse it.
3. **Hit test** (pure) `components/rail/diagram/hitTest.ts`: `nearestStation(x, y, scale): string | null` within `22 / scale` grid-points, so the tap target is a 44 pt circle at any zoom.
4. **Renderer** `components/rail/diagram/NetworkDiagram.tsx`:
   - `Svg` sized to the diagram bounds × `GRID`. Per line, a paper casing `Polyline` (7 pt) under the line `Polyline` (5 pt, line colour, round caps and joins).
   - Stations: 8 pt paper squares with a 2 pt line-colour border. Interchanges: an ink-bordered rounded rectangle spanning the lines, the map's split-square idea at diagram scale.
   - Labels: `SvgText` 11 pt `color.label` hex via `pick(hex.ink, scheme)` (`theme/design.ts:57-78`); hidden below scale 0.9 except interchanges. A `useAnimatedReaction` flips one JS state at the threshold, never per frame.
   - Wrap the `Svg` in an `Animated.View` whose `useAnimatedStyle` applies `translateX/translateY/scale`.
5. **Gestures** in the same component, under `GestureHandlerRootView`:
   - `usePinchGesture`: scale clamped to 0.6–4, focal-point anchored.
   - `usePanGesture`: translation clamped so at least a quarter of the diagram stays on screen.
   - `useTapGesture` (single): invert the transform in the worklet, then `scheduleOnRN(openStation, x, y)`, which runs `nearestStation` and `router.push({ pathname: '/station', params: { station } })`.
   - `useTapGesture` (`numberOfTaps: 2`): zoom 2× about the tap, `withTiming(…, { duration: motion.reposition, easing: EASE_OUT })`. Reduce Motion (`useReducedMotion`): jump without animating.
   - Compose with `useSimultaneousGestures(pinch, pan)`; give the single tap `requireToFail: doubleTap` (v3 `GestureTypes.d.ts:6`).
6. **Screen** `app/network.tsx`, registered in `_layout.tsx` as a `formSheet`, `sheetAllowedDetents: [1]`, `sheetGrabberVisible: true`, `headerShown: true`, `headerTransparent: true`, `title: 'Rail map'`, `contentStyle: { backgroundColor: SHEET_BACKGROUND }`. The toolbar has a close `xmark` (as `app/stops.tsx:34-36`) and a "Fit" button that resets the transform.
7. **Entry:** More menu → `<Stack.Toolbar.MenuAction icon="map" onPress={() => router.push('/network')}>Rail map</Stack.Toolbar.MenuAction>`. Optionally add a glass "Rail map" button in the `line` header.
8. **VoiceOver:** when `AccessibilityInfo.isScreenReaderEnabled()` is true, render a sectioned list instead of the SVG. One section per line, rows → station, using `Section`/`LinkRow` from `components/trip/SheetBody.tsx` / `Rows.tsx`. Mark the SVG `accessibilityElementsHidden`.
9. **Expired rail feed:** the diagram is static data, so it still renders. Stations still open `station`, which shows "Timetable unavailable" (03).
10. **Bail-out:** if authoring the coordinates takes more than about two days, or the gestures can't hold 60 fps with ~190 stations, stop. Remove the dependency and record the follow-up. 01–05 already meet the phase goals.
11. **Tests** `apps/mobile/components/rail/__tests__/klRailDiagram.test.ts`:
    - `every segment is octilinear (dx = 0, dy = 0 or |dx| = |dy|)`
    - `every RAIL_STATIONS id appears exactly once`
    - `every line branch uses known station ids in RAIL_STATIONS code order`
    - `no two stations closer than one grid unit`
    - `nearestStation returns the closest id within 22 / scale and null beyond`

## Verification

- `pnpm --filter mobile test`, `pnpm --filter @bus-tracker/shared test`, `pnpm type-check` all green.
- Native: `npx expo prebuild -p ios` succeeds; Xcode device build launches; `pod` list includes `RNSVG`.
- Device: More → Rail map opens full height; pinch 0.6–4× and pan stay at 60 fps (Perf Monitor); double-tap zooms; tapping Pasar Seni opens its station sheet over the diagram.
- Light/dark: lines keep official colours; casing and labels readable on paper in both.
- Reduce Motion: double-tap jumps without animating. VoiceOver: the list replaces the diagram, and every row opens its station. Dynamic Type XL: the list scales; diagram labels are fixed-size by design (the list is the accessible path).
- An EAS update published from this branch does not reach the `1.1.0` runtime (check the update's runtime version).

## Handoff to next step ([../15-journey-planner-ui/README.md](../15-journey-planner-ui/README.md))

- Phase 13 is complete. Phase 15 consumes `/station`, `/line`, `RailLayer.focus`, `TripContext.railFocus` and the `t816://station/<id>` links.
- If built, `/network` and `klRailDiagram.ts` are available for 15's "Where to?" station results (a "Show on rail map" action). If skipped, record "schematic diagram" as a follow-up, as the phase 15 README already does.

## Implementation notes

- **Built, not bailed out.** `react-native-svg` 15.16.0 is in `apps/mobile/package.json` (via `npx expo install`). This is a **native change**: it needs `npx expo prebuild -p ios`, `pod install` and an Xcode build. Bump `app.json` to `1.2.0` with it, as the phase README says.
- **Files.** Everything lives in `components/rail/diagram/`:
  - `klRailDiagram.ts` is data only. It holds `GRID` = 24, `DIAGRAM_SIZE` (79 × 59 units, labels included), 209 stations (160 Rapid KL and 49 KTM), 10 lines and `DIAGRAM_LINKS`.
  - `geometry.ts` is pure. It offsets bundles 6 pt apart with mitred bends, finds interchanges, and sizes the station markers.
  - `hitTest.ts` exports `nearestStation`.
  - `viewport.ts` holds the pure transform maths as worklets: clamp, zoom about a point, fit, and centre.
  - `NetworkDiagram.tsx` draws the map and handles the gestures.
  - `NetworkList.tsx` is the VoiceOver list.
  - `NetworkSheetBody.tsx` picks the diagram or the list, and exports `useScreenReaderEnabled`.
  - The tests are in `components/rail/__tests__/`. `klRailDiagram.test.ts` has the five named tests plus two more: no line runs over a station it doesn't call at, and links and labels. `diagramViewport.test.ts` covers the transform maths.
- **KTM ids and order.** The ids are the network's `ktm-<slug>` ids (`compileNetwork`). The two branches are "KTM Seremban" (Batu Caves → Seremban) and "KTM Port Klang" (Serendah → Pel Klang Sel). The test compiles the 2026-10-23 rail and KTM fixtures. It checks that each branch is that route's longest pattern, forwards or reversed, and that every KTM station in the box is drawn. Rapid KL branches must equal the stop-code order exactly, and their colours must equal `RAIL_LINES`.
- **Shared runs.** AG and SP between Sentul Timur and Chan Sow Lin, and the two KTM lines between Putra and KL Sentral, are drawn side by side rather than as one stroke. A stop on a shared run, such as Sultan Ismail, is not an interchange. Its label hides at low zoom like any other stop.
- **Walking links (addition).** Separate KTM and Rapid KL stations at the same place are joined by a short ink-and-paper link and share one label:
  - KL Sentral
  - Abdullah Hukum
  - Bandar Tasik Selatan
  - Kajang
  - Setia Jaya / Sunway-Setia Jaya
  - Subang Jaya

  The list's "changes" value includes linked lines.
- **Authoring.** Coordinates and labels were placed with a scratch generator. It validated the octilinear rule, spacing and label overlaps, then rendered PNG previews in light and dark. The generator is not committed; the data file is the source of truth from now on. To change the drawing, nudge `label` offsets and keep stations where they are.
- **Fit and home (deviation).** The sheet opens at 1× on the core: KL Sentral, Masjid Jamek, Ampang Park and Chan Sow Lin. "Fit" shows the whole network. On a phone that is about 0.2×, below the 0.6× minimum in step 5. So the pinch floor is `min(0.6, fit scale)`, which means you can pinch out to whatever Fit shows. The screen drives Fit through a `fitSignal` prop on `NetworkSheetBody`: a counter that the toolbar button bumps.
- **Gestures.** Pinch, pan, double tap and tap all go through one `useSimultaneousGestures`. The single tap has `requireToFail: doubleTap`. Pan coasts with a clamped `withDecay`, except under Reduce Motion. Clamping keeps a quarter of the diagram on screen, or a quarter of the screen when the diagram is smaller than the screen. The header is assumed to be 56 pt (`HEADER_HEIGHT`).
- **`gestureEnabled: false` on the `network` screen (recommended).** Without it, the formSheet's swipe-to-dismiss competes with vertical pans. Users can close the sheet with the `xmark` button instead.
- **Risks to check on device.**
  - **Memory.** The SVG is one 1896 × 1416 pt layer, which is about 100 MB of backing store at 3×.
  - **Blur.** The transform scales a bitmap, so the map may look soft at 2–4×.
  - **Fix if either is bad.** Use a viewport-sized `Svg` with a `viewBox`, re-rendered when a gesture settles.
- **Root-agent wiring and device fixes.**
  - Entry is the map's Layers menu ("Rail map", under "Rail lines"). The More menu the task names became the Layers menu in 13/02.
  - `app.json` is at 1.2.0. Prebuilt and built for the Simulator; `RNSVG` is in `Podfile.lock`. `pod install` needs `LANG=en_US.UTF-8` in a non-UTF-8 shell.
  - Two worklet crashes on the first pinch:
    - `minScale` called `fitTransform` declared later in the file. The worklet transform doesn't hoist, so worklets now come after the worklets they call.
    - `zoomAbout`'s default parameter `hi = MAX_SCALE` isn't captured; the default moved into the body.
  - A pinch that started on a station also opened it, so the single tap now has `requireToFail: [doubleTap, pinch]`.
  - Verified on the Simulator: opens at 1× on the core, Fit, a pinch anchored at the fingers, a tap on Pasar Seni opening its sheet, and interchange-only labels below 0.9×.
