# 15-Journey-Planner-UI / 04 — Results List

**Build impact:** JS-only (Metro reload)

## Context
- 03 sets `planner.from`, `planner.to` and `planner.when`, and leaves a results slot in `app/plan.tsx`.
- **Engine API** (spec §4.4, phase 14 hand-off):
  - `plan(net, q): Generator<void, PlanResult>`, where `PlanResult = { itineraries: Itinerary[]; excludedFeeds: FeedId[] }`;
  - `retime(its, live, net, ctx)` with `ctx = { to, walkMetersPerMin, modes }` re-times the first bus leg within 60 min and re-plans the tail when a transfer breaks;
  - `Itinerary.previousArriveAt?` is set by `retime` when times moved, which drives "Updated · was 9:12";
  - `Itinerary.warnings` is only `'last-service' | 'long-wait' | 'missed-connection'`;
  - feed-expiry notes come from `excludedFeeds`, even when `itineraries` is empty.

  Phase 15 calls these only through `usePlanner`.
- **Walk pace.** `PlanQuery.walkMetersPerMin` defaults to 80 (`WALKING_METERS_PER_MINUTE`, `packages/shared/src/utils/rail.ts:53`). There is **no walk-speed setting**: `Settings.walkMinutes` (`hooks/useSettings.ts:32`) is the walk to your own stop, not a pace. Phase 15 passes 80 and adds no setting.
- **Realtime.** Positions come from `services/realtime.ts`. It polls every 30 s (:28) for followed route codes only (`setRouteCodes`, :72, :419-438). `services/realtimePlan.ts` plans one feed per followed category (:56-102) and keeps only followed routes' vehicles (`isFollowed`, :162-168).

  Spec §4.3: two followed categories at 30 s already use the whole 4-per-minute budget. Planner categories that aren't followed are polled every 60 s **only from spare budget**. With none spare, the itinerary stays visibly "Scheduled" and is never silently dropped.
- **Long work.** The repo's pattern is to hand back the JS thread about every 8 ms with `setTimeout` (`docs/design/README.md` "Memory and search").
- **Motion** (spec §7.5–7.7):
  - rows enter with a 40 ms stagger (opacity 0→1, y 8→0, 220 ms ease-out), only on the first results;
  - re-timed times roll with `numericText`, and the status crossfades to "Updated · was 9:12" for 4 s;
  - a 3-bead loader appears only if `plan()` runs > 150 ms;
  - never a spinner.

  The existing `numericText` usage is `components/trip/Hero.tsx:89-97` (`contentTransition('numericText', { countsDown: true })` + `animation(Animation.smooth(...), hashText(text))`).
- **Copy.**
  - Calm Mono uses plural minutes: `mins()` at `components/trip/model.ts:664` and `formatDuration` at :669. The spec mock-ups say "4 min"; Calm Mono wins, so "Leave in 4 mins".
  - VoiceOver uses README success criterion 7 exactly.

## Goal
`usePlanner` turns the planner state into ≤ 5 ranked itineraries and keeps them re-timed live. `plan.tsx` shows them as rows: leave time, duration, leg chips, a proportional journey bar, the status line and a tag. It also has the loader, stagger, the feed-expiry notes (from `excludedFeeds`) and the footer.

## Prerequisites
- 03 merged.
- Phase 14 exports `plan`, `retime`, `LiveSnapshot`, `Itinerary`, `Leg`, `Place`.
- Phase 12 `useTransitNetwork().health`.
- Invoke `animate-expo`, `emil-design-eng`.

## Steps

1. **Walk pace.** Pass `walkMetersPerMin: WALKING_METERS_PER_MINUTE` (80) in every `PlanQuery` and `retime` ctx. Add no setting.

2. **Planner realtime routes, from spare budget only.**
   - In `services/realtimePlan.ts`, give `buildRealtimePlan` a 4th parameter `planner: readonly { code: string; category: BusCategory }[] = []`.
   - A planner route in a category that is **already followed** joins that feed: `aliases.set(code, code)`, `routes.add(code)`. This costs nothing extra.
   - A planner-only category is admitted only while budget is spare:
     - `spare = 4 − 2 × followedCategoriesWithRealtime` requests/min;
     - each admitted planner-only category costs 1 (polled at 60 s, i.e. every second 30 s tick);
     - admit at most 2 and at most `spare`.
   - Add `RealtimeFeedPlan.plannerOnly: boolean` and `RealtimePlan.plannerSkipped: BusCategory[]` (categories asked for but not admitted).
   - In `services/realtime.ts`, add `setPlannerRoutes(routes)` to `RealtimeStore`. It clears `plan` like `setRouteCodes` does. Expose `plannerSkipped` on `RealtimeSnapshot`.
   - The feed category comes from the leg's route feed: `'bus-kl'` → `'rapid-bus-kl'`, `'feeder'` → `'rapid-bus-mrtfeeder'`.

