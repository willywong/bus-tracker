# 15-Journey-Planner-UI / 05 — Itinerary Detail

**Build impact:** JS-only (Metro reload)

## Context
- **Sheet registration.** 02 registered `itinerary` (`app/_layout.tsx`) as a formSheet:
  - detents `itineraryDetents()` = [peek, 0.5, 1], where peek is the same 212pt as the trip peek;
  - `sheetInitialDetentIndex: 1`, `sheetLargestUndimmedDetentIndex: 1`, `headerShown: false`.

  The trip sheet stays pinned at peek beneath it.
- **Opening.** 04 opens it with `planner.setOpenId(id)` + `router.replace('/itinerary?id=…')`. The results stay in `usePlanner().run`, so going back costs nothing.
- **Map host.** The map lives in `app/index.tsx`, not in the sheet:
  - camera fitting is `frameTrip` (:209-248, `fitToCoordinates` at :237-245, bottom padding = sheet height, :84-86);
  - the trip layers are `RouteLayer` (:357-372) and `RouteShimmer` (:408-416).

  Anything the itinerary draws must come through shared state (`PlannerContext`).
- **Overlay constraints.**
  - `RouteLayer` warns that rapid `Polyline` prop changes are fragile under Fabric. It remounts runs rather than mutating coordinates (`components/map/RouteLayer.tsx:73-75`, :103-124).
  - `RouteShimmer` notes that every overlay prop change re-adds the MapKit overlay (`components/map/RouteShimmer.tsx:42-49`).

  Spec §7.1 asks to "grow each leg's `Polyline` coordinate slice on a JS timer (60 Hz)". At 60 Hz that is about 39 overlay re-adds per leg, so this task uses append-only chunks instead (step 6).
- **Polyline props.** `react-native-maps` `Polyline` has `lineDashPattern` (`node_modules/react-native-maps/dist/src/MapPolyline.d.ts:48`), `lineCap` (:37), `tappable` / `onPress` (:84, :116).
- **Rail focus.** Phase 13 `RailLayer` takes `focus` (line ids at 100%, others at 15%). The map reads it from `TripContext.railFocus` (`{ stationId, routeIds, point }`, 13/05), not from `MapSelection`. Screens own their focus through `useFocusEffect`. Phase 13 `station` accepts `?station=<id>`.
- **Z-order is mount order.** `Polyline.zIndex` is Google-only on iOS (`MapPolyline.d.ts:117-125`). 13/02 renders `RailLayer` first and appends its `railKey` to `RouteLayer`'s key so the bus route is re-added on top. `ItineraryLayer` must therefore mount **after** `RailLayer` and `RouteLayer`, and must be re-added whenever they are.
- **Timeline spec** (§6.3):
  - rails are 4pt: ink solid for a bus, line colour for rail, dotted for a walk;
  - nodes: a circle for a bus stop, a square for a station, a ringed pin at each end;
  - live times are full ink with the live glyph, scheduled times are secondary with a clock, and headway legs read "every N mins" instead of a time;
  - intermediate stops sit in a `DisclosureGroup` (`node_modules/@expo/ui/build/swift-ui/DisclosureGroup/index.d.ts`: `label`, `isExpanded`, `onIsExpandedChange`, `DisclosureGroup.Label`);
  - tapping a leg fits the map with a light haptic (`utils/haptics.ts:41`);
  - tapping a station opens `station`.
- **Patterns to reuse:**
  - the glass back button in `DetailHeader` (`components/trip/SheetHeader.tsx:112-160`);
  - the full-width glass action `GlassCapsuleButton` (`components/trip/PrimaryAction.tsx:117-171`);
  - the peek ⇄ body crossfade `SheetBody` (`components/trip/SheetBody.tsx:37-58`);
  - the detent listener (`app/trip.tsx:117-124`);
  - the vertical "On the way" timeline, `components/trip/OnTheWay.tsx`, for node and rail proportions.

