# 17-Nearby-Around-You / 02 — Nearby List and State

**Build impact:** JS-only (Metro reload). Location permission is already declared, so nothing native changes.

## Context
- **From 01:** `components/sheet/nearby/model.ts`: `aroundYou`, `stopRoutes`, `routePreview`, `gtfsStopId`, `placeKey`.
- **From phase 16:**
  - `app/trip.tsx` routes on `sheetMode({ go, riding, detail })` (`components/sheet/mode.ts`).
  - Sections mode renders `whereTo`, `SectionPicker` and `SectionBody` inside `SheetScroll resetKey={section}`.
  - `NearbySection` is today's trip body: hero, Today grid, options, Share arrival and the empty state.
  - The peek holds 252 pt of content (`PEEK_CONTENT_HEIGHT`), of which 160 pt is below the picker.
- **Deep links:** `hooks/useSectionLinks.ts` turns the sheet to Nearby on a bare `t816://`; `hooks/useQuickActions.ts` sets the `nearby` section for Track.
- **Location:** `components/plan/useNear(granted)` gives one fix. The planner reads permission in `services/planner/quickFix.ts`.

## Goal
Nearby shows your bus as one row and the places around you below it. The navigation state for the stop, route and trip views exists, and stub views stand in for 03 and 04, so 03, 04 and 05 can run in parallel without touching `app/trip.tsx`.

## Prerequisites
- 01 merged.
- Invoke `expo:expo-ui`, `apple-design` and `emil-design-eng`.

## Data shape
```ts
// state/NearbyContext.tsx — one writer per field
export type NearbyView =
  | { kind: 'list' }
  | { kind: 'trip' }
  | { kind: 'stop'; key: string }
  | { kind: 'route'; route: number; pattern: number; fromStopIndex: number };
interface NearbyState {
  stack: NearbyView[];          // never empty; [ { kind: 'list' } ] at rest
  top: NearbyView;
  push(v: NearbyView): void;
  pop(): void;
  reset(): void;
  places: NearbyPlace[] | null; // last aroundYou result (02 computes it; 03 looks places up by key)
  here: LatLng | null;
  locationState: 'unknown' | 'granted' | 'denied';
  previewPositions: VehiclePosition[];                       // [] until 05; 05's preview hook is its only writer
  setPreviewPositions(p: VehiclePosition[]): void;
}
// components/sheet/mode.ts
export type SheetMode = 'go' | 'ride' | 'detail' | 'trip' | 'place' | 'preview' | 'sections';
export function sheetMode(s: { go: boolean; riding: boolean; detail: boolean; nearby: NearbyView['kind'] }): SheetMode;
```

## Steps
1. **`NearbyContext`.**
   - Mount it inside `TripProvider` in `_layout.tsx`.
   - `reset()` runs when the section changes away from Nearby, and when Go or a ride starts.
   - Test the stack rules with a pure reducer in `state/nearbyStack.ts`: push, pop at the root is a no-op, reset, and pushing the current top twice is a no-op.
2. **`sheetMode`.**
   - Extend it with the `nearby` input. `trip` maps to `trip`, `stop` to `place` and `route` to `preview`; `list` falls through to `sections`.
   - Detail still wins over the Nearby views.
   - Update `mode.test.ts`.
3. **The trip view.**
   - Move the body `NearbySection` renders today into `components/sheet/nearby/TripView.tsx`, unchanged, so a pure move.
   - In `app/trip.tsx`, the `trip` mode renders `whereTo`, a back header ("Your bus", or the route badge and stop) and `TripView`. The picker is hidden.
   - `useSectionLinks` and the Track quick action now also `reset()` then `push({ kind: 'trip' })`.
4. **The list** (`NearbySection` becomes it):
   - **Your bus row** (`components/sheet/nearby/YourBusRow.tsx`):
     - 60 pt on `color.fill`: `RouteBadge`, the stop name, "Your bus · 80 m" (the distance from `here`, else omitted) and the countdown from `trip.model.compact`, with the live dot when live.
     - Tapping it pushes `trip`.
     - With no route tracked, it reads "Track a bus" → `/add-route`.
   - **"Around you" label** with "Nearest first" on the right, styled as `SectionLabel`.
   - **Place rows** (`components/sheet/nearby/PlaceRow.tsx`):
     - Stop: a 34 pt circle with `bus`, the name, and "240 m · PJ02 · 780" with "Your stop ·" in front when it applies.
     - Station: `LineBadge` chips in place of the circle, the name, "650 m · 8 min walk", and "every 4 min" on the right.
     - Each row is one accessible element using `spoken`.
   - Tapping a stop pushes `{ kind: 'stop', key }`. Tapping a station calls `router.push('/station?station=<id>')`.
   - **At peek:** the your-bus row, the label and the first place (60 + 24 + 60 + gaps ≤ 160). The rest sits in `SheetBody peek` as today.
