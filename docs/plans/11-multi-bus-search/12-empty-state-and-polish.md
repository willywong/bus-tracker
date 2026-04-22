# 11-Multi-Bus-Search / 12 — Empty-State Tracker + Polish

## Context
- The Tracker screen at `apps/mobile/app/(tracker)/index.tsx` currently assumes there's always an active route. With the new model, a fresh install starts with `favoritedRoutes === []` and `preferredRouteCode === null`. Mounting `useEta` and `useBusPosition` against `null` would either crash or spam warnings.
- Other rough edges to file off: a brief "Loading…" gap after a new favorite is added (while `bootstrapStaticGtfs` merges the route), persistence regression checks, and a sensible cap on favorites.

## Goal
Render a graceful empty state on Tracker, handle the just-added-but-not-yet-merged transition, cap favorites at a sensible number, and verify persistence across launches.

## Prerequisites
- Tasks 04 + 05 + 07 + 10 complete.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — query docs for:
  - `@expo/ui/swift-ui`: `ContentUnavailableView` (SwiftUI's canonical empty-state primitive — if exposed, use it directly instead of a hand-rolled card; matches Mail/Files/Photos empty states).
  - `expo-symbols`: pick the right SF Symbol for "no buses" (`bus.fill`, `bus`, `tram`, `mappin.slash`).
  - `react-native`: `Alert` API for the favorites-cap warning, including iOS-native button styles.
- **`frontend-design:frontend-design`** — invoke to settle the empty-state hierarchy (icon size, title weight, CTA prominence) and the "couldn't load route" retry treatment. The empty state is the first screen a fresh user sees — visual quality matters disproportionately here.

If `ContentUnavailableView` is available, the entire `EmptyTrackerHero` component collapses to a few lines — prefer that over the hand-rolled card described below.

## Steps

1. **Empty-state hero** — create `apps/mobile/components/tracker/EmptyTrackerHero.tsx`:
   - **Preferred** (verify via context7): `<Host matchContents>` containing `<ContentUnavailableView>` with `systemImage="bus.fill"`, title "No bus tracked yet", description "Add your first bus to start seeing live ETAs.", and a primary action Button "Add bus" → `router.push('/add-bus')`. iOS handles all the layout, weights, and spacing.
   - **Fallback** (if `ContentUnavailableView` is not exposed): Centered card using the same `surfaceColor.grouped` + `borderRadius: 16` recipe as `CurrentBusCard`. Big SF Symbol (`bus.fill` size 48, color = secondaryLabel). Title 20 pt semibold. Subtitle 14 pt secondary. Primary CTA Button "Add bus" → `router.push('/add-bus')` using the same glass capsule style as `RouteSwitcher`.

2. **Branch in `(tracker)/index.tsx`**:
   ```tsx
   if (settings.ready && settings.favoritedRoutes.length === 0) {
     return (
       <TrackerCanvas onRefresh={() => {}} refreshing={false}>
         <EmptyTrackerHero onAdd={() => router.push('/add-bus')} />
       </TrackerCanvas>
     );
   }
   ```
   - Place this branch **before** the `useEta` / `useBusPosition` hook calls — but since hook calls must be top-level, refactor so the hooks receive `null`-safe args and return `null`-safe results, OR extract the populated branch into a `<TrackerActive />` child component that's only rendered when `preferredRouteCode != null`.
   - Recommended: extract `<TrackerActive />` so the hooks only run when there's a route to track.

3. **"Just added" loading gap**:
   - When `favoritedRoutes` has the route but SQLite hasn't been populated yet (the bootstrap merge is in flight), `useStaticGtfs` returns `{ ready: false }` for that route.
   - Show a spinner-only state in `<TrackerActive />` for ≤ 3 s; if `useStaticGtfs.ready` becomes true, fall through to normal rendering. If after 5 s it's still false, show a "Couldn't load route — pull to retry" treatment.

4. **Favorites cap**:
   - Add `MAX_FAVORITES = 10` constant in `useSettings`.
   - In `addFavorite`, if `favoritedRoutes.length >= MAX_FAVORITES`, throw or return a `Result` that the Add Bus modal shows as an alert: "You've reached 10 favorite buses. Remove one in Settings to add a new one."
   - Add a unit test for the cap behavior.

5. **Persistence regression**:
   - Add an integration test (or a manual script) that:
     - Creates fresh state, adds 3 favorites, sets active route, sets per-route stops.
     - Re-instantiates the SettingsProvider (simulating a fresh launch) and asserts everything matches.

6. **Copy + a11y polish**:
   - All new interactive elements: add `accessibilityLabel` (e.g. "Add bus", "Search routes", "Remove T816 from favorites").
   - Empty state text uses `selectable` for users who want to copy.

7. **Documentation**: update `apps/mobile/CLAUDE.md` (if present) or the repo README's mobile section to note that the Tracker depends on a non-empty favorites list and that the dropdown is the canonical way to add buses.

## Verification
- Fresh install (or `xcrun simctl uninstall booted <bundleId>`):
  1. Open app → empty Tracker hero with "Add bus" CTA.
  2. Tap CTA → modal opens.
  3. Search `T816` → tap → tap stop → modal dismisses → Tracker shows brief "Loading T816…" → live ETA card appears within ~3 s.
- Add 10 favorites; try to add an 11th → alert appears, modal stays open.
- Force-quit, relaunch → all favorites + active route + per-route stops preserved.
- Run all phase 11 tests: `pnpm -w test --filter @bus-tracker/shared --filter @bus-tracker/api --filter mobile`.

## Handoff (post-phase)
- The app now supports an arbitrary user-curated list of MRT-feeder bus routes with on-demand fetch and persistence.
- Map screen still renders only the active route's polyline — multi-route map layers are an explicit follow-up.
- The shared package's route-agnostic primitives (`filterToRoutes`, `searchRoutes`) are positioned to support adding `rapid-bus-kl` city buses in a future phase by parameterizing `GtfsBundleService` over feeds.
