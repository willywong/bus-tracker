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
