# 16-Sheet-Sections / 01 — Extract the Nearby Section

**Build impact:** JS-only (Metro reload). This is a behaviour-preserving refactor, so nothing on screen changes.

## Context
- **`app/trip.tsx` (812 lines)** is the persistent formSheet over the map. `TripSheet` returns one of five bodies, picked in this order:
  1. Go (`ride.itinerary && ride.journey`), with `GoBody`;
  2. `model.state === 'empty'`, with `EmptyState` "Track your bus";
  3. `ride.active`, with `RideBody`;
  4. `trip.selection`, with `StopDetailSheet`/`BusDetailSheet` inside `EdgeSwipeBack`;
  5. the default trip body: `SheetHeader` + `PeekCard` at peek, then `StateBody`, `TripRows`, `PrimaryAction`, "On the way", "Today", "Rail nearby", the option rows and `DataSources`.
- **Every body starts with `{whereTo}`**, which is the `WhereToRow` wrapped in a `View ref={topRow}`. The ref measures where the sheet came to rest after a detent pin.
- **The parts that stay in `TripSheet` itself:**
  - the detent listener (`sheetDetentChange` → `trip.setDetent`);
  - the peek pin while the map drags or `plan`/`itinerary` is up;
  - the `pendingOpen` effect that pushes `/plan` for a cold-launch quick action;
  - `SheetScroll`, the paper top edge and the push-in/out swap.
- Phase 16 puts a segmented control (Plan · Nearby · Saved) under the "Where to?" row. Bodies 2 and 5 become the **Nearby** section. Bodies 1, 3 and 4 stay as modes that hide the control.

## Goal
Move bodies 2 and 5 out of `app/trip.tsx` into `components/sheet/NearbySection.tsx`. `TripSheet` then only routes between modes, and 02 can drop a picker plus other sections in beside Nearby.

## Prerequisites
- Branch from `main` at or after d9d6a2b.
- Read `app/trip.tsx` in full, plus `components/trip/SheetHeader.tsx`, `PeekCard.tsx` and `SheetBody.tsx`.

## Steps

1. **Create `components/sheet/NearbySection.tsx`.** It exports `NearbySection({ peek, scheme }: { peek: boolean; scheme: 'light' | 'dark' })` and returns the fragment of what follows `{whereTo}` in bodies 2 and 5.
   - It reads `useTrip`, `useSettings`, `useRide`, `useRouter` and `useSafeAreaInsets` itself, as `StateBody` already does.
   - It does **not** render `whereTo` or `SheetScroll`. `TripSheet` keeps both.
2. **Move the helpers with the code:** `StateBody`, `EmptyState`, `showsHero`, `openWalkingDirections`, plus the derived values the default body uses (`statusItem`, `peekWarnings`, `stopPoint`, `hasRail`, `arrivingTripId`, `showJourney`, `journeyShown`, `hasLastBus`, `peekHasAction`, `peekTrailing`, `openStop`, `openAllStops`, `openDeparture`, `openStation`).
   - `formatKm` and `nearestDetent` stay in `trip.tsx`, which still uses them.
   - `EmptyState` gets exported, because `components/sheet/` will reuse it in 03 and 04.
3. **Split styles.** Styles move with the code. Keep `scroll`, `fill` and `topEdge` in `trip.tsx`.
4. **Simplify `TripSheet`.** Its last two returns collapse into one:
   ```tsx
   return (
     <SheetScroll key="trip" contentContainerStyle={scrollStyle} scheme={scheme} swap>
       {whereTo}
       <NearbySection peek={peek} scheme={scheme} />
     </SheetScroll>
   );
   ```
   - The empty body used no `key` and no `swap`. It now gets `key="trip"` and `swap`. Check that the empty → first-route transition looks no worse; it gains the push-in.
   - If it does look worse, keep a separate `key="empty"` return.
5. **Name the mode for 02.** Add the pure `sheetMode()` in `components/sheet/mode.ts`:
   ```ts
   export type SheetMode = 'go' | 'ride' | 'detail' | 'sections';
   export function sheetMode(s: { go: boolean; riding: boolean; detail: boolean }): SheetMode;
   ```
   - The order is go > ride > detail > sections, which is the order of today's ifs.
   - `TripSheet` switches on it.
   - Tests in `components/sheet/__tests__/mode.test.ts`:
     - `go wins over ride`
     - `ride wins over detail`
     - `detail wins over sections`
     - `nothing active is sections`

## Verification
- In `apps/mobile`, run `npx tsc --noEmit -p .` and `pnpm test`. Both must be green, including the new `mode.test.ts`.
- **iPhone 17 Pro Max simulator**, Debug, with Metro reloaded:
  - peek, glance and large on a tracked T816 match screenshots taken before the change (same rows, same spacing);
  - tap a stop on the map for its detail, then swipe back;
  - start and end a ride;
  - open Go from an itinerary.
- **Empty state:** remove all routes in Settings. "Track your bus" shows, and "Choose Route" opens `add-route`.
- `git diff --stat` shows only `app/trip.tsx`, `components/sheet/*` and the test.

## Handoff to next step
- `components/sheet/NearbySection.tsx` renders everything the default trip sheet and the empty state showed. `EmptyState` is exported from it.
- `components/sheet/mode.ts` exports `SheetMode` + `sheetMode()` (tested).
- `TripSheet` now holds the modes, `whereTo`, the detent pin and the `pendingOpen` effect, and renders `NearbySection` for the `sections` mode.