3. **Realtime tests.** Extend `services/__tests__/realtimePlan.test.ts`:
   - `planner route in a followed category joins that feed`
   - `one followed category leaves room for two planner categories`
   - `two followed categories admit no planner category and report it skipped`
   - `a planner-only category is marked plannerOnly`
   - `planner route matches by route_id alias`

4. **Pure model.** `components/plan/model.ts` (no RN imports) exports:
   - `leaveLabel(it, now)`: "Leave now" (≤ 0), "Leave in 4 mins", "Leave 10:42" (≥ 60 min, via an injected clock formatter);
   - `durationLabel(it)`: `formatDuration`;
   - `legChips(it, net)`: `Chip[]`, where `Chip` is `{ kind: 'walk'; minutes }`, `{ kind: 'bus'; label; every: number | null }` or `{ kind: 'rail'; label; color; textColor; every: number | null }`;
   - `journeySegments(it)`: `{ kind: 'wait' | 'walk' | 'bus' | 'rail'; seconds; color: string | null }[]`. The wait is the gap between the leg before the first ride and that ride's `from.time`;
   - `statusText(it)`: `{ live: boolean; text: string }`, e.g. "1 change · 650 m walk", "No changes · 120 m walk", "2 changes · 1.2 km walk". `live` is true only when the first ride leg is a bus with `timing.kind === 'live'`;
   - `tagLabel(it)`: "Fastest" / "Fewer changes" / "Less walking" / null;
   - `resultAccessibilityLabel(it, now, clock)`: "Leave in 4 minutes. 38 minutes. Walk 5 minutes, bus T816, Kajang Line, walk 3 minutes. Arrive 9:12. Fastest." (criterion 7). Rail uses the route long name without its mode prefix ("MRT Kajang Line" → "Kajang Line"). A bus is "bus T816";
   - `updatedNote(it, clock): string | null`: "Updated · was 9:12" when `it.previousArriveAt` is set and differs from `arriveAt` by ≥ 1 min;
   - `feedNotes(excludedFeeds): string[]`:
     - `'rail'` → "Rail timetable from data.gov.my has expired. Showing bus-only routes." (spec §3.6);
     - `'ktm'` → "KTM timetable expired. Showing routes without KTM Komuter.";
     - `'bus-kl'` / `'feeder'` → "<Rapid KL bus | MRT feeder> timetable expired. Showing other routes.";
   - `warningNote(it)`: `'missed-connection'` → "Connection missed. Times updated"; `'last-service'` → "Last service tonight"; `'long-wait'` → "Long wait for the first ride".

5. **Model tests.** `components/plan/__tests__/model.test.ts`:
   - `leave label pluralises and switches to a clock past an hour`
   - `segments sum to the journey`
   - `wait segment only before the first ride`
   - `status is Live only for a live first bus leg`
   - `rail headway chip carries every`
   - `accessibility label matches criterion 7` (exact string)
   - `updatedNote shows was for previousArriveAt`
   - `updatedNote ignores a sub-minute change`
   - `feedNotes covers rail and ktm and stays empty for none`
   - `warningNote maps missed-connection`

