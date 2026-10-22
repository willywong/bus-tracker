# 15-Journey-Planner-UI / 06 — Go Mode

**Build impact:** JS-only (Metro reload). The Live Activity layout and props change, but expo-widgets stores the layout string at runtime: `LiveActivityFactory` writes it to the App Group when the app creates the factory (`node_modules/expo-widgets/ios/LiveActivityFactory.swift:12-14`). After a Metro reload, **kill and relaunch the app once** so the new layout is registered before starting a journey. No new activity name, no `app.json` change, no prebuild.

## Context
- **Go entry.** 05's itinerary sheet has a glass **Go** that calls `ride.startJourney(it)`. `useOpenItinerary()`, `ItineraryLayer`, `Timeline` / `timelineRows` and the cached `walkPaths` all exist.
- **On-board mode today** is one route only, in `state/RideContext.tsx`:
  - `ActiveRide` is `{ routeCode, boardStopId, destStopId, vehicleId }` (:32-38);
  - a change of trip route or stop ends it (:99-104);
  - it watches phone GPS while riding (:107-127) and falls back to the bus fix (:129-133);
  - `advanceRide` runs on each fix (:135-143);
  - next-is-yours gets a warning haptic and speech, arrival a success haptic (:146-159);
  - one background get-off alert is scheduled (:162-172);
  - it auto-ends 2 min after arrival (:59, :174-178).

  `advanceRide` / `rideMinutes` (`components/ride/model.ts:74-123`) work on any `RideStop[]`. The trip sheet's ride branch is `app/trip.tsx:198-241` (`RideBody`).
- **Live Activity.**
  - `BusActivityProps` (`activities/BusArrivalActivity.tsx:29-52`) has `kind: 'arrival' | 'pre-service'`.
  - The layout function is marked `'widget'` (:76) and is serialised to a string. Every helper and constant must live inside the function (:66-73, and the memory note). A module-scope reference renders an empty island.
  - Producers: `hooks/useBusLiveActivity.ts` (pre-service props :102-117, arrival props :173-189, `start(next, 't816://')` :122/:198), driven from `TripContext.tsx:177-188` while `isFollowing` (:141).
- **Notifications** (`services/reminders/notifications.ts`):
  - one id per alert kind (:30-33);
  - `scheduleGetOffAlert` replaces its single `bt.get-off` slot (:435-458), so per-leg alerts need their own ids;
  - `RESERVED_NOTIFICATION_SLOTS = 4` (`services/reminders/plan.ts:16`) sets `COMMUTE_MAX_PENDING` (:18).
- **Geofence** (`services/arrival/geofence.ts`):
  - one task, `ARRIVAL_GEOFENCE_TASK` (:22, handler :47-58), with region ids `routeCode|stopId` (:31);
  - at most 20 regions (:28);
  - `startGeofencingAsync` replaces the whole set (:135-155);
  - it needs Always permission and is opt-in (`isArrivalAlertEnabled`, :101).
- **Spec §8.**
  - The Live Activity shows the current leg ("Walk to Hotel Lisa De Inn · T816 in 3 min" → "On T816 · 4 stops to MRT Phileo Damansara" → "KG towards Kajang · every 6 min · get off at Pasar Seni").
  - A leave-now alert, then get-off and change alerts for each ride leg.
  - Rail progress comes from elapsed time against template run offsets and says "about".
  - Off route (> 400 m) offers "Off route? Re-plan from here" as a button, never automatically.
  - §7.9: a leg completes → its node fills, the next rail brightens, and a success haptic fires on "get off now".
  - Copy uses `mins()`.

## Goal
Go follows an itinerary leg by leg:
- the trip sheet shows the timeline with the current leg;
- the Live Activity mirrors the current leg;
- timed (and, if enabled, geofenced) alerts fire for leave, change and get-off;
- rail legs progress "about" by the clock;
- going off route offers a user-initiated re-plan.

Single-route ride mode keeps working unchanged.

## Prerequisites
- 05 merged.
- Invoke `animate-expo` for §7.9 and `expo:expo-ui` for the activity layout. No Swift is written here.

