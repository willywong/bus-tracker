# 15-Journey-Planner-UI / 07 — Saved Places and Shortcuts

**Build impact:** JS-only (Metro reload).
- **Widget layout:** expo-widgets stores the layout at runtime. `WidgetObject` writes it to the App Group when the app calls `createWidget` (`node_modules/expo-widgets/ios/WidgetObject.swift:6-8`, `widgets/NextBusWidget.tsx:358`), and the extension renders the stored one (`ios/Widgets/EntryView.swift:28-34`). Kill and relaunch the app once after the change, then reload the widget.
- **Initial layout:** `app.json`'s `ios.initialLayout` only covers the time before the first launch, so it can lag until the next prebuild. That is harmless.
- **A new widget kind would be native** (a new entry in `app.json` → `expo-widgets.widgets`). This task deliberately doesn't add one.

## Context
- **Saved places shape.** 02 added `settings.savedPlaces: SavedPlace[]` (`bt.savedPlaces`) with `id`, `kind` (`home | work | pin`), `name`, `address`, `lat`, `lng`, `ref` and `createdAt`, plus `setSavedPlaces`.
  - The peek shows Home and Work circles when set.
  - 03's Saved section lists them without images.
  - There is no walk-speed setting (spec §4.4). Queries use 80 m/min, and `Settings.walkMinutes` stays the walk to your favourite stop.
- **Settings screen.** `app/settings.tsx` is a SwiftUI `Form`:
  - `FavoritesSection` at :85-95 (swipe delete via `onDelete`, `components/settings/FavoritesSection.tsx:152`);
  - the "Walking" `Section` with a `Slider` at :97-122.
- **Images.** 01's `snapshot()` and `services/stationImage.ts#snapshotUri` give map tiles. `@expo/ui` `Image uiImage` loads a local file URI, but synchronously on the main thread (`node_modules/@expo/ui/build/swift-ui/Image/index.d.ts:15-19`), so thumbnails stay small (≤ 88 × 88 px).
- **Quick actions.** `services/quickActions.ts` (02) builds ≤ 4 items: "Where to?" plus 3 favourites. Phase 13/05 also adds rail entry points, so its quick action, if any, competes for the same 4 slots.
- **Widget.**
  - `widgets/nextBusTimeline.ts` is the pure timeline builder. The app writes every entry ahead, because the widget can't fetch or compute (:4-8).
  - Props must be plist-safe, with no `null` (:33-37). `NextBusWidgetProps` is at :38-55.
  - The layout function is serialised (`NextBusWidget.tsx:52-63`), so everything stays inline.
  - The sync call site is `hooks/useTripSideEffects.ts:65-85`. Dedupe happens via `nextBusTimelineKey` (:174-186).
- **Feasibility, stated plainly.** A widget can't run `plan()`. That needs the ~3 MB network blob and the RAPTOR engine (spec §3.3, §4.4), and the extension only evaluates layout. So "Home in 32 min" can only be **a plan the app made earlier**, written as timeline entries.
  - It is valid for one departure and goes stale.
  - It is never live: bus re-timing needs the app polling.
  - Running `plan()` in `services/reminders/backgroundRefresh.ts` is out of scope for v1. It means a BG-task time budget plus a 3 MB decode; record it as a follow-up.

## Goal
- Save a destination as Home, Work or one of up to 6 pins, and edit them in Settings.
- Saved rows show small map snapshots.
- Home and Work become quick actions.
- The medium "Next bus" widget shows a last-planned "Home by 18:14 · leave in 6:00" line that disappears once its leave time passes.

## Prerequisites
- 06 merged (the re-plan path through `planner.setFrom/setTo` + `/plan`).
- Invoke `expo:expo-ui`, `apple-design`.

## Steps

1. **Saved-place rules (pure).** In `services/places/saved.ts`:
   - `setHome(list, place, now)` and `setWork(...)` replace any existing one;
   - `addPin(list, place, now): { ok: true; list } | { ok: false; reason: 'pins-full' | 'duplicate' }` allows at most 6 pins, and a duplicate means a matching `ref` or coordinates within 30 m;
   - `removePlace(list, id)`;
   - `placeToPlannerPlace(p): Place` (spec §4.4 `Place`, `kind` from `ref` or `'place'`).

   Tests in `services/places/__tests__/saved.test.ts`:
   - `home replaces home`
   - `seventh pin is refused`
   - `duplicate pin is refused`
   - `remove keeps order`
   - `stop ref becomes a stop place`