## Goal
`app/itinerary.tsx` shows the chosen itinerary:
- at peek, its result row plus a glass **Go**;
- from 0.5 up, the §6.3 timeline.

The map fits all legs and draws them in order over 650 ms (all at once under Reduce Motion). Tapping a leg fits the map to it. Walk legs use real `MKDirections` paths.

## Prerequisites
- 04 merged. 01's `walk()` available. Phase 13 `RailLayer` + `station` route.
- Invoke `animate-expo`, `apple-design`, `expo:expo-ui`.

## Steps

1. **Planner context additions** (`state/PlannerContext.tsx`):
   - `openId: string | null` and `setOpenId`;
   - `itineraryDetent: 0 | 1 | 2` and its setter;
   - `focusLeg: { index: number; nonce: number } | null` and `focus(index)`. The nonce makes a repeated tap re-fit;
   - `walkPaths: Record<string, Record<number, LatLng[]>>`, keyed by itinerary id, then leg index.

   Add a selector, `useOpenItinerary(): Itinerary | null`, which finds `openId` in `run.itineraries`.

2. **Navigation.**
   - The header back button calls `router.replace('/plan')`. `plan.tsx` shows results at once from `run`, without re-planning.
   - Swiping the sheet down (formSheet default) dismisses it. On unmount, `setOpenId(null)` and `setPresented(false)`.
   - If the open id disappears after a retime (a broken transfer re-plans the tail, so the leg sequence and id change), switch `openId` to `findSuccessor(prevIt, run.itineraries)`. Never show an empty sheet.
     - `findSuccessor` is a pure helper in `components/itinerary/model.ts`. It matches the first ride leg's `route`, `from.stop` and `tripKey`.
     - The new itinerary carries `previousArriveAt` and `'missed-connection'`.
   - Device check: a replace between two formSheets must animate cleanly. If it doesn't, use `router.dismiss()` followed by `router.push()` and record that in the Handoff.

3. **Timeline model (pure)** in `components/itinerary/model.ts`. It exports `timelineRows(it, net, now): TimelineRow[]`:
   ```ts
   type TimeCell = { kind: 'live' | 'scheduled'; at: number } | { kind: 'every'; minutes: number } | null;
   type TimelineRow =
     | { kind: 'end'; which: 'origin' | 'destination'; time: TimeCell; name: string }
     | { kind: 'board' | 'alight'; legIndex: number; node: 'stop' | 'station'; time: TimeCell; name: string;
         stationId: string | null; color: string | null; liveNote: string | null }
     | { kind: 'walk'; legIndex: number; minutes: number; meters: number; label: string; about: boolean }
     | { kind: 'ride'; legIndex: number; chip: Chip; headsign: string; stops: string[]; minutes: number;
         rail: 'ink' | string /* line colour */ };
   ```
   - Walk label: "Walk 5 mins · 380 m"; between rides it is "Change · walk 3 mins". `about` is set for an unverified curated interchange, giving "about 4 mins walk".
   - `ride.stops` excludes the board and alight stops.
   - `liveNote` is "Live · 2 stops away" when the live timing carries it, otherwise "Live · as of 08:41".
   - `Chip` comes from `components/plan/model.ts`.

4. **Timeline model tests.** `components/itinerary/__tests__/model.test.ts`:
   - `origin and destination bracket the legs`
   - `headway ride shows every instead of a time`
   - `unverified interchange says about`
   - `live boarding is marked live, later legs stay scheduled`
   - `intermediate stops exclude board and alight`
   - `walk between rides is labelled Change`
   - `findSuccessor follows the first ride leg after a tail re-plan`
   - `findSuccessor returns null when the first ride changed`

