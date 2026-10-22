# 15-Journey-Planner-UI / 08 — Motion, Polish and QA

**Build impact:** JS-only (Metro reload). Fixes found here should be JS-only. If one touches `modules/transit-maps` (Swift) or `app.json`, it becomes native: run `npx expo prebuild --platform ios` and rebuild in Xcode.

## Context
- 01–07 shipped the whole planner:
  - the native MapKit module;
  - the peek capsule and circles;
  - the `plan` sheet (search, then results);
  - the `itinerary` sheet and `ItineraryLayer`;
  - Go mode (multi-leg ride, Live Activity `kind: 'journey'`, `bt.go.*` alerts, optional go geofences);
  - saved places, quick actions and the widget home line.
- Motion values live in `theme/design.ts`: `motion` (:112-127), `EASE_OUT` / `CSS_EASE_OUT` (:130-132). Spec §7 lists every moment. README §4 Motion and Haptics are binding. Under Reduce Motion, everything becomes a crossfade (`docs/design/README.md` §4).
- `@expo/ui` `matchedGeometryEffect` + `Namespace` exist (`node_modules/@expo/ui/build/swift-ui/modifiers/index.d.ts:60`, `Namespace.d.ts`), but they don't cross native screens. The result row → itinerary peek hand-off is a sheet replace, so they are not used. Don't add them here.
- The README "Verify on device" list (`docs/design/README.md` §6) applies, plus phase 15's criteria 1–8 (`./README.md`).

## Goal
Every §7 moment matches its values on device, with the right Reduce Motion fallback and haptics. VoiceOver, Dynamic Type, dark/satellite and the break-ui worst cases pass. Performance meets the targets. The design docs record what was built.

## Prerequisites
- 01–07 merged on a Release build installed on an iPhone 13 (`npx expo run:ios --configuration Release --device`), plus the iPhone SE (3rd gen) and iPhone 17 Pro Max simulators.
- Invoke `animate-expo` and `review-animations` for the motion pass, `break-ui` for the worst cases, `apple-design` / `emil-design-eng` for polish.

## Steps

1. **Motion audit (spec §7).** Check each row on device with Reduce Motion off, then on. Fix any mismatch in place.

   | # | Where | Expected | Reduce Motion |
   |---|---|---|---|
   | 6.1 | `WhereToRow` magnifier | `symbolEffect` bounce once per tap; the sheet opens in the same frame | System skips the bounce |
   | 7.1 | `ItineraryLayer` | Camera fits first; ride legs draw in order over 650 ms on the `EASE_OUT` timing (`drawOn.ts`); walks appear at once, dotted; ≤ 24 overlay adds | All legs at once |
   | 7.2 | 13/04 strip map | Dashed-outline trains, linear, paused offscreen, with the caption | Static dots (regression check only) |
   | 7.3 | Result leave time, Go hero, Live Activity | `numericText` with `countsDown: true` + `Animation.smooth(0.35)`; `Text` timer under a minute | System numeric transition |
   | 7.4 | `PlaceBanner`, `StationPhoto` | Look Around → Street View → snapshot; 16:9 at `radius.group`; placeholder block; fade-in 180 ms; 30-day cache | Fade only |
   | 7.5 | Result rows | 40 ms stagger, 220 ms ease-out, opacity 0→1, y 8→0, first results only, never on a retime | Opacity only, 200 ms |
   | 7.6 | Re-timed row | The time rolls; the status crossfades to "Updated · was HH:MM" for 4 s; **no haptic** | Crossfade |
   | 7.7 | `RouteLoader` | Hidden < 150 ms; three beads on a hairline, 900 ms loop; never a spinner | Static beads |
   | 7.8 | Live marks | Reused `SourceMark` pulse / `symbolEffect` pulse | Still dot |
   | 7.9 | `GoBody` | The node fills, the next rail goes 0.35 → 1 over 240 ms; success haptic on getting off | Opacity only |
   | — | Sheet body peek ⇄ glance | In 240 ms with 10pt rise, out 140 ms (`SheetBody`) | Fade only |

2. **Haptics audit.** Log every haptic for one full journey and compare against README §4.
   - selection: the Where to? tap, swap, picking a suggestion;
   - success: Go, saving a place, getting off, arriving;
   - warning: next stop is yours;
   - light: a leg tap, End, recenter.

   **None** on a retime, loader, scrolling or countdown tick.

3. **VoiceOver pass.** Every element below must read exactly as written, in a sensible order.
   - **Capsule:** "Where to?, button, Search for a place and plan a trip". Circles: "Directions home", "Directions to work".
   - **Plan sheet:**
     - search field;
     - From row ("From, My location") and "Swap start and destination";
     - When menu ("Leave now, menu");
     - suggestion rows per 03 step 8.
   - **Result rows:** exactly criterion 7. Assert the `resultAccessibilityLabel` test string matches what VoiceOver speaks.
   - **Itinerary timeline:** one element per row, as 05 step 5. Station rows have the hint "Opens the station". DisclosureGroups announce expanded and collapsed.
   - **Go:**
     - the peek strip instruction is read once;
     - the off-route row reads "Off route? Re-plan from here, button";
     - Live Activity text is spoken on the Lock Screen.
   - Live and scheduled always come as a word, never colour alone (README principle 4).