5. **Location.**
   - `hooks/useNearbyPosition.ts` reads permission without prompting.
   - When granted: `useNear` for the first fix, then `watchPositionAsync({ distanceInterval: 75 })` while Nearby's list is on screen and `AppState` is `active`. Stop watching otherwise.
   - Recompute `aroundYou` when `here` moves, when the network changes, and on a 60 s clock so "next" times stay fresh.
   - **Denied:** one row, "Turn on location to see stops around you", which asks or opens Settings.
   - **Network loading:** "Loading the network…".
6. **Stubs** (filled by 03 and 04):
   - `components/sheet/nearby/StopView.tsx` and `RouteView.tsx`, each `({ view, scheme })` and rendering a back header and the place or route name.
   - Wire them in `app/trip.tsx` for `place` and `preview` modes, inside `SheetScroll resetKey={viewKey}` and `SectionBody key={viewKey}` so a push or pop crossfades and scrolls to the top.
   - Back calls `pop()`.
   - Also create the empty `components/map/PreviewLayer.tsx` and `PlacePins.tsx` (returning null), so 05 owns them.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator,** with location set to the tracked stop (Features → Location → Custom Location, using the stop's coordinates):
  - The list shows the places around you, nearest first, with your stop captioned.
  - At peek, your bus row and the first place show without clipping.
  - Your bus row → trip view (today's body) → back → list.
  - A bare `t816://` while on Plan → Nearby trip view.
  - Change the location 1 km away: within about 5 s the list reflects it.
  - Location set to None, or permission denied: the explanatory row, and no stale places.
- Record the peek fit and anything that clipped in this file.

## Handoff to next step
- `NearbyContext` with `push`, `pop` and `reset` is the only writer of the Nearby view stack.
- `sheetMode` covers `trip | place | preview`.
- `TripView` is today's body, moved.
- Stub `StopView` and `RouteView` exist (03 and 04), and so do the empty `PreviewLayer` and `PlacePins` (05).
- `places` and `here` are on the context for 03 and 05.

## Implementation notes (2026-10-23)

Run on the iPhone 17 Pro Max Simulator, Debug build with Metro, location at Hotel Lisa De Inn. JS-only: no prebuild.

- **Peek is 24 pt taller** (`PEEK_CONTENT_HEIGHT` 160 → 184 below the picker). The "≤ 160" budget above counted the top padding and the home-indicator band as room for rows; only about 126 pt sits under the picker. The your-bus row, "Around you" and the nearest place need about 145. The itinerary peek keeps its old height (it now names its own 220). Verified at peek: your bus row and the first place, name and caption, both show. The trip view's peek card also fits under its back header. On an iPhone SE the 0.4 cap still applies, so the nearest place sits partly under the edge there.
- **`EmptyState`** moved to `components/sheet/EmptyState.tsx`, since Plan and Saved use it too. `TripView` is otherwise `NearbySection`'s old body, moved.
- **One scroll view for sections and Nearby views.** `trip`, `place` and `preview` render inside the sections' `SheetScroll` (`resetKey` = section or `nearby:<viewKey>`), so a push or pop crossfades with no travel and scrolls to the top. The picker hides on any non-list view.
- **Places update only while the list shows.** The 75 m watch and the 60 s refresh run only on the list, so a stop's place doesn't move under you while you're in it. `places` is computed only while Nearby is the section.
- **Merging** also compares names with case, spaces and punctuation dropped (`mergeName`). "Menara Am First" and "Menara Amfirst", across the road at Hotel Lisa, now merge into one place.
- **Verified on the Simulator:**
  - The list at Hotel Lisa shows your stop captioned, then Sin Chew Daily (50 m), Menara Am First (130 m) and so on.
  - Your bus row → trip view → back → list.
  - From Plan, `xcrun simctl openurl … t816://` lands on the trip view.
  - Moving the location 1.7 km to Asia Jaya: within 6 s the list leads with Asia Jaya (KJ, 60 m), and your bus row reads 1.7 km.
  - A stop row opens the stop view stub; back returns to the list.
- **Not verified here:** permission denied. Permission prompts are the user's to answer. The status rows are checked by reading the code; 06 covers them.
