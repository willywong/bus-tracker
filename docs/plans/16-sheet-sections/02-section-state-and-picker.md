# 16-Sheet-Sections / 02 — Section State and the Segmented Picker

**Build impact:** JS-only (Metro reload). `Picker` and `pickerStyle('segmented')` already ship in `@expo/ui` 58 (`node_modules/@expo/ui/build/swift-ui/modifiers/pickerStyle.d.ts`). `@expo/ui` is a native module that is already linked, so no prebuild is needed.

## Context
- **From 01:**
  - `TripSheet` (`app/trip.tsx`) switches on `sheetMode()` (`components/sheet/mode.ts`): `go | ride | detail | sections`;
  - `sections` renders `{whereTo}` + `<NearbySection peek scheme />` inside `SheetScroll key="trip" swap`;
  - `EmptyState` is exported from `components/sheet/NearbySection.tsx`.
- **Peek height.** It is derived in `theme/design.ts`.
  - `PEEK_CONTENT_HEIGHT = 160 + WHERE_TO_ROW_HEIGHT` (52) gives 212 pt.
  - `peekDetent()` caps it at 0.35 of the window below the top safe area. An iPhone SE (2nd gen) gets 647 pt, so the cap is 226 pt.
  - `sheetDetents()` returns `[peek, 0.5, 1]`.
- **Persisted UI preferences** live in `hooks/useSettings.ts`. These are `mapType` and `mapLayers`, under `STORAGE_KEYS` (`bt.*`), using SecureStore, a `parse*` per key and one setter each.
- **Existing `@expo/ui` usage:** `Picker` with `tag(i)` children in `app/settings.tsx` (Clock and Map pickers), and `Host matchContents={{ vertical: true }}` in `components/plan/WhereToRow.tsx`.

## Goal
Show a native segmented control (Plan · Nearby · Saved) under "Where to?" in the `sections` mode. Persist the choice, and swap the section body with a crossfade. Plan and Saved get stub bodies that 03 and 04 fill.

## Prerequisites
- 01 merged.
- Invoke `expo:expo-ui`.

## Data shape
```ts
// components/sheet/sections.ts
export type SheetSection = 'plan' | 'nearby' | 'saved';
export const SHEET_SECTIONS: readonly SheetSection[] = ['plan', 'nearby', 'saved'];
export const SECTION_LABEL: Record<SheetSection, string> = { plan: 'Plan', nearby: 'Nearby', saved: 'Saved' };
/** Stored choice, else Nearby when a route is tracked, else Plan. */
export function currentSection(stored: SheetSection | null, hasRoute: boolean): SheetSection;
export function parseSheetSection(raw: string | null): SheetSection | null;
```
- **Settings.** `useSettings` gains `sheetSection: SheetSection | null`, where `null` means you never picked one. The key is `bt.sheetSection`, with a `setSheetSection(s)` setter.
- **One writer for the section:** `setSheetSection`. In this task only `SectionPicker` calls it; 05 adds the quick-action and deep-link callers.
- **Mode vs section.** The mode is always computed and never stored. Go, ride and detail don't touch the stored section, so leaving them returns to it.

## Steps

1. **Pure model.** Write `components/sheet/sections.ts` as above. Tests in `components/sheet/__tests__/sections.test.ts`:
   - `stored wins`
   - `no stored + route → nearby`
   - `no stored + no route → plan`
   - `garbage parses to null`
2. **Settings.** Add the `sheetSection` key, parser, default (`null`) and setter to `hooks/useSettings.ts`, following `mapType` exactly. The setter must no-op when the value is unchanged, as the others do.
3. **`components/sheet/SectionPicker.tsx`:**
   ```tsx
   <Host matchContents={{ vertical: true }} style={{ marginHorizontal: MARGIN, marginBottom: 8 }}>
     <Picker selection={index} onSelectionChange={(i) => …} modifiers={[pickerStyle('segmented')]}>
       {SHEET_SECTIONS.map((s, i) => <Text key={s} modifiers={[tag(i)]}>{SECTION_LABEL[s]}</Text>)}
     </Picker>
   </Host>
   ```
   - Fire `haptics.selection()` on change.
   - Don't tint the control: the system segmented style already reads as Calm Mono, ink on a grey track.
   - Add `SECTION_PICKER_ROW_HEIGHT = 40` (32 control + 8 below) to `theme/design.ts`. If the Simulator measures differently, update the constant to the real value.
4. **Peek height.** Set `PEEK_CONTENT_HEIGHT = 160 + WHERE_TO_ROW_HEIGHT + SECTION_PICKER_ROW_HEIGHT`, which is 252 pt.
   - On an SE that is above the 0.35 cap (226 pt), and the Nearby peek card would clip. Raise `peekDetent`'s default cap to **0.4** (259 pt on SE). Comment why next to the existing "iPhone SE" note.
   - `ITINERARY_PEEK_HEIGHT` derives from `PEEK_CONTENT_HEIGHT`, so it grows too. That is intended: the itinerary peek must keep covering the trip peek.
5. **Stub sections.** Create `components/sheet/PlanSection.tsx` and `components/sheet/SavedSection.tsx`, each `({ peek, scheme })`, each rendering `EmptyState compact` with a temporary title ("Plan" / "Saved"). 03 and 04 own these files from here on.
6. **Wire `TripSheet`'s `sections` mode:**
   ```tsx
   const section = currentSection(settings.sheetSection, trip.route != null);
   <SheetScroll key="sections" …>
     {whereTo}
     <SectionPicker value={section} onChange={settings.setSheetSection} />
     <Animated.View key={section} entering={reduceMotion ? undefined : FadeIn.duration(motion.crossfade)}>
       {section === 'plan' ? <PlanSection …/> : section === 'saved' ? <SavedSection …/> : <NearbySection …/>}
     </Animated.View>
   </SheetScroll>
   ```
   - The `SheetScroll` key stays `"sections"`, so a section switch never triggers the push swap. The push swap stays for mode changes (detail ↔ sections).
   - Use `trip.route != null` if it means "a route is tracked". If not, check `settings.preferredRouteCode` instead and note which you used.
   - The modes (go, ride, detail) render no picker.
   - Make sure the `topRow` ref still wraps only `whereTo`. The rest-position measurement in the detent pin effect depends on it.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **iPhone 17 Pro Max:**
  - the picker sits under "Where to?" at peek, glance and large;
  - switching sections never moves the detent;
  - Nearby at peek shows the full peek card, with nothing clipped at the bottom;
  - kill and relaunch: the last section is restored.
- **iPhone SE (2nd gen) simulator** (`xcrun simctl create` one if needed): the Nearby peek card isn't clipped, and the map above it still shows your stop.
- **Modes:**
  - tap a stop on the map: detail shows with no picker, and swiping back returns to the same section;
  - start a ride: no picker shows.

## Handoff to next step
- `settings.sheetSection` / `setSheetSection` are persisted as `bt.sheetSection`. `currentSection()` resolves the default.
- `SectionPicker` is rendered by `TripSheet` in `sections` mode. Peek is 252 pt content, and the peek cap is 0.4.
- **File owners from here on, one writer each:**
  - `PlanSection.tsx` → 03
  - `SavedSection.tsx` → 04
  - `NearbySection.tsx`, `WhereToRow.tsx`, `app/index.tsx`, `hooks/useQuickActions.ts` → 05
- `app/trip.tsx` is frozen until 06.