## Steps

1. **Journey model (pure)** in `components/ride/journey.ts`:
   ```ts
   export type JourneyPhase = 'walking' | 'waiting' | 'riding' | 'next-is-yours' | 'leg-done' | 'arrived';
   export interface JourneyProgress {
     legIndex: number; phase: JourneyPhase;
     passedIndex: number;            // within the current leg's stop sequence
     stopsToGo: number | null;       // ride legs
     approximate: boolean;           // rail: progress from the clock, say "about"
     nextStop: RideStop | null; legEndsAt: number;
   }
   export function legSequence(leg: Leg): RideStop[];                     // from + via + to
   export function advanceJourney(it: Itinerary, prev: JourneyProgress | null,
     position: LatLng | null, now: number): JourneyProgress;
   export function offRouteMeters(position: LatLng, paths: LatLng[][]): number;
   export function journeyActivityProps(it: Itinerary, p: JourneyProgress, now: number): BusActivityProps;
   ```
   - **Walk leg:** done within `AT_STOP_METERS` (`components/ride/model.ts:29`) of `leg.to`, or 2 min after `leg.to.time` with no position.
   - **Bus leg:** `advanceRide(legSequence(leg), position, passedIndex)`. A live vehicle's fix stands in when there's no phone fix.
   - **Rail leg** (`mode` in `lrt | mrt | monorail | brt | ktm`): `passedIndex` = the last `via` with `time ≤ now`, ignoring GPS. `approximate: true`.
   - `next-is-yours` follows `advanceRide`'s rule. The leg completes when the alight stop is reached. The last leg completing is `arrived`.

2. **Model tests.** `components/ride/__tests__/journey.test.ts`:
   - `walk leg completes near its end`
   - `bus leg advances with advanceRide`
   - `rail leg advances by the clock and is approximate`
   - `last leg completion is arrived`
   - `off-route distance uses the nearest path segment`
   - `activity props read "Walk to Hotel Lisa De Inn · T816 in 3 mins"`
   - `activity props for rail say every and get off at`

3. **Generalise `RideContext`.**
   - `ActiveRide` becomes `{ kind: 'route'; …existing } | { kind: 'journey'; itinerary: Itinerary; startedAt: number; vehicleId: string | null }`.
   - The value adds `journey: JourneyProgress | null`, `itinerary: Itinerary | null`, `startJourney(it)` and `offRoute: boolean`.
   - The end-on-route-change effect (:99-104) applies to `kind === 'route'` only.
   - The GPS watch (:107-127) runs for both kinds.
   - For a journey, call `advanceJourney` on each fix **and** on a 15 s interval, so rail legs move with no GPS.
   - `startJourney(it)` does the following:
     1. `trip.unfollow()`, which ends the bus activity (one activity at a time);
     2. sets the ride;
     3. `realtimeStore.setPlannerRoutes(<the journey's bus-leg routes>)`. A category in a followed feed is free. Otherwise it is polled at 60 s only from spare budget (04 step 2). When `plannerSkipped` holds the current bus leg's category, that leg stays "Scheduled" in the sheet and the Live Activity (`source: 'schedule'`), and is never shown as live;
     4. `ensureNotificationPermission()` and `haptics.success()`;
     5. `router.dismiss()` on the itinerary sheet.

     When the itinerary sheet unmounts, `planner.presented` turns false and the trip sheet un-pins.
   - **Live re-timing during Go.**
     - On each new realtime snapshot, call `retime([itinerary], live, net, { to: itinerary's destination, walkMetersPerMin: 80, modes })` (spec §4.4).
     - If the result's id changed (tail re-planned), adopt it via 05's `findSuccessor` and keep `legIndex` on the same first legs.
     - A `'missed-connection'` warning shows a `GoBody` note, "Connection missed. Times updated · was 9:12" (04 `updatedNote`), and re-schedules the alerts (step 6).
     - Only the legs not yet done are re-timed. Completed legs keep their actual times.
   - **Haptics** (§7.9, README §4):
     - `next-is-yours` on a ride leg gives a warning, plus speech when `speak` is on;
     - `leg-done` on a ride leg (got off) and `arrived` give success;
     - walks and waits give none.

