# 11-Multi-Bus-Search / 11 — Settings: Favorites Management

## Context
- Today's Settings screen at `apps/mobile/app/settings.tsx` has a "Preferred stops" Section that maps over `AVAILABLE_ROUTE_CODES` and renders one `Picker` per route. With dynamic favorites, that section needs to: (a) iterate `settings.favoritedRoutes`, (b) support swipe-to-delete, (c) support reorder, and (d) keep the per-route boarding-stop selection.

## Goal
Replace the static "Preferred stops" Section with a "Favorite buses" Section that supports swipe-delete, drag-to-reorder, and per-route stop editing, all sourced from the favorites store.

## Prerequisites
- Tasks 04 + 05 + 10 complete.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — query docs for:
  - `@expo/ui/swift-ui`: `List`, `Section`, `EditMode` / `editButton`, swipe-action and `onMove`/`onDelete` modifiers (SwiftUI `.swipeActions` and `.onMove` are the canonical iOS list editing patterns — verify exposure in the pinned `@expo/ui` version before falling back to RN gesture-handler).
  - `react-native-gesture-handler`: `Swipeable` and `RectButton` API (fallback only).
  - `expo-router`: a "stop picker" sub-route inside Settings might be cleaner than `ActionSheetIOS` — query for `Stack.Screen` in the Settings tab.
- **`frontend-design:frontend-design`** — invoke to settle: edit-mode affordance (Edit button vs. always-visible drag handles), the visual treatment when the active route is removed (subtle banner vs. no chrome), and the empty-state copy.

If `@expo/ui`'s `List` exposes `.onMove` and `.onDelete`, **prefer that** over the RN `Swipeable` + chevron-buttons approach — it's the native pattern users already know from the iOS Settings app, and Edit mode handles reorder/delete chrome automatically.

## Steps

1. **Decide on reorder mechanism** (in priority order):
   - **First choice** (verify via context7): @expo/ui `<List>` with `.onMove(perform:)` and `.onDelete(perform:)` modifiers, plus an Edit button in the navigation header. This is the native iOS Settings.app pattern — drag-to-reorder appears in Edit mode automatically.
   - **Second choice**: RN `Swipeable` (from `react-native-gesture-handler`, already in repo) for delete + up/down chevron buttons per row for reorder. No new deps.
   - **Last resort**: pull in `react-native-draggable-flatlist`. Avoid unless the first two don't work.

2. **Replace the existing Section** in `apps/mobile/app/settings.tsx`:
   - Remove the `AVAILABLE_ROUTE_CODES.map((code) => …Picker…)` block.
   - The `<Form>` now contains a single Section "Favorite buses" rendered via a child component `FavoritesSection` (RN, not @expo/ui — see step 3).
   - Render `FavoritesSection` **outside** the `<Host><Form>` structure (at the bottom of the screen, before the About section), since RN gesture-handler `Swipeable` doesn't compose with @expo/ui's SwiftUI Form.

3. **Create `FavoritesSection`** at `apps/mobile/components/settings/FavoritesSection.tsx`:
   - Renders a styled list using the same `surfaceColor.grouped` + hairline divider recipe from `CurrentBusCard`.
   - Header: "Favorite buses" eyebrow text.
   - Empty state: "No favorite buses yet — tap the bus dropdown on Tracker to add one."
   - Each row:
     - Route code (mono, 17 pt) + long name (secondary, 13 pt) on the left.
     - Boarding stop name on the right (tappable → opens an iOS native `ActionSheetIOS` of all stops for that route, or pushes a sub-screen — pick whichever is simpler).
     - Reorder chevrons stacked on the far right.
   - Wrap each row in `<Swipeable renderRightActions={...}>` from `react-native-gesture-handler`. Right action: "Remove" (red) → calls `settings.removeFavorite(code)`.

4. **Stop picker for each row**: tap the stop name → `ActionSheetIOS.showActionSheetWithOptions({ options: [...stopNames, 'Cancel'], cancelButtonIndex: stopNames.length, title: routeCode })`. On selection, call `settings.setPreferredStopForRoute(code, stopId)`.

5. **Reorder handlers**: define `moveUp(code)` and `moveDown(code)` that compute the new array and call `settings.reorderFavorites(next)`.

6. **Removed-active fallback**: when `removeFavorite` removes the active route, the favorites store auto-promotes the next favorite (per task 04). Trigger a Tracker re-render via the existing `preferredRouteCode` state flow — no extra wiring needed here.

## Verification
- Settings → Favorite buses lists every favorite in the user-defined order.
- Swipe a row left → Remove action appears → tap → row disappears, dropdown updates, SQLite rows for that route are pruned.
- Tap up/down chevrons → row moves; dropdown order updates.
- Tap a row's stop name → action sheet of stops appears → pick a different stop → Tracker ETA pipeline switches to the new boarding stop.
- Empty list (after removing all) → empty-state copy appears in the Section.
- Force-quit + relaunch → reordered list and per-route stops persist.

## Handoff to next step ([12-empty-state-and-polish.md](./12-empty-state-and-polish.md))
- Settings provides full CRUD over the favorites list. Task 12 polishes the Tracker empty state and edge cases that arise when favorites are zero or just-added.