2. **Save from results.** In 04's results header, beside the destination name, add a glass `Menu` using the memory pattern: a ReactNode `HStack` label with `glassEffect` on the `HStack`, not on the `Menu`.
   - The label is `bookmark` + "Save" + `chevron.down`. Items:
     - `Button` "Set as Home" (`house`);
     - `Button` "Set as Work" (`briefcase`);
     - `Button` "Pin this place" (`mappin`), carrying `disabled()` plus the label "Pin this place · 6 max" when pins are full.
   - On save: `haptics.success()` (README §4: "favourite added"), and the label crossfades to "Saved · Home" (`contentTransition('opacity')`, as `PrimaryAction.tsx:160-165`).

3. **Thumbnails.** `components/plan/PlaceThumb.tsx` (`{ lat, lng, size = 44 }`) is an RN `Image` of `snapshotUri(lat, lng, 88, 88, dark)`.
   - The region is a 400 m box, `radius.row` (12).
   - It shows a `color.fill` square while loading and a `mappin` glyph if the snapshot fails.
   - Use it in 03's Saved section rows.
   - Re-render on scheme change; the cache key includes `dark`.

4. **Settings → Places.** Add `components/settings/PlacesSection.tsx` to `app/settings.tsx` after `FavoritesSection` (:85-95).
   - `Section title="Places"` lists Home, Work, then pins.
   - Each row is an `HStack` holding:
     - `Image uiImage={thumbUri}`, 44pt, `clipShape('roundedRectangle', 8)`;
     - a `VStack`: name (17) and address (13, secondary, `lineLimit(1)`).
   - Swipe-to-delete uses `onDelete`, like `FavoritesSection.tsx:152`.
   - Footer: "Home and Work appear next to Where to? and under the app icon."
   - With none saved, one row: "Save a place from its results with Save."

5. **Quick actions.** Extend `buildQuickActionItems({ favorites, stopNames, saved })`:
   - order: Where to?, Home, Work, then favourites, ≤ 4 in total;
   - Home is `{ id: 'plan-home', title: 'Home', subtitle: 'Directions home', icon: 'symbol:house.fill', params: { href: '/plan', to: 'home' } }`, and Work matches it.
   - The handler maps `params.to` to `planner.requestOpen(placeToPlannerPlace(saved))`. 02's pending-open waits for the trip sheet.

   Update `services/__tests__/quickActions.test.ts`:
   - `home and work follow where-to`
   - `favourites fill what is left`
   - `missing home is skipped`

6. **Widget data (pure).** In `widgets/nextBusTimeline.ts`:
   - Add `home?: { label: string; leaveMs: number; arriveMs: number } | null` to `NextBusSnapshot`.
   - Add plist-safe props `homeLabel: string` (`''` = none), `homeLeaveMs: number` (0) and `homeArriveMs: number` (0) to `NextBusWidgetProps`. Update `EMPTY_WIDGET_PROPS` (:75-83).
   - `buildNextBusTimeline` copies `home` into every entry dated before `leaveMs`, and adds one entry at `leaveMs` that clears it. It still respects `MAX_TIMELINE_ENTRIES`; the home entry wins over the furthest departure entry.
   - `nextBusTimelineKey` includes `label|minute(leaveMs)`.

   Tests in `widgets/__tests__/nextBusTimeline.test.ts`:
   - `home line is kept until leave time`
   - `an entry at leave time drops it`
   - `home never exceeds the entry cap`
   - `no home gives empty plist-safe fields`
   - `key changes when the home plan changes`

7. **Widget layout.** Inside the `'widget'` function only (`NextBusWidget.tsx:59` onward), with everything inline:
   - **`systemMedium`:** when `props.homeLabel !== ''` and `props.homeLeaveMs > at`, add a bottom row: `house.fill` 11pt + "Home by 18:14" + " · leave in " + `Text timerInterval={{ lower: now, upper: new Date(props.homeLeaveMs) }}` (counts down), with `foregroundStyle` secondary.
   - **`accessoryRectangular`:** when nothing else fits, it shows "Home by 18:14".
   - The clock uses the inlined UTC+8 arithmetic already in the function. The line has no live glyph ever.