4. **Go sheet body.** In `trip.tsx`'s ride branch (:198-241), render `<GoBody>` (`components/ride/GoBody.tsx`) when `ride.itinerary` is set, and keep `RideBody` for route rides.
   - **Header:** `SheetHeader` with `title="To KLCC"`. The compact value is the current leg's minutes or stops, or "Here".
   - **Peek strip:**
     - left: the current instruction ("Walk to Hotel Lisa De Inn", "On T816 · 4 stops", "Kajang Line · about 3 stops");
     - right: "Arrive 9:52".
   - **Body:** 05's `Timeline` with `currentLeg` and `progress` props.
     - Done nodes fill solid ink.
     - Rails after the current leg sit at 0.35 opacity. On leg change, the next rail animates to 1 over `motion.sheetIn` with `EASE_OUT` (a plain crossfade, which is fine under Reduce Motion).
     - Rail rows read "about".
   - **Below the body:**
     - the "Announce my stop" `ToggleRow`, as in `RideBody`;
     - a bordered "End" capsule (`RideBody.tsx:97-110` pattern), or "Done" once arrived.
   - **Map:** `index.tsx` keeps `ItineraryLayer` mounted while `ride.itinerary` is set (final polylines, no draw-on). It frames the current leg plus your position on leg changes.

5. **Live Activity.**
   - In `BusArrivalActivity.tsx`, add `'journey'` to `kind` and append these fields to `BusActivityProps`:
     ```ts
     /** Journey only: current instruction, e.g. "Walk to Hotel Lisa De Inn · T816 in 3 mins". */
     legText: string | null;
     /** Journey only: "Leg 2 of 4". */
     legIndex: number | null; legCount: number | null;
     /** Rail progress from the timetable clock: show "about". */
     approximate: boolean;
     ```
   - For a journey:
     - `routeCode` is the chip label ("T816", "KG", or "Walk");
     - `stopName` is the leg's target;
     - `arrivalEpochMs` is when the leg ends;
     - `source` is `'live'` only for a live bus leg.
   - Inside the `'widget'` function, add `const isJourney = props.kind === 'journey'` and branch the hero, status and expanded regions inline:
     - hero: the leg's minutes via `Text` `timerInterval` (`node_modules/@expo/ui/build/swift-ui/Text/index.d.ts:30-37`);
     - line 2: `legText`;
     - status: "about" when `approximate`.

     **No new module-scope helpers.**
   - Set the new fields to `null` / `false` in `useBusLiveActivity.ts` :102-117 and :173-189.
   - Add a thin `hooks/useJourneyLiveActivity.ts`:
     - start with `BusArrivalActivity.start(journeyActivityProps(...), 't816://')`;
     - `update` when `shallowEqual` says the props changed (copy the helper from `useBusLiveActivity.ts:25-30`);
     - `end('default')` on arrival or end.

     Stale date: live bus legs only (`LIVE_STALE_AFTER_MS`, :55).

6. **Journey alerts.**
   - Add a pure `planJourneyAlerts(it, now): { id: string; atMs: number; title: string; body: string }[]` to `services/reminders/plan.ts` (it stays dependency-free):
     - `bt.go.leave`: at the first walk leg's `from.time`, i.e. the itinerary's own access walk at 80 m/min. Not `settings.walkMinutes`, which is the walk to the favourite stop;
     - `bt.go.leg.<i>`: 60 s before each ride leg's alight time. Body for a change: "Change at Pasar Seni for Kelana Jaya Line" / "Get off now. About a 4-min walk to the platform." For the last leg: "Your stop is next: KLCC";
     - drop alerts that are already in the past.
   - Raise `RESERVED_NOTIFICATION_SLOTS` from 4 to 9 (4 existing + leave + 4 legs) and update its comment.
   - `notifications.ts` gains `scheduleJourneyAlerts(alerts)` (`timeSensitive`, `threadIdentifier: 'bt.go'`, data `kind: 'go'`) and `cancelJourneyAlerts()`.
   - Reschedule when a retime moves an alert by > 60 s, mirroring `RESCHEDULE_DRIFT_MS` (`RideContext.tsx:61`).
   - Cancel all of them on end.
   - Tests added to `services/reminders/__tests__/plan.test.ts`:
     - `journey alerts: leave, change per ride, get-off last`
     - `past alerts are dropped`
     - `ids never exceed bt.go.leg.3`

     The existing `COMMUTE_MAX_PENDING` assertions (:249-250) still hold through the constant.