6. **Engine runner.** The mobile test glob covers only `components/`, `db/`, `services/` and `widgets/` (`apps/mobile/package.json` `test`). So the stepping and cancel logic goes in a pure driver, `services/planner/runPlan.ts`:
   - `runPlan(gen, { sliceMs = 8, schedule = setTimeout, now = performance.now }): { promise: Promise<PlanResult | null>; cancel(): void }`. `cancel` calls `gen.return()` and resolves `null`.
   - Tests in `services/planner/__tests__/runPlan.test.ts`:
     - `steps in slices and resolves the final value`
     - `cancel stops stepping and resolves null`
     - `a slice never exceeds sliceMs on a fake clock`

   The hook stays thin. `hooks/usePlannerEngine.ts` is called once inside `PlannerProvider`. It exposes `run: PlannerRun` on the context; screens read `usePlanner().run`.
   ```ts
   export interface PlannerRun {
     status: 'idle' | 'locating' | 'planning' | 'done' | 'no-network' | 'no-location' | 'error';
     itineraries: Itinerary[];           // ≤ 5, already retimed
     generation: number;                 // +1 when a new query's first results land (stagger key)
     updatedIds: Set<string>;            // ids whose previousArriveAt changed on the last retime; each cleared after 4 s
     excludedFeeds: FeedId[];            // from PlanResult; banners even when itineraries is empty
     liveSkipped: boolean;               // a first-bus category wasn't admitted (no spare budget): rows stay "Scheduled"
     showLoader: boolean;                // planning for > 150 ms
     firstResultMs: number | null;       // query start → first results
   }
   ```
   1. Do nothing until `planner.presented && planner.to`.
   2. Resolve `from.kind === 'here'` with `Location.getLastKnownPositionAsync({ maxAge: 60_000 })`, falling back to `getCurrentPositionAsync({ accuracy: Balanced })`. No permission gives `'no-location'`.
   3. Key the query as `from|to|departAt minute`. A new key cancels the old run: a cancelled flag, `clearTimeout`, then `gen.return()`.
   4. Step the generator with `runPlan(plan(net, q))`, in about 8 ms slices.
      - `net` is `useTransitNetwork().network`, served for `serviceDate(now − 4 h)` plus the next day. The service day switches at 04:00 MYT (phase 12/06).
      - A `departAt` beyond that span sets status `'no-network'` instead of planning on the wrong day.
   5. A 150 ms timer sets `showLoader` if still planning.
   6. When done:
      - Collect the categories of first bus legs boarding within 60 min. Call `realtimeStore.setPlannerRoutes(top 2)`.
      - Subscribe to `realtimeStore`. On each new `lastUpdated`, call `retime(base, toLiveSnapshot(snap), net, { to, walkMetersPerMin: 80, modes })`. `LiveSnapshot` is `{ byCategory: { [category]: { asOf, positions } } }` (spec §4.4); build it from the snapshot's positions grouped by category.
      - Add to `updatedIds` every id whose `previousArriveAt` is new or changed.
      - `liveSkipped` = `snap.plannerSkipped` contains a category that one of the itineraries needs.
      - `generation` does not change on a retime.
   7. Copy `excludedFeeds` from `PlanResult` as is. Don't derive it from itinerary warnings or recompute it from `health`.
   8. When `presented` turns false, call `setPlannerRoutes([])` and keep the results in memory so reopening is instant.

7. **Row components** in `components/plan/`:
   - **`ResultRow.tsx`** (`{ it, now, updated /* run.updatedIds.has(it.id) */, index, animateIn, onPress }`), a `Pressable` with four lines and 12pt vertical padding:
     1. `leaveLabel` as an `@expo/ui` `Text` in `Host matchContents`, with `font({ size: 20, weight: 'semibold' })`, `monospacedDigit()`, `contentTransition('numericText', { countsDown: true })` and `animation(Animation.smooth({ duration: 0.35 }), hashText(label))`. On the trailing edge, `durationLabel` (`type.status`, `color.label`).
     2. `<LegChips>`, then on the trailing edge the arrival clock (`formatClockHHMM`, secondary, tabular).
     3. `<JourneyBar>`.
     4. `SourceMark` (`Hero.tsx:213`, `live` or `scheduled`) + "Live" / "Scheduled" + " · " + `statusText`, with the tag trailing (`type.footnote`, weight 600). When `updated` is set, this line crossfades (`FadeIn` / `FadeOut`, `motion.crossfade`) to `updatedNote(it)` for 4 s.

        A `warningNote` sits under the row in `type.footnote`, secondary (orange only for `'missed-connection'`).

     `accessibilityLabel={resultAccessibilityLabel(...)}`, `accessibilityRole="button"`, hint "Shows the steps and the map".
   - **`LegChips.tsx`** builds the chips from left to right:
     - walk: `figure.walk` 12pt + minutes;
     - bus: `RouteBadge size="small"` (`components/trip/SheetHeader.tsx:266`);
     - rail: a filled chip in the line colour, using `route_text_color`, height 20, radius 5;
     - separator: `chevron.right` 9pt in tertiary;
     - a headway leg gets "every 4" (`type.caption`, secondary) under its chip.

     More than 5 chips: inner walks collapse into the separators.
   - **`JourneyBar.tsx`**: a row 4pt high and 2pt in radius, each segment `flex: seconds` with a 6pt minimum.
     - bus: `color.ink`;
     - rail: the line colour;
     - wait: a 1pt `color.hairline` line centred vertically;
     - walk: a row of 3pt ink dots every 7pt, counted from `onLayout`. Don't use `borderStyle: 'dotted'`, which iOS draws only when all four borders match.
   - **`RouteLoader.tsx`**: three 6pt ink beads travelling a 64pt hairline in a 900 ms Reanimated loop, 150 ms apart. Under `useReducedMotion()` they are static. `accessibilityLabel="Finding routes"`.

