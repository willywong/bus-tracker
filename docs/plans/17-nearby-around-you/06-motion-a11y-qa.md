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

## Implementation notes (2026-10-23)

Run on the iPhone 17 Pro Max Simulator, Debug build with Metro, location at Hotel Lisa De Inn unless stated. JS-only throughout. A read-only reviewer audited VoiceOver, motion and midnight in code; its findings were checked and fixed here.

### Fixed in this task
- **Place pins invisible at the trip zoom.** They're now `required` (see 05).
- **After-midnight times.**
  - A 0:15 bus seen at 23:45 reads "0:15 tmrw" and "next at 0:15 tomorrow".
  - Past midnight, the same service-day trip reads "0:15".
  - `isTomorrow` (Malaysian calendar day) has a test on a tiny network.
- **Stale ETA spoken as live.** The your-bus row now says "live, last updated over a minute ago" for aging data, as the trip hero does.
- **AX3.** At 2.35× the your-bus row lost its stop name, "Around you" ran into "Nearest first", and times truncated ("8:06 …"). Now:
  - From the first accessibility size the your-bus row stacks the stop name under the badge and countdown.
  - Place names take two lines.
  - Times cap at 1.6×, as the route badge does.
  - Heading rows wrap.
  - The preview's buttons scale and stack.
- **"Kl Sentral"** now reads "KL Sentral": `kl` joined `formatStopName`'s acronyms.

### Checks
- **Motion** (code-level audit):
  - Push and pop crossfade the keyed body with no travel.
  - `skipExiting` drops the old body, so rapid taps can't stack two bodies.
  - A double push is ignored.
  - Rows are keyed by `place.key` with no layout animation.
  - The draw-on starting after the crossfade wasn't separately timed.
- **VoiceOver** (code-level):
  - Every place, route and your-bus row is one button with its spoken label.
  - The chip reads "Stop previewing T787".
  - Back buttons name where they go ("Back to Nearby", "Back to around you").
  - Live is spoken.
  - Wording differs from README criterion 7: rows say "next at 8:16 AM, scheduled", not "next in 6 minutes".
- **Dark mode:** list, stop, preview and pins checked; pins invert (dark fill, light border).
- **break-ui:**
  - **KL Sentral:** 8 places, stations first by distance (KTM 40 m, KJ/MR 90 m), then bus stops. The two "KL Sentral" bus stops (120 m, T851; 190 m, the 600s) stay apart: different kerbs with different routes, beyond the 80 m merge distance. The KTM and LRT stations are separate stations in the network, so they get separate rows.
  - **Outside the network** (Ipoh): "No stops within 600 m · Show the map to look further".
  - **Midnight:** unit-tested, as above. Not run on the Simulator clock.
  - **60-character names:** truncate to one line at default size, two at accessibility sizes (code).
- **Not run:** the Release build (`npx expo run:ios --configuration Release`). It installs over the Simulator's dev client with the same bundle id, so it was left for you. Criteria 1, 4 and 5 were checked on Debug only.

### README success criteria
1. **Verified.** At peek, the your-bus row and the first place show at default size (24 pt was added in 02). At AX3 only the your-bus row fits at peek.
2. **Verified.** Feeder and Rapid KL stops come nearest first, with next times. The nearest stations within 2 km are Taman Paramount and Asia Jaya (KJ, 1.7 km, 22 min walk); Taman Jaya is farther.
3. **Verified.** Stop → route → back → back returns to the list scrolled to the top. Leaving Nearby resets the stack (code; the picker only shows on the list).
4. **Verified.** Path, ring, tracked route hidden, framing, and live buses when the feed had them (T787 "Live · 15 stops away").
5. **Verified** after the stop-id fix: T790 from Sin Chew Daily became the tracked route with its countdown.
6. **Code-level.** The status rows cover no permission ("Turn on location…"), loading and no fix. Places clear when the list isn't shown. Permission prompts weren't answered on your behalf.
7. **Code-level.** One element per row with spoken text, and the chip label; wording as noted above.
8. **Verified.** `npx tsc --noEmit -p .` is clean; `npm test` passes 471/471.

### Found outside this phase
- **Settings → Your routes, swipe to delete removed the wrong route.** Swiping T790 (4th) and tapping Delete removed T816 (1st). `FavoritesSection` maps `List.ForEach` `onDelete` indices with `recycling={false}`, which reports native child offsets. The long-press "Remove Route" (by code) works. Not fixed here.
- The Simulator state is restored: T816 at Hotel Lisa De Inn is tracked again, but now third in Your routes, not first. T790 is removed.
