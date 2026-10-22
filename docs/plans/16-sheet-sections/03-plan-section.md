# 16-Sheet-Sections / 03 — Plan Section

**Build impact:** JS-only (Metro reload).

## Context
- **From 02:** `components/sheet/PlanSection.tsx` is a stub `({ peek, scheme })` rendered when `currentSection()` is `plan`.
  - The sheet already shows "Where to?" and the segmented picker above it.
  - The peek has room for **160 pt** of section content.
- **Planning entry points that already exist:**
  - `planner.setTo(toPlace(p)); router.push('/plan')`, as the Home/Work circles do in `app/trip.tsx`'s `whereTo`;
  - `toPlace` lives in `state/PlannerContext`.
- **Saved places:** `settings.savedPlaces` (`SavedPlace`: `home | work | pin`). The rules are in `services/places/saved.ts` (`placeToPlannerPlace`).
- **Recents:**
  - `services/places/recentsStore.ts`: `loadRecents()` / `saveRecents()` (SecureStore `bt.planRecents`, `MAX_RECENTS = 6`);
  - the `RecentPlace` type is in `services/places/recents.ts`;
  - `app/plan.tsx` loads them on mount and writes them on pick, so nothing is shared in memory.
- **Last-planned home line:** `useHomeWidgetLine()` (`hooks/useHomeWidgetPlan.ts`) returns the `NextBusHomePlan | null` the widget shows, a plan the app made earlier for one departure (see 15/07 "Feasibility").
- **Row components:** `components/plan/SuggestionRow.tsx` is the row style the planner already uses for recents and saved places. `PlaceThumb` gives 44 pt map tiles.

## Goal
Plan shows your Home and Work rows (with the last-planned "leave HH:MM" when there is one), then your recent destinations. Tapping any row plans to it.

## Prerequisites
- 02 merged.
- Invoke `expo:expo-ui` and `apple-design`.
- This task writes only `components/sheet/PlanSection.tsx`, `components/sheet/planModel.ts` and their tests.

## Data shape
```ts
// components/sheet/planModel.ts (pure)
export type PlanRow =
  | { kind: 'saved'; id: string; place: SavedPlace; title: string; detail: string | null }
  | { kind: 'recent'; id: string; recent: RecentPlace; title: string; detail: string | null }
  | { kind: 'set'; id: 'set-home' | 'set-work'; title: string };
export function planRows(saved: readonly SavedPlace[], recents: readonly RecentPlace[], home: NextBusHomePlan | null, now: number): PlanRow[];
```
- **Order:** Home, then Work, then recents not already saved (deduped by matching `ref` or within 30 m, reusing `saved.ts`'s duplicate rule), capped at 5.
- **Missing Home or Work** shows a `set` row ("Add Home" / "Add Work") that opens `/plan` to search. The "Save" menu on results then sets it, which is the existing 15/07 flow.
- **`detail` for Home:** "Leave HH:MM · NN min" only while `home` is for Home and its leave time is still ahead of `now`. Otherwise it is the address.

## Steps
1. **`planRows`**, with tests in `components/sheet/__tests__/planModel.test.ts`:
   - `home then work then recents`
   - `missing work shows add row`
   - `recent equal to home is dropped`
   - `stale leave time falls back to address`
   - `caps recents at 5`
2. **Recents in the sheet.**
   - `PlanSection` calls `loadRecents()` on mount.
   - It reloads when the `plan` sheet closes: subscribe to `planner.presented` going from `true` to `false`, so a search you just made appears.
   - It never writes recents.
3. **Render.**
   - Each row is a hairline row: a 34 pt circle with an SF Symbol (`house.fill`, `briefcase.fill`, `clock`), title, and a secondary `detail`.
   - Reuse `components/trip/Rows.tsx` (`LinkRow`, `Hairline`, `ROW_ICON_INSET`) if it fits. Otherwise add a `PlanRowView` in the same file, matching `SuggestionRow`'s metrics.
   - **At `peek`**, render only the first 2 rows. Two 56 pt rows plus gaps fit the 160 pt budget; check this in the Simulator.
4. **Actions.**
   - A saved or recent row calls `planner.setTo(...)` then `router.push('/plan')`, as the old circles did.
   - The `set` rows call `planner.setTo(null)` then `router.push('/plan')`.
   - Fire `haptics.selection()` on press.
5. **Empty.** If there's no Home, no Work and no recents, show `EmptyState compact` with icon `magnifyingglass`, title "Plan a trip" and message "Search a place above. Your trips and saved places show up here."

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator:**
  - **Fresh state** (delete saved places and plan once): Add Home and Add Work rows show, plus 1 recent.
  - **Set Home from results.** Home becomes a row; tapping it opens `plan` straight to results.
  - **Plan to KLCC, close the sheet.** KLCC appears under recents without relaunching.
  - **At peek**, exactly 2 rows show and nothing clips.
- **VoiceOver:** the Home row reads "Home, leave 8:40, 24 minutes, button" (or the address).

## Handoff to next step
- `PlanSection` is complete. The pure `planRows` is tested.
- Recents are read-only in the sheet. `app/plan.tsx` remains the only writer.
