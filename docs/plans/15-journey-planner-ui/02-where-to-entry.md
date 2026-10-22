# 15-Journey-Planner-UI / 02 — "Where to?" Entry

**Build impact:** JS-only (Metro reload)

## Context
- 01 shipped `modules/transit-maps` (native). Nothing in the UI calls it yet.
- **Peek height.** The peek detent hugs `PEEK_CONTENT_HEIGHT = 160` (`apps/mobile/theme/design.ts:142`). `sheetDetents()` turns it into a fraction capped at `0.3` (`design.ts:151-154`). Spec §6.1 adds a 52pt row above the existing `PeekCard`, and the card itself does not change (`components/trip/PeekCard.tsx:26`, `PEEK_CARD_HEIGHT = 92`).
- **Trip sheet branches.** `app/trip.tsx` renders four branches into `SheetScroll` (:453-500):
  - empty (:183-196);
  - ride (:198-241);
  - selection detail (:243-262);
  - trip (:286-327, `SheetHeader` at :288 with `PeekCard` as `peekContent` at :296).
- **Holding the trip at peek.** While the map is dragged, the sheet is pinned to peek by offering one detent (`trip.tsx:133-164`). A 5 s safety release applies (`HOLD_PEEK_MAX_MS`, :78). The `plan` and `itinerary` sheets need the same pin, without the timeout, so the trip sheet never shows above a shorter sheet.
- **Screen registration.** Sheets are registered in `app/_layout.tsx`: trip at :79-93, add-route at :94-105, stops at :118-128. All use `contentStyle: { backgroundColor: SHEET_BACKGROUND }` (:37, opaque paper per Calm Mono). The providers nest at :43-58.
- **Glass patterns.** The capsule follows the validated pattern in memory: glass on the inner `HStack`, never on the wrapper. The circular glass button pattern is `DetailHeader`'s back button (`components/trip/SheetHeader.tsx:132-144`: `buttonStyle('glass')`, `buttonBorderShape('circle')`, `controlSize('large')`). `glassEffect` is at `node_modules/@expo/ui/build/swift-ui/modifiers/index.d.ts:865-874`, `GlassEffectContainer` at `GlassEffectContainer/index.d.ts`, and `symbolEffect` with a discrete `value` trigger at `modifiers/symbolEffect.d.ts:95-101`.
- **Quick actions.** `hooks/useQuickActions.ts` caps them at `MAX_ACTIONS = 4` (:13) and fills every slot with favourites (:52-61). The handler only knows `params.code` (:28-37).

## Goal
- A glass "Where to?" capsule, plus Home/Work circles once set, at the top of the trip sheet. Tapping it bounces the glyph and opens a `plan` sheet at the large detent.
- `plan` and `itinerary` routes are registered. The trip sheet stays pinned at peek while either is up.
- A "Where to?" quick action works on cold launch.

## Prerequisites
- 01 merged and built.
- Read `docs/design/README.md` v3 (glass is chrome only) and spec §2, §6.1.
- Invoke `expo:expo-ui` and `expo:expo-router`.

## Steps

1. **Tokens.** In `theme/design.ts`:
   - Add `export const WHERE_TO_ROW_HEIGHT = 52;` (a 44pt capsule plus 8pt below).
   - Set `PEEK_CONTENT_HEIGHT = 160 + WHERE_TO_ROW_HEIGHT` (212). Update its doc comment.
   - In `sheetDetents()`, raise the peek cap from `0.3` to `0.35`. On iPhone SE (667 − 20 = 647pt), 212 / 647 = 0.328 would otherwise be clipped to 0.3 (194pt).
   - Add `export function itineraryDetents(windowHeight, topInset): [number, number, number]`, returning `[peek, 0.5, 1]` with the same peek fraction. The itinerary peek must cover the trip peek exactly.

