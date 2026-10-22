# Phase 17 — Nearby: Around You

The Nearby section becomes "your bus, then around you":
1. Your tracked bus keeps one compact row at the top.
2. Below it is a list of the bus stops and rail stations near you, nearest first, each with its routes and next departure.
3. Tapping a station opens today's station sheet.
4. Tapping a bus stop lists its routes with their next times.
5. Tapping a route previews its path on the map and gives its details, with **Track this route** and **Walk there**.

Design: canvas "BusBuddy Rail + Planner" → page "Nearby options" → artboard **A · Your bus, then around you** (https://claude.ai/artifact/44D6Ds5naNcJd48n4ZqZdA). It is followed by **Then · tap a bus stop** and **Then · tap a route**. Options B (a departures board: one row per route and direction) and C (map pins with a card carousel) were set aside.

## Why this shape

- **It keeps your bus first.** The app is still about leaving on time for your bus. Its row stays at the top, and the full trip view is one tap away.
- **Places, not departures.** You decide where to walk first, then which route to take. B's route rows run to 30+ at an interchange; A lists 8 places at most.
- **Nothing new to fetch.** The compiled network already on the phone (phase 12) has every stop, station, route, pattern and timetable, plus a stop grid for "near here" lookups. The station sheet's "Buses nearby" (13) already builds rows like these from `stopsNear` and `stopDepartures`.

## Dependencies

- **Phase 16:** `components/sheet/*` (`NearbySection`, `sections.ts`, `mode.ts`, `SectionPicker`), `SheetScroll` with `resetKey`, `SectionBody` crossfade.
- **Network (12/13):**
  - From `@bus-tracker/shared`: `stopsNear(net, lat, lon, radiusM)`, `stopDepartures(net, stopIndex, now)` → `BoardRow[]` (`route`, `pattern`, `dir`, `towards`, `next`, `first`, `last`), `stationBoard`, `namespaceFeedId` / `feedOfStopId`, `walkingMinutes`, `haversineMeters`.
  - `useTransitNetwork()` gives `{ network, status }`.
  - `components/rail/stationModel.ts` `nearbyOf()` is the precedent for grouping by route and the "next" wording.
- **Location:** `components/plan/useNear.ts`; the planner's permission flow is in `services/planner/quickFix.ts`.
- **Realtime:** `services/realtime.ts` `setExtraRoutes(source, routes)` with `ExtraRoutesSource = 'planner' | 'go'`, merged by `mergeExtraRoutes`.
- **Map:** `app/index.tsx`.
  - `itShown` already hides the trip's route and buses while an itinerary is drawn.
  - `ItineraryLayer` draws ink lines on a casing.
  - `itineraryGeometry.ts` holds the stop-to-stop and shape-slice rules.
- **Tracking:** `settings.addFavorite(code, gtfsStopId)` (`MAX_FAVORITES = 10`), `setPreferredStopForRoute`, `setPreferredRouteCode`. `useRouteStatic` downloads a newly tracked route's rows.
- **Build impact: JS-only for every task** (a Metro reload). No `app.json`, `modules/` or `patches/` change. Location permission is already declared.

## Scope decisions (locked unless the open questions change them)

- **Data shape.** These are pure and live in `components/sheet/nearby/model.ts`, tested under `tsx --test`:
  ```ts
  type NearbyPlace =
    | { kind: 'station'; key: string; stationId: string; name: string; lines: LineChip[]; distanceM: number; walkMin: number; next: string; spoken: string }
    | { kind: 'stop'; key: string; stopIndexes: number[]; name: string; routes: string[]; distanceM: number; walkMin: number;
        next: string; live: boolean; isYourStop: boolean; spoken: string };
  type StopRouteRow = { route: number; pattern: number; label: string; towards: string; stopIndex: number;
        next: string; then: string; live: boolean; ended: boolean; spoken: string };
  type RoutePreview = { route: number; pattern: number; label: string; towards: string; fromStopIndex: number;
        stops: { index: number; name: string; time: string | null; yours: boolean }[]; nextAt: number | null; path: LatLng[]; spoken: string };
  ```
- **Navigation state.**
  - `NearbyView = { kind: 'list' } | { kind: 'trip' } | { kind: 'stop'; key: string } | { kind: 'route'; route: number; pattern: number; fromStopIndex: number }`.
  - It is a stack in `state/NearbyContext.tsx`; `push`, `pop` and `reset` are its only writers.
  - It is not persisted. A relaunch starts at `list`.
  - `sheetMode` gains `trip | place | preview`. Precedence: go > ride > detail > nearby view > sections. Any non-`list` view hides the picker, as detail does.
- **Your bus row.**
  - One 60 pt row: route badge, stop name, "Your bus · 80 m", and the live or scheduled countdown.
  - Tapping it pushes `trip`, which is today's full Nearby body behind a back button.
  - The bus Live Activity link and the "Track" quick action push `trip` directly.
  - With no route tracked, the row is "Track a bus" → `/add-route`.
- **Around you.**
  - Bus stops within **600 m** and stations within **2 km** (1.5 km listed none at Hotel Lisa; see 01 notes), nearest first, **8 places** at most, at least 2 of them stations.
  - Stops with the same name within 80 m (opposite sides of a road) merge into one place.
  - Stops with no boarding departures today are dropped.
  - Your tracked stop stays in the list, captioned "Your stop".
- **Location.**
  - The list uses a fix from `useNear`, plus a 75 m `watchPositionAsync` while Nearby's list is on screen and the app is in the foreground.
  - Without permission, a row reads "Turn on location to see stops around you". Tapping it asks for permission; if that was refused, it opens Settings.
  - With location but no network yet, the row reads "Loading the network…".
- **Station tap** → `router.push('/station?station=<id>')`, today's sheet, unchanged.
- **Stop view** (in the sheet, with a back button): one row per route and direction, with the next time and then two more, live when a bus is close. Below that are "No more today" rows and walking directions.
- **Route preview** (in the sheet with a back button, and drawn on the map):
  - the countdown at your stop;
  - **Track this route** and **Walk there**;
  - the stops from yours onward, with scheduled times.
  - A "Previewing 780 ✕" glass chip sits top-left on the map.
- **Map while previewing.**
  - The route's path is an ink line on a casing, with its stops, your stop ringed, and live buses of that route.
  - The trip's own route and buses hide, as for an itinerary.
  - The camera frames the path from your stop onward.
  - While the list is showing, the map shows small pins for the listed places. Tapping a pin pushes that place.
- **Live data for routes you don't track.** Previewing adds the route under a new `ExtraRoutesSource` `'preview'`, which is released when the preview closes. Times stay scheduled; a live dot shows when a vehicle of that route is heading for your stop.
- **Track this route.**
  - The network stop id is mapped to the GTFS id with a new helper, `gtfsStopId(networkId)`, which strips the feed prefix.
  - Then it runs `addFavorite(label, gtfsStopId)`, `setPreferredStopForRoute`, `setPreferredRouteCode`, `reset()`, then `push({ kind: 'trip' })`.
  - When favourites are full (10), it says so and offers Settings.
- **Motion.** Push and pop crossfade the body (as 16/06) with no travel. The map draw-on reuses `ItineraryLayer`'s schedule. Under Reduce Motion everything appears at once.

## Success criteria

1. At peek, Nearby shows your bus row and at least the first place, on an iPhone 17 Pro Max at default text size, within today's peek height.
2. Around Hotel Lisa De Inn, the list shows the nearby feeder stops and Taman Jaya (KJ), nearest first, with correct walk minutes and next times.
3. Stop → route → back → back returns to the list with its scroll reset. Leaving Nearby and coming back starts at the list.
4. A route preview draws the path, rings your stop, hides the tracked route, frames the camera, and shows live buses of that route when the feed has them.
5. **Track this route** from a preview makes it your tracked route at that stop, and the trip view shows its countdown.
6. Without location permission, the list explains itself and never shows stale places.
7. VoiceOver reads each place as one element ("Jalan 17/21C, bus stop, 240 metres, routes PJ02 and 780, next in 6 minutes"). The preview chip reads "Stop previewing 780".
8. `npx tsc --noEmit` and `pnpm test` pass in `apps/mobile`.

## Skills to invoke

- `expo:expo-ui` (02, 03, 04), `apple-design` and `emil-design-eng` (02–06), `animate-expo` (05, 06), `break-ui` (06).

## Task order

1. [01-nearby-model.md](./01-nearby-model.md): pure `aroundYou`, `stopRoutes`, `routePreview`, `gtfsStopId`, with tests.
2. [02-nearby-list-and-state.md](./02-nearby-list-and-state.md): `NearbyContext`, `sheetMode` views, the your-bus row, the Around you list, location, and stub stop and route views.
3. [03-stop-view.md](./03-stop-view.md): routes at a stop, walking directions. **Can run in parallel with 04 and 05.**
4. [04-route-preview-sheet.md](./04-route-preview-sheet.md): the preview body, Track this route, Walk there. **Parallel with 03 and 05.**
5. [05-map-preview-and-pins.md](./05-map-preview-and-pins.md): the path layer, place pins, camera, the realtime `'preview'` source. **Parallel with 03 and 04.**
6. [06-motion-a11y-qa.md](./06-motion-a11y-qa.md): motion, VoiceOver, Dynamic Type, break-ui, a Simulator run with a simulated location.

01 and 02 run in order. 02 creates every file 03, 04 and 05 touch, so their files are disjoint: 03 `components/sheet/nearby/StopView.tsx`; 04 `RouteView.tsx` and `track.ts`; 05 `app/index.tsx`, `components/map/PreviewLayer.tsx`, `components/map/PlacePins.tsx`, `services/realtime.ts`, `hooks/usePreviewRealtime.ts`.

## Open questions (defaults chosen; change before 02 if you disagree)

1. **Your bus at peek.**
   - **Default:** the compact 60 pt row, as on board A. The big countdown moves one tap in, to `trip`.
   - **Alternative:** keep today's countdown card at peek, with Around you starting below it at glance. That keeps the hero, but a route's path is then one detent further away.
2. **Road shapes for routes you don't track.**
   - **Default:** routes you don't track draw stop to stop (straight lines between stops), using `itineraryGeometry`'s existing rule; the tracked route uses its road shape.
   - **Follow-up:** bundle simplified shapes for every bus route into the network. That means measuring the size added to the download (12/00), and is out of scope here.
3. **Radius.** Bus stops within 600 m, stations within 1.5 km, 8 places. The alternative is a single 800 m radius for both.
4. **Live times for routes you don't track.**
   - **Default:** scheduled times, plus a live dot and the bus on the map.
   - **Alternative:** run the arrival ETA engine for previewed routes. That is closer to the tracked route's "Live · 4 min", but means a second `useBusEta` and more polling.

## Hand-off (post phase)

- `docs/design/README.md` §2 says Nearby is your bus, then around you; stops and routes preview on the map.
- **Memory:** the project note gains "Nearby lists stops and stations around you; route preview on the map".
- **Follow-ups to record:**
  - road shapes for every bus route (open question 2);
  - the "Buses nearby" map layer, still "Soon" in Layers, which could reuse the place pins;
  - pinned stops in Saved.