5. **`components/itinerary/Timeline.tsx`.** Three columns: time (52pt, right-aligned, tabular), rail (24pt), content (flex).
   - **Rails:** a 4pt `View` stretched between nodes:
     - `color.ink` for a bus;
     - the line colour for rail;
     - 3pt ink dots every 7pt for a walk, counted with `onLayout` like `JourneyBar`.
   - **Nodes:**
     - stop: a 12pt ring (2pt ink on paper);
     - station: a 12pt square in the line colour;
     - origin: a ring with a dot;
     - destination: a solid ink disc with a paper ring.
   - **Time cell:**
     - `live` is ink with `SourceMark source="live"`;
     - `scheduled` is `color.secondaryLabel` with the `clock` glyph;
     - `every` leaves the time empty and shows "every 6 mins" on the content side.
   - **Ride rows:** a chip, then "towards {headsign}". Below that, a `Host matchContents={{ vertical: true }}` holding a `DisclosureGroup` with the label "6 stops · 14 mins". Its children are `Text` rows (`font({ size: 13 })`, secondary). The RN rail beside it stretches as the group expands.
   - **Taps:**
     - a walk or ride row calls `planner.focus(legIndex)` and `haptics.light()`;
     - a board or alight row with a `stationId` calls `router.push({ pathname: '/station', params: { station: stationId } })`.
   - **VoiceOver:** each row is one element, e.g. "9:05, board T816 at Hotel Lisa De Inn towards MRT Phileo Damansara, live, 2 stops away" or "Kajang Line towards Kajang, every 6 minutes, 7 stops, 15 minutes". Station rows add the hint "Opens the station".

6. **Draw-on schedule (pure)** in `components/map/drawOn.ts`. It exports `drawSchedule(legs: { kind; points: number }[], totalMs = 650, reduceMotion: boolean): { leg: number; from: number; to: number; atMs: number }[]`.
   - Walk legs get a single chunk at `atMs: 0`.
   - Ride legs share 650 ms in proportion to their point counts, in leg order. Each is split into at most 6 chunks, and there are at most 24 chunks in total.
   - Chunk times follow the `EASE_OUT` curve (0.23, 1, 0.32, 1). Evaluate the bezier in the pure function, without Reanimated.
   - `reduceMotion` puts everything at 0.

   Tests in `components/map/__tests__/drawOn.test.ts`:
   - `walk legs appear at once`
   - `chunks are monotonic and end by 650 ms`
   - `never more than 24 chunks`
   - `reduce motion draws everything at zero`
   - `consecutive chunks share an endpoint` (no gaps)