4. **Dynamic Type at accessibility sizes (AX3) and XXL.**
   - **Capsule:** the placeholder truncates, and the capsule stays 44pt (glass chrome).
   - **Result rows:** the leave time and duration wrap to two lines rather than overlap; chips wrap; the journey bar stays one line.
   - **Timeline:** the time column grows (`minWidth` 52, not fixed). Times never truncate.
   - **Settings → Places:** names wrap to 2 lines.
   - **Peek:** this detent is a fixed point height. Confirm nothing in the trip peek overflows at XXL. At AX sizes the system may clip, as it already does; note it and don't fix it here.

5. **Dark mode and satellite.**
   - `ItineraryLayer` uses `mapScheme` (`index.tsx:316`), so walk dots, ink and casings read on satellite.
   - Rail line colours keep their 7pt paper casing.
   - Thumbnails and snapshots switch to dark.
   - The glass capsule stays legible over the dark map at both ends of the iOS 27 Liquid Glass transparency slider.
   - Check Reduce Transparency.

6. **Break-ui worst cases** (`break-ui`). Each gets a screenshot in the PR.
   - **Long names:**
     - "Sunway-Setia Jaya";
     - "Pusat Bandar Puchong (Pintu B)";
     - Apple places with 60+ character titles and addresses.

     Check every row, the timeline, the Live Activity (`lineLimit(1)` + truncation) and the widget home line.
   - **Zero results:** points in the sea or the far north. Check the `ContentUnavailableView` copy. For the walk-only boundary, 2.1 km apart late at night.
   - **Most legs:** a 4-ride itinerary (the engine cap) with 5 walks, i.e. 9 chips that collapse inner walks. Also force a 5-ride fixture through `ResultRow` and `Timeline`: rendering must not depend on the cap.
   - **Five results**, all with tags, live and scheduled mixed. The stagger ends in < 500 ms.
   - **Expired feeds:**
     - rail expired (date past 2026-12-31): the note, then bus/KTM only (criterion 8);
     - KTM expired (past 2026-11-05);
     - both expired.

     The notes come from `PlanResult.excludedFeeds` and show **even with zero results**. Station search still lists bundled `RAIL_STATIONS`.
   - **No spare realtime budget:** follow two routes in different categories, then plan via a third category. Rows, the itinerary and Go all stay "Scheduled" and the paused-live note shows. The network log never exceeds 4 requests/min.
   - **Missed connection:** a fixture snapshot that breaks a transfer. The row, the itinerary and Go all show "Connection missed. Times updated · was HH:MM", and the open itinerary follows its successor.
   - **No location permission:** From reads "Choose a starting point"; Go works with the bus fix and the clock; no Always prompt ever appears.
   - **Airplane mode:**
     - station and stop search and planning work;
     - Places shows "Places need a connection";
     - walk legs stay straight;
     - banners fall back to cached imagery or collapse (criterion 6).
   - **First launch offline** (no network blob): "Routes need today's timetable".
   - **The 04:00 service-day switch:** plan at 03:55 and at 04:05 with Depart at; results come from the right network.
   - **Many sheets at once:** a station sheet opened from the itinerary, then back. The trip peek never shows above another sheet.

7. **Performance.** Use a Release build on iPhone 13 and record the numbers in the PR.
   - Cold launch → Where to? → "KLCC" → first rows **< 1.5 s** (`firstResultMs`; criterion 1).
   - `plan()` p95 < 400 ms of JS time (14/00 harness) on three golden queries.
   - `buildLocalIndex` < 30 ms; first local suggestions within one frame of a keystroke.
   - The draw-on drops ≤ 2 frames (Perf Monitor). Typing and the loader never stall the JS thread for > 100 ms.
   - Hermes heap after 10 searches and 3 opened itineraries is within +40 MB of the post-launch baseline (README "Memory and search").
   - Realtime requests stay ≤ 4/min with 2 favourites plus planner subscriptions (network log over 5 min).

8. **Automated gates.** All tests green, type-check clean, and no `console.warn` from `[live-activity]` or `[widget]` during a full journey.

9. **Docs: the phase hand-off.**
   - In `docs/design/README.md`:
     - add a v3 changelog bullet for "Where to?" (the peek capsule, the `plan` → `itinerary` sheets, Go mode);
     - update §2's IA tree with `plan`, `itinerary`, `station`, `line` and Go;
     - add a short §7 Motion pointer to spec §7.
   - In `docs/design/feature-roadmap.md`: mark multi-leg planning, saved places and Go mode built, and add a "Where the code lives" row (`components/plan/`, `components/itinerary/`, `components/map/ItineraryLayer.tsx`, `modules/transit-maps`, `state/PlannerContext.tsx`, `components/ride/journey.ts`).
   - Record the follow-ups:
     - arrive-by (reverse RAPTOR);
     - fares;
     - a holiday calendar for rail and bus-kl;
     - KTM live;
     - the schematic diagram;
     - background home re-planning for the widget;
     - a separate "Go home" widget kind (native).

