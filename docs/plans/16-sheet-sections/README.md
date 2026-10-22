# Phase 16 — Sheet Sections (Plan · Nearby · Saved)

The persistent trip sheet gets a segmented control under "Where to?": **Plan**, **Nearby** and **Saved**. A glass profile button replaces the Home/Work circles and the map's "…" menu, and opens Settings. There is still one map and one sheet, and no tab bar.

Design: canvas "BusBuddy Rail + Planner" → page "Navigation options" → artboard **A · Tabs inside the sheet** (https://claude.ai/artifact/44D6Ds5naNcJd48n4ZqZdA). Options B (floating tab bar), C (tab bar + live accessory) and D (no tabs) were considered and set aside. A native tab bar costs 96–150 pt of map, and the trip formSheet would cover it.

## Why this shape

- **Discoverability.** Planning, your saved places and your live bus each get a labelled home. Today Saved lives in Settings, and Settings is behind "…".
- **Space.** The peek grows by one 32 pt segmented row plus 8 pt (+40 pt). Glance and large are fractions, so they don't change. A bottom tab bar would cost about 96 pt (B) to 150 pt (C) at every detent.
- **No navigation rework.** `trip` stays a formSheet. `plan`, `itinerary`, `station`, `line` and `network` keep stacking on it exactly as they do now.

## Dependencies

- Phase 15 is built (`WhereToRow`, `PlannerContext`, `services/places/*`, `PlaceThumb`, `PlacesSection`, `useHomeWidgetLine`).
- Everything this phase uses ships in `@expo/ui` 58: `Picker` + `pickerStyle('segmented')`, `Button`, `Image`, `glassEffect`, `GlassEffectContainer`.
- **Build impact: JS-only for every task** (a Metro reload). Each task file confirms this. Nothing touches `app.json`, `modules/` or `patches/`.

## Scope decisions (locked unless the README's open questions change them)

- **Data shape.** The sheet has two layers.
  - `SheetMode` is computed and never stored: `go | ride | detail | sections`. Modes win, and Go, an active ride and a stop or bus detail hide the segmented control, as they do today.
  - `SheetSection = 'plan' | 'nearby' | 'saved'` is stored in `useSettings` as `bt.sheetSection`.
  - One writer: `setSheetSection`. It is called by the picker, by the "Where to?" quick action (→ `plan`) and by the bus Live Activity deep link (→ `nearby`).
- **Default section.** `nearby` when a route is tracked, else `plan`. After that it is the last section you used, persisted.
- **Nearby** is today's trip sheet, unchanged in content. It adds "Share arrival" (moved from the "…" menu) to its option rows. The empty state ("Track your bus") lives here.
- **Plan** shows Home and Work rows (with the last-planned "leave HH:MM" when `useHomeWidgetLine` has one), then up to 5 recents from `recentsStore`. Tapping a row plans to it, as the circles do today.
- **Saved** shows a places strip (Home, Work, pins and "Add" with `PlaceThumb`), then "Your routes" (`favoritedRoutes`; tap one to track it and switch to Nearby). An "Edit" link opens Settings.
- **Profile button.** A 44 pt glass circle (`person.crop.circle`) at the end of the "Where to?" row opens `/settings`. The Home/Work circles go; Home/Work live in Plan and Saved and stay in quick actions.
- **Map toolbar.** The right side keeps Layers and Recenter, and "…" is removed. The left-side route switcher stays as it is (see open question 3).
- **Motion.** Switching sections crossfades the body (`motion.crossfade`, `EASE_OUT`) with no travel. Reduce Motion uses an instant swap. The detent never changes on a switch.

## Success criteria

1. At peek, the segmented control is visible and switching sections never moves the sheet. Every section's peek content fits the new peek height on an iPhone 17 Pro Max and an iPhone SE (2nd gen) simulator at default text size.
2. Nearby at peek is pixel-identical to today's peek, apart from the added picker row.
3. Go, ride and stop/bus detail hide the picker. Leaving them returns to the section you were on.
4. Cold launch from the "Where to?" quick action lands on Plan with `plan` open. The bus Live Activity link lands on Nearby.
5. Your section survives a relaunch.
6. VoiceOver reads the control as a segmented picker ("Plan, selected, 1 of 3"). The profile button reads "Settings". No section relies on colour alone.
7. The map's "…" menu is gone. Share Arrival is reachable from Nearby, and Settings from the profile button.
8. `npx tsc --noEmit` and `pnpm test` pass in `apps/mobile`.

## Skills to invoke

- `expo:expo-ui` (02, 03, 04, 05), `animate-expo` (06), `apple-design`, `emil-design-eng` (05, 06), `break-ui` (06).

## Task order

1. [01-extract-nearby-section.md](./01-extract-nearby-section.md) — behaviour-preserving refactor: today's trip body moves out of `app/trip.tsx` into `NearbySection`.
2. [02-section-state-and-picker.md](./02-section-state-and-picker.md) — `SheetSection`/`SheetMode`, persistence, the segmented `SectionPicker`, peek +40 pt, stub Plan/Saved bodies.
3. [03-plan-section.md](./03-plan-section.md) — Home/Work rows with leave time, recents. **Can run in parallel with 04 and 05.**
4. [04-saved-section.md](./04-saved-section.md) — places strip, your routes, Edit → Settings. **Parallel with 03 and 05.**
5. [05-profile-button-and-toolbar.md](./05-profile-button-and-toolbar.md) — profile circle, "…" removed, Share Arrival moved, quick action/deep link → section, design doc IA. **Parallel with 03 and 04.**
6. [06-motion-a11y-qa.md](./06-motion-a11y-qa.md) — crossfade, Reduce Motion, VoiceOver, Dynamic Type, break-ui, simulator run.

The files written by 03, 04 and 05 are disjoint (one writer each). 02 creates every file they touch, so none of them needs to edit `app/trip.tsx`.

## Open questions (defaults chosen; change before 02 if you disagree)

1. **Peek +40 pt.** The default puts the picker in the peek. The alternative shows it only at glance and large, with peek showing the current section's summary. That needs no extra height, but you can't switch at peek.
2. **Default section.** The default is last used, with Nearby on a first run when a route is tracked. The alternative always opens on Nearby.
3. **Route switcher.** The default keeps it top-left on the map. The alternative moves it into Saved → Your routes only, which leaves the top-left of the map empty.

## Hand-off (post phase)

- `docs/design/README.md` §2 describes: one map, one sheet with Plan · Nearby · Saved, a profile button to Settings, and no tab bar.
- Memory: the project note says "sheet sections, no tab bar".
- Follow-ups to record: live "leave in" for Home/Work in Plan (needs a background `plan()`; see 15/07 feasibility), nearby stops beyond your route ("Buses nearby" layer, still "Soon"), and pinned stations in Saved.