7. **Geofence reuse (opt-in only).**
   - Add a pure `services/arrival/regions.ts`:
     - `goRegionId(legIndex, stopKey)` → `go|<i>|<stopKey>`;
     - `parseRegionId(id)` → `{ kind: 'favourite', routeCode, stopId } | { kind: 'go', legIndex }`;
     - `mergeRegions(go, favourites, max = 20)`, which puts go regions first.

     Tests in `services/arrival/__tests__/regions.test.ts`.
   - In `geofence.ts`, when `isArrivalAlertEnabled()`:
     - `startJourney` writes a minimal `bt.go.active` (SecureStore, `AFTER_FIRST_UNLOCK`: alight names and next lines);
     - it re-syncs with a 120 m region per ride-leg alight stop.
   - The task handler (:47-58) routes `go|` ids to an immediate leg alert and cancels that leg's timed alert.
   - End clears the key and re-syncs favourites only.
   - Without Always permission, timed alerts only. **Never** ask for Always from Go.

8. **Off route.**
   - With a phone fix, compute `offRouteMeters` against the walk paths (05 `walkPaths`) and the ride-leg coords. `offRoute` turns true after 2 fixes ≥ 30 s apart that are both > 400 m.
   - `GoBody` then shows a row: `arrow.triangle.branch` glyph, "Off route?", and a glass button "Re-plan from here".
     - The button calls `planner.setFrom({ kind: 'here', … })`, `setTo(destination)`, `setWhen({ kind: 'now' })` and `router.push('/plan')`.
     - "Not now" hides the row for 5 min.
   - The current journey continues until the user taps Go on a new itinerary, and `startJourney` replaces it. Nothing re-plans on its own.

9. **End.** `end()` (button, or 2 min after `arrived`):
   - cancel journey alerts;
   - end the activity;
   - clear go regions;
   - `setPlannerRoutes([])`;
   - `haptics.light()`.

## Verification
- `pnpm --filter mobile test`: `journey.test.ts`, `plan.test.ts` and `regions.test.ts` pass.
- `pnpm type-check`.
- Metro reload, then kill and relaunch the app once (layout registration).
- Device (iPhone 13), Hotel Lisa De Inn → KLCC, using `EXPO_PUBLIC_DEV_NOW_OFFSET_MS` (`utils/devClock.ts`) off-hours (criterion 5):
  - Go dismisses the itinerary, the trip sheet shows the timeline, and the Lock Screen and Dynamic Island show "Walk to Hotel Lisa De Inn · T816 in N mins".
  - Boarding advances to "On T816 · N stops to …".
  - The rail leg shows "about" and advances with the clock in airplane mode.
- Notifications: `getAllScheduledNotificationsAsync()` lists `bt.go.leave` and one `bt.go.leg.<i>` per ride leg. Each fires at its time with the screen locked.
- With the arrival alert enabled (Always), walking into a transfer stop's 120 m region posts the change alert at once. With it disabled, no Always prompt ever appears.
- Simulator location 500 m off the path: after about 30 s, "Off route? Re-plan from here" appears. Nothing happens until it's tapped, and then results load from the current location.
- A route ride (Alert me before my stop) still behaves exactly as before.
- Follow two routes in other categories, then Go on a journey whose bus is in a third category. The bus leg reads "Scheduled" in the sheet and on the Lock Screen, and no extra realtime feed is polled.
- Force a missed connection with a fixture snapshot: the Go note shows "was HH:MM", and `bt.go.leg.*` alerts move to the new times.
- The empty-island check: the expanded, compact and minimal regions all render text for a journey (the inline-only rule).