## Verification
- `pnpm --filter mobile test` and `pnpm --filter @bus-tracker/shared test` pass.
- `pnpm type-check`.
- Release build on iPhone 13 (`npx expo run:ios --configuration Release --device`): success criteria 1–8 from `./README.md` checked one by one, with the steps 1–7 tables filled in and screenshots attached.
- The iPhone SE and Pro Max simulators pass steps 4 and 6.
- Steps 1–3 re-run with Reduce Motion **and** VoiceOver on together.
- The docs diff covers `docs/design/README.md` and `docs/design/feature-roadmap.md` only.

## Handoff to next step ([README.md](./README.md))
**Phase complete.** Phase 15's hand-off (`./README.md` "Hand-off (post phase)") is satisfied:
- `docs/design/README.md` mentions Where to? and the station, line and itinerary sheets;
- the roadmap marks multi-leg planning as built;
- the follow-ups are recorded.

The next work starts from those follow-ups. Pick one with `poteto-mode` and give it its own phase folder.

## Implementation notes (QA fixes)

- **Search autofocus.** `Stack.SearchBar`'s `autoFocus` is Android-only in react-native-screens 4.30. `plan.tsx` now focuses the bar through its ref on the sheet's `transitionEnd`, with a 700 ms fallback, but only when there's no destination yet. Verified: typed text lands straight away.
- **Walk-row notes** (`stationModel.interchangeNote`). The curated notes are written from the `a` end. From the `b` end the note now names the other side, e.g. on KTM KL Sentral: "Walk to the LRT and Monorail platforms in KL Sentral". Verified on the Simulator.
- **Search index.** `LocalIndexWarmer` in `TransitNetworkProvider` builds `localIndexFor(network)` (~50 ms) in idle time, so the first keystroke doesn't pay for it.
- **Interchange markers at the widest zoom: left as they were.** Making them `required` showed every interchange at zoom ~9, but as a tangled pile over the city centre. MapKit hiding the overlaps at `'high'` reads better, and every interchange shows from zoom 10.
- **One Live Activity** (`services/liveActivityOwner.ts`). While Go is on, a followed bus doesn't start its own activity, and one already up ends. It comes back after Go.
- **"Leave now" re-plan** (`session.replanDue`). This applies while the sheet is up and When is now. Once the earliest riding row's leave time is more than 30 s past, it plans again, at most once a minute. It is checked on a 10 s clock, never from a retime. The rows clear and the loader may show, as on the 2-minute reopen re-plan.
- **Location** (`services/planner/quickFix.ts`). It takes the first of these that is available:
  1. a last-known fix ≤ 60 s old;
  2. a fresh fix within 4 s;
  3. a last-known fix ≤ 10 min old;
  4. the fresh fix whenever it comes.

  The fourth step is a root fix. Without it, a cold start with no last-known fix showed "Your location isn't available" after 4 s. The ~10 s first-result times seen earlier came from a stale simulated location. After re-setting it, the Pavilion plan took 320 ms.
- **Haptics and VoiceOver audit fixes:**
  - Go plays only success; `unfollow({ silent: true })` removes the extra light haptic.
  - The When menu label is just its value, so it reads "Leave now, menu".
  - The "Off route?" head no longer hides "Not now", and the button reads "Off route? Re-plan from here".
  - `GlassCapsuleButton` labels itself with its visible text.
  - Timeline rows with no action no longer read "dimmed".
  - The stop summary for a ride with no stops in between is hidden from VoiceOver, so the ride isn't read twice.
  - Each Settings → Places row is one element.
- **Dev harness removed.** `app/dev-network.tsx`, `app/dev-planner.tsx`, `services/devStages.ts`, their routes, Settings rows and stage markers.
- **Build impact:** JS-only.
- **Cold-launch quick actions** (native: `patches/expo-quick-actions@6.0.2.patch`). This was not a dev-client artifact; a Release build lost them too. Under the scene lifecycle, a cold-launch shortcut skips `launchOptions`. Expo's `ExpoAppSceneDelegate` forwards it to `performActionFor` before JS listens, and expo-quick-actions only posted an event that nobody received.
  - The patch keeps the item as `initial` while no JS observer is attached.
  - Verified in a Release Simulator build: a cold launch from the Home quick action opens the Pavilion results.
  - Native change: rebuild the app (`pod install` isn't needed, because the pod reads `node_modules`).
- **Release Simulator run.** Cold launch → Where to? → KLCC: rows are on screen within the first screenshot after the pick. `firstResultMs` is a dev-only log; the dev build measured 320 ms with a fresh fix. The iPhone 13 numbers are still to do on a device.
- **Dynamic Type.**
  - At XXXL: the trip peek fits, result rows wrap without overlapping, and the search placeholder truncates.
  - At AX sizes: the fixed-height trip peek clips the hero. Noted as the spec says, not fixed.
  - The SwiftUI When menu doesn't grow with text size.
- **Dark mode.** The peek, plan sheet, Saved thumbnail and destination snapshot all switch.
- **Reduce Motion.** Reanimated picks it up, and the itinerary opens with every leg already drawn.