8. **Writing the home plan.** `hooks/useHomeWidgetPlan.ts` is thin. Its rules live in a pure `services/planner/homePlan.ts` (`shouldReplanHome(last, now, here, home)`), tested in `services/planner/__tests__/homePlan.test.ts`.
   - It re-plans when the last plan is > 15 min old, its leave time has passed, or you moved > 500 m.
   - It skips when you are < 500 m from Home.
   - Only while the app is active and the network is ready: it runs `runPlan(plan(net, { from: here, to: home, departAt: now, walkMetersPerMin: 80 }))`, takes `result.itineraries[0]` (no line if there is none; `excludedFeeds` doesn't matter here), and passes `home` into the existing `syncNextBusWidget` call (`useTripSideEffects.ts:77-84`) through a small module-level setter.
   - Without location permission or a Home, `home` is `null`.

## Verification
- `pnpm --filter mobile test`: `saved.test.ts`, `quickActions.test.ts`, `nextBusTimeline.test.ts` and `homePlan.test.ts` pass.
- `pnpm type-check`.
- Device:
  - Set Home from a results header. The peek gains the house circle, Settings → Places shows a snapshot thumbnail, and a seventh pin is refused with the menu item disabled.
  - Tapping the house circle opens `plan` straight to results home.
- Long-press the app icon: Where to?, Home, Work, then one favourite. Home from a killed app opens results above the trip sheet.
- Widget (medium):
  - After a relaunch, it shows "Home by HH:MM · leave in MM:SS" counting down.
  - At the leave time, the line disappears with the app closed (the timeline entry).
  - It never shows a live dot.
- Dark mode: thumbnails switch to the dark snapshot.
- VoiceOver: the circles read "Directions home" / "Directions to work".

## Handoff to next step ([08-motion-polish-and-qa.md](./08-motion-polish-and-qa.md))
- Saved places, the Places settings section, the Home/Work quick actions and the widget home line are done.
- The widget line is a snapshot of an earlier plan and is labelled as such. Background re-planning stays a follow-up.
- The quick-action slot budget (Where to?, Home, Work, favourites) is the place to check if 13/05 adds a rail quick action.

## Implementation notes
- **Files.**
  - Pure: `services/places/saved.ts` (`setHome`, `setWork`, `addPin`, `removePlace`, `placeToPlannerPlace`, plus `samePlace`, `findSaved`, `pinCount`, `draftFromPlannerPlace`, `MAX_PINS`), `services/planner/homePlan.ts` (`shouldReplanHome`, `homeLineOf`). `widgets/nextBusTimeline.ts` gains `NextBusHomePlan`, `snapshot.home` and the three `home*` props.
  - Views and hooks: `components/plan/SaveMenu.tsx`, `components/plan/PlaceThumb.tsx` (`PlaceThumb`, `usePlaceThumbUri`), `components/settings/PlacesSection.tsx`, `hooks/useHomeWidgetPlan.ts` (`useHomeWidgetPlan`, `setHomeWidgetLine`, `useHomeWidgetLine`).
  - Edited: `components/plan/PlanResults.tsx` (header row + Save), `components/plan/SuggestionRow.tsx`, `components/plan/model.ts`, `app/plan.tsx` (hairline inset), `app/settings.tsx`, `app/_layout.tsx` (mounts `useHomeWidgetPlan` beside `useQuickActions`), `services/quickActions.ts`, `hooks/useQuickActions.ts`, `hooks/useTripSideEffects.ts`, `widgets/NextBusWidget.tsx`, `services/stationImage.ts`, `state/PlannerContext.tsx`.
  - Tests: `services/places/__tests__/saved.test.ts` (the 5 named), `services/planner/__tests__/homePlan.test.ts` (5), +3 named in `services/__tests__/quickActions.test.ts`, +5 named in `widgets/__tests__/nextBusTimeline.test.ts`.
- **Saved-place rules.**
  - A duplicate is checked against every saved place, so pinning your Home is refused as `duplicate`. The duplicate check runs before the pin cap.
  - `setHome` / `setWork` also drop a pin of the same place, so the Saved list never shows it twice.
  - `PlannerContext.toPlace` is now `placeToPlannerPlace`. `model.ts`'s `MAX_SAVED_PINS` is `MAX_PINS`.
- **Save menu.**
  - The label comes from settings (`findSaved`): "Save", or "Saved · Home" / "Saved · Work" / "Saved · Pinned". It survives reopening the sheet.
  - "Pin this place" is also disabled when the place is already saved; only a full list adds "· 6 max".
  - Only a `place` saves its subtitle as the address. A stop's or station's subtitle is its lines, so it saves `address: null`.
  - It shows only for a destination with coordinates (never My location).
- **Thumbnails.**
  - `RowModel` gains an optional `thumb` instead of a new `RowLead` kind, so 03's `savedRow` tests stand. A Saved row with a 44pt thumbnail is 60pt tall, and its hairlines start at `THUMB_INSET`.
  - `snapshotUri` gains `boxM` (default 600). Thumbnails ask for 400 m at 88 × 88.
  - URIs are cached per place and scheme for the session. A failed snapshot (offline on first use) stays the map-pin glyph until relaunch.
  - Settings → Places shows the kind's glyph on a fill while the tile is drawn. A stop or station with no address reads "Bus stop" / "Station".
- **Quick actions.**
  - Home and Work also set `from` to My location and `when` to now (06's re-plan path) before `requestOpen`. If the place was removed after the action was set, it opens a plain "Where to?".
  - `trackSlots(saved)` is how many favourites get a slot. The hook looks up only their stops' names.
- **Widget.**
  - The home row also shows under the medium (and large) message states, "ended" and "stale". A trip with no route chosen still writes a `null` snapshot, so the empty widget has no home line.
  - `accessoryRectangular` uses its third line for "Home by 18:14" when nothing else is there. With no departures, the title shrinks to one line.
  - The key includes the arrival minute as well as `label` and the leave minute.
  - The row hides itself once `at` passes `homeLeaveMs`, as well as at the clearing entry.
- **Home plan.**
  - `shouldReplanHome` returns `'plan' | 'keep' | 'clear'`.
  - It also re-plans when Home moved more than 30 m.
  - A plan that found no itinerary (`leaveMs: 0`) waits out its 15 minutes rather than re-planning on every check.
  - The hook checks the rules on foreground and every 60 s while active, using a last-known fix up to 5 min old.
  - It plans only when all of these hold:
    - no planner sheet is presented;
    - `workspaceBusy(network)` is false;
    - the loaded network is today's (`networkFor`).
  - It holds the workspace while it runs and is cancelled when a sheet opens, because `usePlannerEngine` doesn't check `workspaceBusy` before its own plan.
  - Itinerary times are moved off the dev clock offset before they reach the widget.
  - The line reaches `syncNextBusWidget` through `setHomeWidgetLine` / `useHomeWidgetLine` (`useSyncExternalStore`).
- **For 08.**
  - Background re-planning (`backgroundRefresh.ts`) stays a follow-up.
  - On a device, check that the medium widget fits the home row under the hero (40pt) plus status row. Shrink the hero if it clips.
  - The peek's house circle (`trip.tsx`) sets `to` only and keeps any custom From. The quick action resets From to My location. Decide whether the circle should too.
  - `services/__tests__/railShapes.test.ts` "railShapesSteps…" is timing-based ("longest step 38.2 ms") and fails now and then under the full parallel run. It is unrelated to 07 and passes alone.
- **Build impact:** JS-only (Metro reload). Kill and relaunch once so the new widget layout is stored, then reload the widget.

## Root verification (iPhone 17 Pro Max Simulator)

- **Save menu.** The glass Save menu on the itinerary and on results rows shows Set as Home, Set as Work and Pin. Set as Home crossfades to "Saved · Home". The peek's house circle then opens the results.
- **Saved section.** The thumbnail and 60pt row in the planner's Saved section, and the Settings → Places row, thumbnail and footer, are correct.
- **Quick actions.** The order is Home, Work, then the tracked stops. A warm launch from Home opens the results from My location. A cold launch from Home, or from the pre-existing Where to?, opens the app without acting. That is a dev-client artifact (`QuickActions.initial` is dropped), so recheck it in a Release build (08).
- **Widget.**
  - With Home at Pavilion and the fix at FINAS, the medium widget shows "Home by 07:07 · leave in 22:28". It counts down, has no live glyph and fits under the hero. The 40pt clip risk above did not occur on the Pro Max; recheck it on an iPhone 13.
  - A placed widget with a passed `leaveMs` shows no home row. The gallery preview can still show a stale "leave in 0:00", because it renders an old snapshot.
- **Unit tests only.** The six-pin limit and the 30 m duplicate check are not verified on the Simulator. Dark-mode thumbnails are checked in 08's dark-mode pass.