8. **Results state in `plan.tsx`**:
   1. **Header:** the destination name (`type.title`, weight 500) and address (secondary). Then `<PlaceBanner>`.
   2. One `NoteRow` (`components/trip/Rows.tsx:122`, `exclamationmark.triangle`) per `feedNotes(run.excludedFeeds)` entry. These render **even when there are no itineraries**, above the empty state.
      - When `run.liveSkipped`, add one quiet note: "Live times are paused to stay within data.gov.my's limits. Showing scheduled times."
      - The rows themselves already say "Scheduled".
   3. The loader, shown only while `showLoader`.
   4. Rows separated by `Hairline`.
      - Each is wrapped in `Animated.View`. When `animateIn` (generation changed since the last render), use `entering={FadeInDown.duration(220).delay(index * 40).easing(EASE_OUT).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })}`.
      - Under Reduce Motion, use `FadeIn.duration(motion.crossfade)`.
   5. **Footer**, once: "Routes use data.gov.my timetables. Rail times are every-few-minutes estimates." (`type.footnote`, secondary).
   6. **Empty and error states** use `ContentUnavailableView`:
      - zero results: "No routes found" / "Nothing runs within a 1 km walk of both ends at this time. Try a later time or a nearby station.";
      - `no-network`: "Routes need today's timetable" / "Connect once to download it.";
      - `no-location`: "Where are you starting?" with a "Choose a starting point" button that sets `editing = 'from'`.

9. **`components/plan/PlaceBanner.tsx`** (`{ lat, lng }`): the same chain as 13/03's `StationPhoto` after 01 step 10, 16:9 at `borderRadius: radius.group` (the spec's `radius.lg` doesn't exist in `theme/design.ts:93-96`):
   1. `lookAroundUri` from `services/stationImage.ts`;
   2. `<StopPhoto aspectRatio={16 / 9} onUnavailable={…}>`;
   3. `snapshotUri`.

   A `color.fill` block holds the space and the image fades in over 180 ms (`FadeIn.duration(motion.state).easing(EASE_OUT)`). Collapse the block if all three fail. If the two components end up identical, have `StationPhoto` render `PlaceBanner` rather than keep two copies.

10. **Open a result.** `onPress` calls `planner.setOpenId(it.id)`, then `router.replace({ pathname: '/itinerary', params: { id: it.id } })`. 05 owns the back path.

## Verification
- `pnpm --filter mobile test`: the `model.test.ts`, `runPlan.test.ts` and `realtimePlan.test.ts` additions pass.
- `pnpm type-check`.
- Release build on iPhone 13 (`npx expo run:ios --configuration Release --device`):
  - From a cold launch with the network built, tap Where to?, type "KLCC" and pick it. The first rows appear in < 1.5 s (log `firstResultMs`; criterion 1).
  - The loader is invisible on fast runs.
- Rows show chips, a bar whose widths look proportional, Live/Scheduled, changes and walk distance, and the tags where they differ (criterion 2).
- With a live T816 approaching Hotel Lisa De Inn, that row flips to Live and its leave time rolls. No row re-staggers (criterion 4). The network log shows at most 4 realtime requests per minute.
- Force a broken transfer (dev clock or fixture snapshot). The status reads "Updated · was HH:MM" for 4 s, then settles. "Connection missed. Times updated" shows under the row.
- Follow two routes in different categories (feeder and Rapid KL), then plan a trip whose first bus is in a third category. No extra feed is polled, the row stays "Scheduled", and the paused-live note shows.
- Set the device date past 2026-12-31: the rail note shows and only bus/KTM options remain (criterion 8). Past 2026-11-05, the KTM note shows. If a query then has no results, the notes still show above "No routes found".
- VoiceOver reads a row exactly as criterion 7.
- Reduce Motion: rows fade in without moving, and the loader is static.

## Handoff to next step ([05-itinerary-detail.md](./05-itinerary-detail.md))
- `usePlanner().run.itineraries` and `planner.openId` identify the chosen itinerary. `ResultRow` is reused as the itinerary peek.
- `realtimeStore.setPlannerRoutes` exists. 06 keeps the chosen itinerary's bus routes subscribed during Go.
- No walk-speed setting exists. Every query uses 80 m/min (`WALKING_METERS_PER_MINUTE`).
- `RealtimeSnapshot.plannerSkipped` tells any screen when live re-timing isn't possible.
