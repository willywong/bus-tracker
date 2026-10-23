# 17-Nearby-Around-You / 05 — Map Preview and Place Pins

**Build impact:** JS-only (Metro reload). `react-native-maps` is already installed, and nothing native changes.

## Context
- **From 02:**
  - `NearbyContext` (`top`, `places`, `here`, `push`, `previewPositions` and `setPreviewPositions`);
  - empty `components/map/PreviewLayer.tsx` and `components/map/PlacePins.tsx`.
- **From 01:** `routePreview(...)` gives `path` (a road slice for the tracked route, else stop to stop), plus its stops.
- **The map** (`app/index.tsx`):
  - `itShown` hides the trip's `RouteLayer`, buses and shimmer while an itinerary is drawn.
  - `ItineraryLayer` draws ink on a casing in chunks (`drawSchedule`), remounting once on finish.
  - Apple Maps stacks overlays in add order, so layers that must sit on top mount after `RailLayer`, keyed by its key.
  - Camera framing for rail focus goes through `mapRailFocus` and `trip.railFocus`.
- **Realtime** (`services/realtime.ts`):
  - `setExtraRoutes(source, routes)` with `ExtraRoutesSource = 'planner' | 'go'`, merged by `mergeExtraRoutes`.
  - Positions come back through the shared store; `positionsFromFeed` filters by route.
- **Design:**
  - board "Then · tap a route": an ink path with stops, your stop ringed, the live bus in green, and a "Previewing 780 ✕" chip;
  - board A: small pins for the listed places.

## Goal
The map shows what Nearby is talking about: pins for the places in the list, and while a route is previewed, its path, stops, your stop and its live buses, framed. Leaving the preview restores the trip's map exactly.

## Prerequisites
- 02 merged.
- Invoke `animate-expo` and `apple-design`.
- This task writes only `app/index.tsx`, `components/map/PreviewLayer.tsx`, `components/map/PlacePins.tsx`, `services/realtime.ts` (the new source) and `hooks/usePreviewRealtime.ts`.

## Steps
1. **Realtime source.**
   - Add `'preview'` to `ExtraRoutesSource`.
   - `usePreviewRealtime()`, mounted once in `app/index.tsx`:
     - while `top.kind === 'route'`, it calls `setExtraRoutes('preview', [routeForLabel])`, using the category the network route's feed maps to (`PlannerFeedRoutes`);
     - it filters positions to that route and calls `setPreviewPositions`;
     - on any other view it calls `setExtraRoutes('preview', [])` and `setPreviewPositions([])`.
   - Add a test in `services/__tests__/realtimePlan.test.ts` that the preview source merges and releases like `'go'`.
2. **`PreviewLayer`.**
   - The path as a casing plus an ink polyline, as `ItineraryLayer` draws a bus leg, using its chunked draw-on. Reuse `drawSchedule`; don't copy it.
   - Stop dots on the path, and your stop as a ringed marker (fixed sizes; Apple Maps ignores `anchor`).
   - Live buses as the green bus marker that `useGlidingMarkers` already animates.
   - Mount it after `RailLayer`, keyed with the rail key, and hide the trip's route layers while a preview shows (extend the `itShown` condition with `previewShown`).
3. **Camera.**
   - On entering a preview, fit the camera to the path from your stop onward, with sheet-aware padding (as the itinerary fit does).
   - On leaving, restore the previous region.
   - Never move the camera on a position update.
4. **Preview chip.**
   - A top-left glass capsule, "Previewing 780 ✕", in place of the route switcher while previewing.
   - ✕ calls `pop()` back to the stop.
   - Label: "Stop previewing 780".
5. **`PlacePins`.**
   - While `top.kind === 'list'` and Nearby is the section: one small marker per place.
     - Stop: a 16 pt white rounded square with an ink border.
     - Station: a 16 pt ring in the first line's colour.
   - Tapping a pin calls `push` for a stop and `router.push('/station…')` for a station, as the rows do.
   - Pins hide behind an itinerary, Go or a preview.
   - At most `MAX_PLACES` markers, and they never move the camera.
6. **Walk line in the stop view.** While `top.kind === 'stop'`, draw a dotted ink straight line from `here` to the stop, with the stop as a selected marker. Apple walking paths are out of scope here.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator** (location at the tracked stop):
  - **The list:** pins for every place, and tapping one opens it.
  - **A preview of a route you don't track:**
    - the path draws on stop to stop, your stop is ringed, the tracked T816 line and buses hide, and the camera frames the path;
    - ✕ returns to the stop and the T816 map is back unchanged.
  - **A preview of your tracked route:** it follows the road shape.
  - **Live:** with the feed returning that route, its bus shows in green and moves on the next poll. Metro logs show the preview route added, then dropped after you leave.
  - Reduce Motion: the path appears at once.

## Handoff to next step
- The map side of Nearby is complete: pins, preview path, live buses, chip and camera.
- **06** runs motion, accessibility and QA across 02–05.

## Implementation notes (2026-10-23)

Built by a subagent alongside 03 and 04, then validated on the Simulator. JS-only.

- **Pins are `displayPriority="required"`.** At "high", MapKit hid every pin at the trip camera's zoom, colliding with your stop's label and the route's markers; they appeared only when zoomed in. There are at most 8 pins, so required is safe.
- **No `tracksViewChanges={false}`** on the pins, matching `RouteLayer`. The custom views otherwise snapshot empty.
- **Dev-only:** Fast Refresh of `app/index.tsx` remounts the map at its initial region (the whole Klang Valley), and hot reload doesn't redraw native markers. Relaunch to check either. A fresh launch frames the trip as before.
- **Verified:**
  - Pins for the listed places.
  - A stop's dotted walk line and solid square.
  - T790 and T787 previews: path, ring on your stop, T816 hidden, framed, "Previewing T787 ✕" chip.
  - ✕ restores the T816 map.
  - Metro logs `[preview] polling T787 (rapid-bus-kl)` and `[preview] dropped T787`.
- **Known:** the first preview poll can take 30–60 s to show a live bus. Previews fall back to stop-to-stop lines where no road shape fits (T787, T790).