## Handoff to next step ([07-saved-places-and-shortcuts.md](./07-saved-places-and-shortcuts.md))
- `RideContext` supports `{ kind: 'journey' }`. `journeyActivityProps` and `planJourneyAlerts` are pure and tested. `BusActivityProps` has `kind: 'journey'` plus `legText` / `legIndex` / `legCount` / `approximate`.
- `RESERVED_NOTIFICATION_SLOTS = 9`. Go regions share the 20-region budget with favourites.
- The re-plan path is `planner.setFrom/setTo` + `/plan`. 07's Home shortcut uses the same path.

## Implementation notes
- **Files.**
  - Pure: `components/ride/journey.ts` (`legSequence`, `advanceJourney`, `offRouteMeters`, `offRouteStep`, `journeyPaths`, `honestTiming`, `retimeFrom`, `retimeJourney`, `keepWalkPaths`, `legText`, `journeyActivityProps`, `goInstruction`, `goCompact`, `arrivalIsApproximate`), `services/arrival/regions.ts`, `services/planner/workspace.ts`. `services/reminders/plan.ts` gains `planJourneyAlerts`, `journeyAlertsMoved`, `GO_ALERT_IDS`, `goLegAlertId`. `services/realtimePlan.ts` gains `mergeExtraRoutes`. `components/itinerary/model.ts` gains `rowProgress`.
  - Views and hooks: `components/ride/GoBody.tsx` (`GoBody`, `goHeader`, `LegBadge`), `hooks/useJourneyLiveActivity.ts`.
  - Edited: `state/RideContext.tsx`, `app/trip.tsx`, `app/itinerary.tsx`, `app/index.tsx`, `activities/BusArrivalActivity.tsx`, `hooks/useBusLiveActivity.ts`, `hooks/usePlannerEngine.ts`, `services/realtime.ts`, `services/reminders/notifications.ts`, `services/arrival/geofence.ts`, `components/itinerary/Timeline.tsx`, `components/trip/SheetHeader.tsx` (+ optional `badge`).
  - Tests: `components/ride/__tests__/journey.test.ts` (the 7 named), `services/reminders/__tests__/plan.test.ts` (+3 named), `services/arrival/__tests__/regions.test.ts` (3), +1 in `components/itinerary/__tests__/model.test.ts` (`rowProgress`) and +1 in `services/__tests__/realtimePlan.test.ts` (`mergeExtraRoutes`). `packages/shared` is unchanged.
