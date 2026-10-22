# 17-Nearby-Around-You / 06 — Motion, Accessibility and QA

**Build impact:** JS-only (Metro reload). Run the final pass on a Release build too (`npx expo run:ios --configuration Release`), which needs an Xcode build but no native change.

## Context
- **From 02–05:**
  - Nearby lists your bus and the places around you, with map pins.
  - A stop lists its routes; a route previews on the sheet and the map, with Track and Walk.
  - The Nearby view stack lives in `NearbyContext`, and `sheetMode` covers `trip | place | preview`.
- **Known from 16/06:**
  - `SectionBody` crossfades with `LayoutAnimationConfig skipExiting`, and `SheetScroll resetKey` scrolls to the top;
  - the route badge and Saved tiles scale safely at AX3;
  - Plan rows truncate to one line by design.
- **Simulator:** iPhone 17 Pro Max, UDID `C8004D24-F5C7-40B7-BB75-1007E42F3668`.
  - Set the location with Features → Location → Custom Location, or `xcrun simctl location <udid> set <lat>,<lon>`.
  - Don't grant permission prompts on the user's behalf.

## Goal
Nearby feels calm and works with VoiceOver, Dynamic Type and Reduce Motion. Worst-case data doesn't break it, and the phase's success criteria are checked on the Simulator.

## Prerequisites
- 03, 04 and 05 merged.
- Invoke `animate-expo`, `emil-design-eng` and `break-ui`.

## Steps
1. **Motion.**
   - Push and pop crossfade with no travel.
   - Rapid taps (place → back → place) never stack two bodies.
   - The map draw-on starts after the sheet's crossfade, so the two don't compete.
   - The list re-sorting as you walk animates nothing: rows update in place, keyed by `placeKey`.
2. **VoiceOver** (code-level where the tools can't drive it):
   - Each place, route row and stop is one element with its `spoken` text.
   - The preview chip reads "Stop previewing 780".
   - Back buttons say where they go.
   - Live is spoken, not shown by colour alone.
3. **Dynamic Type** (Large and AX3): at peek, your bus row and the first place show. Rows grow and badges stay whole. Record any clipping below that.
4. **break-ui.**
   - **A busy interchange** (KL Sentral): 8 places, stations first by distance, and no duplicate same-name stops.
   - **A stop with 12 routes:** the list scrolls at large, and "No more today" rows sit last.
   - **A 60-character stop name** truncates to one line.
   - **The edge of the network** (outside the Klang Valley): "No stops within 600 m" with a "Show the map" hint.
   - **Midnight rollover:** times after 00:00 read as tomorrow's.
   - **Dark mode** across the list, stop, preview and pins.
5. **Phase criteria.**
   - Walk README criteria 1–8 in Debug with the location at the tracked stop, then 1, 4 and 5 on Release.
   - Write the results under "Implementation notes" here with the date, including anything verified only by unit tests.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- Screenshots of the list, stop and preview in light and dark, kept in the scratchpad, not the repo.
- Every README criterion is marked verified, or explained.

## Handoff to next step (post phase)
- **Memory:** "Nearby lists stops and stations around you; route preview on the map".
- **Follow-ups recorded in the README:**
  - road shapes for every bus route;
  - the "Buses nearby" map layer;
  - pinned stops in Saved.