7. **`components/map/ItineraryLayer.tsx`.** Props: `{ legs: DrawLeg[]; drawKey: string; ink; paper; casing; reduceMotion }`, where `DrawLeg = { kind: 'walk' | 'bus' | 'rail'; coords: LatLng[]; color: string | null }`.
   - **Drawing:** a JS `requestAnimationFrame` loop mounts each scheduled chunk as its own keyed `Polyline` and never changes a mounted one. When the last chunk lands, swap all chunks for one `Polyline` per leg in a single remount (key `${drawKey}-final`).
   - **Styles:**
     - walk: 3pt ink, `lineDashPattern={[0.1, 6]}` with `lineCap="round"` for dots (on device, fall back to `[2, 5]` if dots don't render);
     - bus: a 4pt ink line on a 9pt casing (as `RouteLayer.tsx:94-100`);
     - rail: a 5pt line in the line colour on a 7pt paper casing.
   - **Markers:** paper rings at transfer points. Origin and destination pins are fixed-size and centred (Apple Maps ignores `anchor`, per the README's markers note), with `tracksViewChanges={false}`.
   - **Geometry:**
     - a ride leg uses the phase-12 shape slice when exposed (spec §3.3 `routes.shapeId`), else `[from, ...via, to]`;
     - a walk leg uses `walkPaths[id][i]` when loaded, else a straight segment. The path arriving later is one remount.

8. **Map wiring in `app/index.tsx`.**
   - Read `useOpenItinerary()`. While it's set:
     - render `<ItineraryLayer>` as the last overlay child of `MapView`, after `RailLayer` and `RouteLayer`, and key it `${drawKey}|${railKey}`, so a rail restyle re-adds the legs on top;
     - hide the trip's `RouteLayer`, ghost marker, bus markers and `RouteShimmer`, so two ink lines never mean different things.
   - Rail focus belongs to the screen. In `app/itinerary.tsx`, `useFocusEffect` calls `trip.setRailFocus({ stationId: null, routeIds: <rail legs' network route ids>, point: null })`, and its cleanup calls `setRailFocus(null)`. A `station` opened from the timeline re-focuses, and closing it restores the itinerary's focus (13/05 step 4).
   - `point: null` keeps 13/05's `frameTrip` rail framing out of the way.
   - Add `frameItinerary(coords, animated)`, using `fitToCoordinates`:
     - bottom padding `(windowHeight − insets.top) × itineraryDetents()[min(itineraryDetent, 1)] + 32`;
     - top padding `insets.top + 80`.
   - Skip `frameTrip`'s effects (:270-282, plus 13/05's `railFocus` re-frame effect) while an itinerary is open.
   - **Order:**
     1. fit all legs;
     2. start the draw on the first `onRegionChangeComplete`, or after 400 ms;
     3. re-fit on `itineraryDetent` changes;
     4. fit the focused leg's coords on each `focusLeg.nonce`.

9. **Walk paths.** When an itinerary opens, call `walk(from, to)` once per walk leg (≤ 4), one at a time, and store the results in `walkPaths`. `ERR_OFFLINE`, `ERR_THROTTLED` and `ERR_NOT_FOUND` keep the straight dotted line silently. Never call `walk()` for unopened itineraries (README scope).

10. **`app/itinerary.tsx`.**
    - Detent listener, as in `trip.tsx:117-124`, → `setItineraryDetent`.
    - **Header:** the `DetailHeader`-style glass back button, the title "To KLCC" and the subtitle "Arrive 9:52 · 38 mins".
    - **Peek:** the `ResultRow` for this itinerary (not pressable, no stagger), then `GlassCapsuleButton` (`label="Go"`, `icon="location.north.fill"`, `prominent`, hint "Follows this journey with alerts and the Live Activity"). Its `onPress` calls `ride.startJourney(it)`; until 06 lands, it navigates nowhere.
    - **Body:** `<SheetBody peek={detent === 0}>` wraps `<Timeline>`.
      - Above the timeline: 04's `warningNote(it)` row, plus `updatedNote(it)` while set (e.g. "Connection missed. Times updated · was 9:12").
      - 04's `feedNotes(run.excludedFeeds)` rows go above that.
      - The footer from 04 goes at the end.

## Verification
- `pnpm --filter mobile test`: the itinerary `model.test.ts` and `drawOn.test.ts` pass.
- `pnpm type-check`.
- Device (iPhone 13) on Hotel Lisa De Inn → KLCC (criterion 3):
  - the camera fits all legs above the sheet;
  - the legs draw origin → destination in about 650 ms, with walks appearing at once;
  - the timeline matches the legs one to one;
  - DisclosureGroups expand and the rail stretches with them;
  - tapping the T816 leg fits it, with one light haptic;
  - tapping a station opens `station`;
  - back returns to the same results with no re-plan, visible as no loader;
  - swiping the sheet down restores the trip sheet and the trip map.
- Reduce Motion: the legs appear at once.
- Satellite: walk dots and the ink line read on the dark palette (`mapScheme`, `index.tsx:316`).
- Airplane mode: walk legs stay straight and dotted, with no error UI.
- Instruments or the RN perf monitor: no frame drops > 2 during the draw. `drawOn` adds ≤ 24 overlays.

## Handoff to next step ([06-go-mode.md](./06-go-mode.md))
- `useOpenItinerary()`, `ItineraryLayer` and `timelineRows` are ready for Go mode. 06 reuses the layer and timeline with a "current leg" highlight.
- `walkPaths` are cached per itinerary, so Go mode reuses them for off-route distance.
- The Go button calls `ride.startJourney(it)`, which 06 implements.