2. **Saved places shape (read only here).** In `hooks/useSettings.ts`:
   - Add `savedPlaces: SavedPlace[]` to `Settings` (:31-48) and `[]` to `DEFAULT_SETTINGS` (:50-60).
   - Add `savedPlaces: 'bt.savedPlaces'` to `STORAGE_KEYS` (:91-101).
   - Parse it in `loadFromStore` (:170-208). Drop malformed entries.
   - Add `setSavedPlaces(next: SavedPlace[])`, which writes JSON.

   The type:
   ```ts
   export type SavedPlace = {
     id: string;                      // 'home' | 'work' | `pin-${createdAt}`
     kind: 'home' | 'work' | 'pin';
     name: string; address: string | null;
     lat: number; lng: number;
     ref: { kind: 'stop' | 'station'; id: string } | null;   // when saved from a local result
     createdAt: number;
   };
   ```
   07 builds the editing UI. Here it only drives the circles.

3. **Planner state.** Create `state/PlannerContext.tsx`:
   ```ts
   export type When = { kind: 'now' } | { kind: 'depart'; at: number };
   export interface PlannerContextValue {
     from: Place;                     // Place from @bus-tracker/shared (spec §4.4); default { kind: 'here', name: 'My location', lat: NaN, lng: NaN }
     to: Place | null;
     when: When;
     setFrom(p: Place): void; setTo(p: Place | null): void; setWhen(w: When): void; swap(): void;
     /** True while `plan` or `itinerary` is on the stack; the trip sheet pins to peek. */
     presented: boolean; setPresented(on: boolean): void;
     /** Opens `plan` once the trip sheet exists (quick actions on cold launch). */
     pendingOpen: { to: Place | null } | null;
     requestOpen(to?: Place | null): void; clearPending(): void;
   }
   ```
   - `swap()` is a no-op while `to` is null.
   - Mount `<PlannerProvider>` in `_layout.tsx` between `TripProvider` (:49) and `RideProvider` (:50). 06 makes the ride read the planner.

4. **Routes.**
   - Create `app/plan.tsx` and `app/itinerary.tsx` as minimal screens: a `Stack.Toolbar placement="right"` xmark that calls `router.back()`, as in `app/ride.tsx:31-33`, plus a title. 03 and 05 fill them.
   - Each calls `planner.setPresented(true)` on mount and `false` on unmount.
   - Register both in `AppStack` after `add-route`:
   ```tsx
   <Stack.Screen name="plan" options={{
     presentation: 'formSheet', sheetAllowedDetents: [1], sheetGrabberVisible: true,
     headerShown: true, headerTransparent: true, title: 'Where to?',
     contentStyle: { backgroundColor: SHEET_BACKGROUND },
   }} />
   <Stack.Screen name="itinerary" options={{
     presentation: 'formSheet', sheetAllowedDetents: itineraryDetents(windowHeight, insets.top),
     sheetInitialDetentIndex: 1, sheetLargestUndimmedDetentIndex: 1, sheetGrabberVisible: true,
     headerShown: false, contentStyle: { backgroundColor: SHEET_BACKGROUND },
   }} />
   ```
   `windowHeight` and `insets` are already in scope at `_layout.tsx:63-64`.

5. **Pin the trip at peek.** In `trip.tsx:133-164`:
   - Compute `const pinned = holdPeek || planner.presented` and key the effect on `pinned`.
   - Arm the `HOLD_PEEK_MAX_MS` safety timer only for `holdPeek`, never for `presented`.
   - Restore all three detents `COLLAPSE_SETTLE_MS` after `pinned` turns false, exactly as today.

6. **`components/plan/WhereToRow.tsx`.** It takes `{ onOpen: () => void; home: SavedPlace | null; work: SavedPlace | null; onPlace: (p: SavedPlace) => void }`. Structure:
   ```tsx
   <Host matchContents={{ vertical: true }} style={styles.host /* height 44, marginHorizontal MARGIN, marginBottom 8 */}>
     <GlassEffectContainer spacing={8}>
       <HStack spacing={8}>
         <Button onPress={tap} modifiers={[buttonStyle('plain'), accessibilityLabel('Where to?'), accessibilityHint('Search for a place and plan a trip')]}>
           <HStack spacing={8} modifiers={[
             padding({ horizontal: 16 }), frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' }),
             glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
           ]}>
             <Image systemName="magnifyingglass" size={17}
               modifiers={[symbolEffect({ effect: 'bounce' }, { value: bounce })]} />
             <Text modifiers={[font({ size: 17 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>Where to?</Text>
           </HStack>
         </Button>
         {home ? <PlaceCircle symbol="house.fill" label="Directions home" … /> : null}
         {work ? <PlaceCircle symbol="briefcase.fill" label="Directions to work" … /> : null}
       </HStack>
     </GlassEffectContainer>
   </Host>
   ```
   - `bounce` is `useNativeState(0)`. `tap` increments it, fires `haptics.selection()` (a decision; README §4 Haptics) and calls `onOpen()` in the same frame.
   - `PlaceCircle` is a 44pt `Button` with `glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive: true } })` on a framed `Image`, tinted `pick(hex.ink, scheme)`.

