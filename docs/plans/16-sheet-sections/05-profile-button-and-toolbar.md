# 16-Sheet-Sections / 05 — Profile Button, Toolbar and Entry Points

**Build impact:** JS-only (Metro reload). The quick actions keep their existing items. Only the JS handler changes, so the `expo-quick-actions` patch is untouched.

## Context
- **`components/plan/WhereToRow.tsx`** renders a glass capsule plus optional Home/Work `PlaceCircle`s, 44 pt each, inside a `GlassEffectContainer`.
  - `app/trip.tsx`'s `whereTo` passes `home`, `work` and `onPlace` into it.
  - Since 03 and 04, Home and Work also live in the Plan and Saved sections.
- **The map toolbar** is `MapToolbar` in `app/index.tsx`:
  - the left side is the route menu (Add Route…, Edit Routes… → `/settings`);
  - the right side is the Layers menu, Recenter, and `Menu icon="ellipsis"`, which holds "Share Arrival" (only when `canShare`) and "Settings".
  - The share handler is `shareRef.current` in `MapScreen` (index.tsx :578-589). It builds `"${routeCode} to ${stopName}: ${compact} (live estimate|scheduled)."` and calls `Share.share`.
- **Entry points:**
  - `hooks/useQuickActions.ts` handles "Where to?", Home and Work (`PLAN_HREF`, via `planner.requestOpen`), and "Track …" (`setPreferredRouteCode`).
  - The Live Activity and widget open bare `t816://`, which `app/+native-intent.tsx` passes through unchanged.
- **From 02:** `settings.setSheetSection` is the only writer of the section. From 01, `NearbySection` holds the trip option rows (`LinkRow`s: All stops, Alert me, Walking directions).

## Goal
- A glass profile circle replaces the Home/Work circles and opens Settings.
- The map's "…" menu goes, and Share Arrival moves into Nearby.
- Quick actions and the Live Activity link open the right section.
- The design doc describes the new IA.

## Prerequisites
- 02 merged.
- Invoke `expo:expo-ui` and `emil-design-eng`.
- **This task writes:**
  - `components/plan/WhereToRow.tsx`, `app/index.tsx`, `components/sheet/NearbySection.tsx`, `hooks/useQuickActions.ts`;
  - a new `services/shareArrival.ts`, plus its test;
  - `docs/design/README.md`.
- **One exception:** a single-line change in `app/trip.tsx`'s `whereTo` props. Coordinate it with whoever holds `trip.tsx`. 02 froze it, so do it here and note it in the handoff.

## Steps
1. **`WhereToRow`.**
   - Replace the `home`/`work`/`onPlace` props with `onProfile: () => void`.
   - Render one `PlaceCircle`-style glass circle with `person.crop.circle` and `accessibilityLabel('Settings')`, with the hint "Saved places, routes and preferences".
   - Keep `GlassEffectContainer spacing={8}`, so the capsule and circle still merge on iOS 26.
   - Update the doc comment, which still says "a glass circle for Home and for Work".
2. **`app/trip.tsx`** (the one-line exception): `whereTo` passes `onProfile={() => router.push('/settings')}` and drops `home`, `work` and `onPlace`. Remove the now-unused `home`/`work` locals.
3. **Share helper.** Move the message builder into `services/shareArrival.ts`:
   ```ts
   export function arrivalShareMessage(routeCode: string, stopName: string | null, compact: string | null, source: 'live' | 'scheduled' | string): string | null;
   ```
   - It is pure, with tests: `null without stop`, `scheduled wording`, `live wording`.
   - Index's `shareRef` and the new Nearby row both call it.
4. **Nearby.** Add a `LinkRow` with icon `square.and.arrow.up`, title "Share arrival", shown when `model.compact != null`. It goes first in the options block, above "Follow on Lock Screen", with a `Hairline` after it.
5. **`app/index.tsx`.**
   - Delete the `Menu icon="ellipsis"` and its children.
   - Drop `canShare`/`onShare` from `MapToolbarProps` and the call site.
   - Delete `shareRef`/`share` if nothing else uses them.
   - The right side is now Layers + Recenter.
6. **Entry points → section.**
   - In `useQuickActions`' `handle`:
     - the `PLAN_HREF` branch calls `settings.setSheetSection('plan')` before `open.current(...)`;
     - the "Track" branch calls `setSheetSection('nearby')` after selecting the route.
   - Hold the setter in a ref, as the other callbacks are.
   - **Bare `t816://`.** In `app/_layout.tsx`'s `AppStack`, add a `Linking.addEventListener('url')` + `Linking.getInitialURL()` pair. When the URL's path is empty, call `setSheetSection('nearby')`. Put it in a tiny `hooks/useSectionLinks.ts`, and note the extra file in the handoff.
     - Rail paths (`station`/`line`) are rewritten by `+native-intent` and don't need this.
     - Ignore failures silently. Never throw on launch.
7. **Design doc.**
   - In `docs/design/README.md`, update the IA lines that say "No tab bar" (around :146 and :164) and §2 "Information architecture": one map, one sheet with Plan · Nearby · Saved, a profile button → Settings, still no tab bar.
   - Link artboard A on the canvas.
   - Update `docs/plans/README.md` to add `17. 16-sheet-sections/`.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green, including `shareArrival.test.ts`.
- **Simulator:**
  - the "Where to?" row shows the capsule and one profile circle, and the circle opens Settings;
  - the top right of the map shows Layers and Recenter only;
  - Nearby → Share arrival opens the share sheet with the same text as before.
- **Cold-launch quick actions** (Release build not needed; use a Debug dev client):
  - "Where to?" lands on Plan with `plan` open;
  - "Track PJ02" lands on Nearby tracking PJ02;
  - Home lands on Plan with results.
- **Live Activity link:** with a bus followed, tap the Live Activity. The app opens on Nearby even if Saved was the last section.

## Handoff to next step
- The profile circle replaces the Home/Work circles, the "…" menu is gone, and Share Arrival lives in Nearby.
- **Section writers are now:** `SectionPicker`, Saved route rows (04), quick actions, and bare-link handling (`hooks/useSectionLinks.ts`).
- `app/trip.tsx` was touched only in `whereTo`'s props.
- The design docs and the plans index are updated.