- **Realtime (step 3.3).** There is no `setPlannerRoutes` (see 04's notes). `setExtraRoutes(source, routes)` now keeps one list per source, `'planner'` or `'go'`, and polls their merge (`mergeExtraRoutes`, routes unioned per category). The planner's sheet closing clears only `'planner'`, so Go's bus stays polled. Go `start()`s the store (ref-counted) for as long as the journey runs and registers `plannerRealtimeRoutes` over the legs from the current one, re-registered on every 15 s beat, so the current (or next) bus leg is the one polled. `plannerSkipped` holding that leg's category makes `journeyLiveSkipped` true: the leg reads "Scheduled" in the sheet and on the Lock Screen, and the sheet shows `LIVE_PAUSED_NOTE`.
- **Re-timing.**
  - `retimeJourney(base, current, from, live, net, ctx, startedArriveAt)` retimes only `base.legs.slice(from)` and keeps `current.legs` before `from` as they are. `from` is `retimeFrom(progress)`: the current leg until you board it, then the next one. A ride you are on keeps the times (and live vehicle) it had when you boarded.
  - `base` is the itinerary as Go started, or the last re-planned one adopted. When a retime changes the id (a tail re-plan), Go adopts the result as the new `base`, keeps the leg index (the legs before the break are unchanged by construction), and keeps walk paths only for walks with the same ends (`keepWalkPaths`). With a single itinerary there is nothing to choose between, so `findSuccessor` isn't used.
  - The started itinerary is the planner's retimed one, not `plan()`'s raw output, which the engine doesn't expose. Retiming a live-shifted leg again is idempotent (`delta` is measured against its current time), so this is safe.
  - `previousArriveAt` is the arrival when Go started, once moved ≥ 1 min. `detailNotes` then gives "Connection missed. Times updated · was 9:12" (orange) or "Updated · was 9:12".
  - **Workspace.** `services/planner/workspace.ts` marks a network busy while `usePlannerEngine` has a `plan()` suspended on it (`holdWorkspace` around the run). Go skips a retime on a busy network and catches up on the next snapshot. A "Re-plan from here" during Go can't clobber the plan's labels.
  - **Honesty.** `honestTiming` shows a live leg as scheduled once its fix is older than 3 min or its feed is skipped, so a frozen "live" never shows. Rail is never live.
- **Progress model deviations.**
  - A bus leg with no position (no phone fix, and no live vehicle fix yet) advances by the clock like rail, with `approximate: true`, so it can't stick.
  - The live vehicle's fix stands in only once the leg's board time has passed. Before that the bus is still coming towards you and would read as "riding".
  - A ride leg is `waiting` while not past the first stop and within 100 m of it (with a position), or before its board time (by the clock).
  - A walk into a rail leg also ends by the clock (`to.time` + 2 min) even with a position, because stations are where GPS fails. Snap walks (< 30 s) are done at once, as the chips and timeline skip them.
  - `leg-done` is reported for one step; the next step (on a fix, the 15 s beat, or 4 s later) moves to the following leg.
- **Haptics.** Warning (plus speech when "Announce my stop" is on) on `next-is-yours` of a ride leg; success on `leg-done` of a ride leg and on `arrived`; none for walks and waits. The in-app warning cancels that leg's timed alert, as route rides do with `bt.get-off`, and it isn't rescheduled.
- **Alerts.**
  - `planJourneyAlerts(it, now, opts?)` takes optional `lineName`, `stopName` and `clock` so `plan.ts` stays dependency-free (type-only imports). Each alert carries `legIndex`.
  - Copy: the leave alert is "Leave now for T816" / "Walk 5 mins to Hotel Lisa De Inn. T816 at 08:05 (scheduled)." For rail it reads "every 4 mins" or "about 08:05". A change is "Change at Pasar Seni for Kelana Jaya Line" / "Get off now. About a 4-min walk to the platform." ("…to the stop" before a bus; "Get off now." with no walk). The last ride is "Your stop is next: KLCC" / "Get ready to get off."
  - There is no leave alert when the journey starts at the stop (a snap walk).
  - Alerts are rescheduled when `journeyAlertsMoved` says one moved > 60 s or one came or went (fired ones are pruned first).
  - Itinerary times use `devNow()`, so the scheduled times subtract `devClockOffsetMs()`.
  - Denied permission: `ensureNotificationPermission()` returns false, alerts are scheduled and never shown, and Go carries on. Each schedule is try/caught.
- **Geofences.** `bt.go.active` (SecureStore, `AFTER_FIRST_UNLOCK`) holds per ride leg its index, alight stop, and the full alert. `syncArrivalGeofences` always merges Go's regions (120 m) ahead of the favourites (`mergeRegions`, 20 max) and remembers the last favourites, so starting and ending Go re-sync without the trip. `startGoGeofences` / `clearGoGeofences` run serially. A `go|i|stop` entry posts that leg's alert at once under the same id (replacing the timed one) and drops the leg from the key. With the arrival alert off, or without Always, it does nothing and never prompts.
- **Live Activity.**
  - The hero, the compact trailing and the minimal regions are a SwiftUI `Text` timer to the leg's end (to boarding while waiting), so it ticks with the app suspended. Arrived shows "Here".
  - Line 2 is `legText`. The status reads "About · from the timetable" when `approximate`, and the trailing text is "Leg 2 of 4" (snap walks don't count; 1-based).
  - The timer range is clamped (`tripStart ≤ arrival`), since SwiftUI traps on an inverted range. Timer times are moved off the dev clock offset in the hook.
  - Live bus legs only get a stale date. Arrival ends the activity with `'default'`. A user's End ends it `'immediate'` (as the bus hook does on unfollow), not `'default'` as the step says.
  - No module-scope helpers; `frame` and `multilineTextAlignment` are modifier exports, available in the widget runtime.
- **Sheet.**
  - The Go branch sits before the empty-trip branch, so Go works with no route followed. `goHeader` gives the leg's badge (`RouteBadge`, `LineBadge`, or a walker), "To KLCC", the compact value ("Here" when done), the status, and the strip ("Walk to …" / "On T816 · 4 stops" / "Kajang Line · about 3 stops" | "Arrive 9:52", "Arrive about 9:52" when a headway leg is left).
  - `Timeline` takes `currentLeg` and `progress` (the phase). `rowProgress` decides done nodes (solid ink) and dimmed rails (0.35, a Reanimated CSS opacity transition over `motion.sheetIn` with `CSS_EASE_OUT`).
  - Tapping a leg fits it on the map (`planner.focus`).
- **Go entry.** `itinerary.tsx` calls `ride.startJourney(it)` then `router.back()` (as the other sheets close; the step says `router.dismiss()`). `startJourney` reads `run.network`, `run.query.to` / `.modes` and the cached `walkPaths[it.id]`, unfollows the bus, and sets the first progress at once, so the sheet never flashes the trip.
- **Map.** While Go runs (and no itinerary sheet is open), `ItineraryLayer` stays mounted with `animate={false}`. The trip's route, buses, ghost and shimmer stay hidden. The camera frames the current leg plus your phone fix (`ride.here`) on each leg change, trip detent change, recenter and station close, above the trip sheet. Ending Go re-frames the trip. The rail focus is released with the itinerary sheet (not re-claimed in Go).
- **For 07/08.**
  - The re-plan path is `planner.setFrom(HERE)`, `setTo(place)`, `setWhen({ kind: 'now' })`, `router.push('/plan')`.
  - `RESERVED_NOTIFICATION_SLOTS = 9`. Go regions share the 20-region budget.
  - `ride.itinerary` / `ride.journey` / `ride.journeyDestination` tell any surface (Home shortcut, widget) that a journey is running.
  - Following a bus while Go runs would start a second activity: `trip.follow()` doesn't end Go. 08 should decide (end Go, or block follow).
  - 08: check the timer widths in the compact and minimal regions on device, and `RAIL_AHEAD` legibility in dark mode.
- **Build impact:** JS-only (Metro reload), then kill and relaunch once so the new Live Activity layout is registered.

### Review fixes (root, verified on the iPhone 17 Pro Max Simulator)

- **Countdown lower bound.** `tripStartEpochMs` is `min(leg.from.time, now, arrival)`. A SwiftUI timer shows its whole interval until the lower bound passes, so a wait whose range started at boarding read 0:00. Checked on the Lock Screen: 10:23 at 05:59:17 for a 06:09:40 boarding, matching "780 in 11 mins".
- **Orphaned activities.** `services/liveActivity.ts` holds `startBusActivity`, which both hooks now use, and `endOrphanedActivities`. The first start of a JS run, or the journey hook's mount, ends any activity an earlier run left behind (app killed, dev reload). Before this, a killed Go left its card on the Lock Screen with stale times beside the new one. Checked by killing the app mid-Go: the card is gone after relaunch. Go itself is not restored after a kill.
- **Trip detent after Go.** The pin offers only detent "0". UIKit can keep "1" (glance) selected through it and return there when all three detents come back, without a `sheetDetentChange`, which left peek content in a half-height sheet. 500 ms after the detents return, the trip sheet now measures its top row (`measureInWindow`) and sets `detent` to the nearest one.
- **No fix when planning.** A "My location" plan that ended in `no-location` now watches for a fix and plans again when one arrives (`usePlannerEngine`). This was not re-triggered on the Simulator after the fix (the last-known fix kept answering).
- **For 08.** A "Leave now" plan waits for a fix under 60 s old. With a fixed Simulator location, the first results took about 10 s. Check on a device and consider racing `getCurrentPositionAsync` with a timeout. The 851 leg "towards KL1821 Pasar Seni" with 3 stops from Pasar Seni to Masjid Jamek is planner output to look at.