7. **Mount it.**
   - Render `<WhereToRow>` as the first child of every `SheetScroll` in `trip.tsx`: empty (:185), ride (:201), selection (:248) and trip (:287), above the header.
   - It shows at every detent (search is chrome, as in Apple Maps), so nothing reflows on detent changes.
   - `onOpen = () => router.push('/plan')`.
   - `onPlace = (p) => { planner.setTo(toPlace(p)); router.push('/plan'); }`.

8. **Quick action.** Move item building into a pure `services/quickActions.ts`: `buildQuickActionItems({ favorites, stopNames, saved }): QuickActionItem[]`.
   - "Where to?" (`id: 'where-to'`, `icon: 'symbol:magnifyingglass'`, `params: { href: '/plan' }`) comes first.
   - Favourites fill the remaining 3 slots.
   - If 13/05's optional "Nearest station" item (`params.station === 'nearest'`) shipped, it moves into the builder and takes a slot only when one is left. 13/05 gives "Where to?" priority.
   - 07 adds Home/Work.

   In `useQuickActions.ts`, the handler (:30-33) calls `planner.requestOpen()` when `action.params?.href === '/plan'`, and keeps the `code` (and 13/05 `station`) paths. `useQuickActions` already runs inside `AppStack` (`_layout.tsx:66`), which sits under `PlannerProvider` after step 3.

9. **Cold-launch order.** `usePresentTripSheet` (`app/index.tsx:531-540`) pushes `trip` when it's missing. A `plan` pushed first would end up under the trip sheet. In `trip.tsx`, add an effect: when `planner.pendingOpen` is set, `router.push('/plan')`, then `clearPending()`. `trip` is mounted only once it's on the stack.

10. **Tests.** Add `services/__tests__/quickActions.test.ts`:
    - `where-to is always first`
    - `favourites fill the remaining three slots`
    - `never more than four items`
    - `stop name becomes the subtitle`

## Verification
- `pnpm --filter mobile test` and `pnpm type-check` pass.
- On the iPhone 13 simulator:
  - The peek shows the capsule above the unchanged `PeekCard`, with no clipped number and no paper band below.
  - Tapping it bounces the magnifier and opens `plan` at full height. The trip sheet behind sits at peek.
  - Closing `plan` brings all three trip detents back.
- iPhone SE (3rd gen) simulator: the peek fits the capsule, header and card. Screenshot it for 08.
- Set a `bt.savedPlaces` JSON by hand in a dev build with Home only. One house circle appears, and it says "Directions home" under VoiceOver.
- Device: long-press the app icon. "Where to?" is first. From a killed app, it opens `plan` above the trip sheet, not under it.
- Reduce Motion on: the bounce is skipped by the system, and the sheet still opens.
- Dark mode and Satellite: the capsule reads as glass with a legible secondary placeholder.

## Handoff to next step ([03-plan-search-sheet.md](./03-plan-search-sheet.md))
- `PlannerContext` holds `from`, `to`, `when`, `presented` and `pendingOpen`. `plan` and `itinerary` are registered stubs.
- `settings.savedPlaces` exists (read-only UI). `itineraryDetents()` and `WHERE_TO_ROW_HEIGHT` are in `theme/design.ts`.
- The quick action budget is Where to? plus 3 favourites. 07 reworks the split when Home/Work are set.
