# 11-Multi-Bus-Search / 07 — Add Bus Modal Route

## Context
- The app's root layout in `apps/mobile/app/_layout.tsx` is `<NativeTabs>` with three triggers (`index`, `map`, `settings`). There's no `Stack` and no modal route in the codebase.
- The Add Bus search screen needs to present as a native iOS modal sheet over the Tracker tab — the standard pattern for a temporary, dismissable secondary screen.

## Goal
Restructure the Tracker tab into an Expo Router route group with its own `Stack`, so `/add-bus` opens as a full-screen modal without affecting the Map or Settings tabs.

## Prerequisites
- Phase 04 complete — `NativeTabs` set up.
- Phase 05 complete — Tracker screen at `apps/mobile/app/index.tsx`.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — `resolve-library-id` for `expo-router`, then `query-docs` for "Stack screen presentation modes, modal, formSheet, sheetAllowedDetents, sheetGrabberVisible, sheetCornerRadius". This task ships with `presentation: 'modal'` for v1 (per user direction — easier to evaluate the flow first). After the user reviews v1, we'll likely upgrade to `'formSheet'` with detents — confirm the API surface in the pinned SDK 54 docs at upgrade time. Also query `@expo/ui` for any native `Sheet` / `NavigationStack` primitives that could supersede the Expo Router approach.
- **`frontend-design:frontend-design`** — invoke to settle the modal's header treatment, dismiss affordance (Cancel button vs. swipe-down), and overall visual weight.

**Presentation mode: v1 = `'modal'`, follow-up = `'formSheet'`.** The user wants to see the full-screen modal first to evaluate UX before committing to a half-sheet. If the modal feels heavy for a quick search-and-pick flow, the upgrade path is a one-line change (see step 5).

## Steps

1. **Create the route group folder** `apps/mobile/app/(tracker)/`:
   - Move `apps/mobile/app/index.tsx` → `apps/mobile/app/(tracker)/index.tsx`. (Keep the file's content for now — the empty-state branch lands in task 12.)
   - Create `apps/mobile/app/(tracker)/_layout.tsx`:
     ```tsx
     import { Stack } from 'expo-router';
     import { PlatformColor } from 'react-native';

     export default function TrackerStackLayout() {
       return (
         <Stack
           screenOptions={{
             headerShown: false,
             contentStyle: { backgroundColor: PlatformColor('systemGroupedBackground') },
           }}
         >
           <Stack.Screen name="index" />
           <Stack.Screen
             name="add-bus"
             options={{
               presentation: 'modal',  // v1 — full-screen modal. Upgrade to 'formSheet' after UX review.
               headerShown: true,
               title: 'Add bus',
               headerLargeTitle: false,
             }}
           />
         </Stack>
       );
     }
     ```
   - Create empty placeholder `apps/mobile/app/(tracker)/add-bus.tsx`:
     ```tsx
     import { Text, View } from 'react-native';
     export default function AddBusScreen() {
       return <View><Text>Add Bus</Text></View>;
     }
     ```
     The full UI lands in tasks 08–09.

2. **Update the root layout** `apps/mobile/app/_layout.tsx`:
   - Change `<NativeTabs.Trigger name="index">` to `<NativeTabs.Trigger name="(tracker)">`. Expo Router's `NativeTabs` matches the route group by name and presents its `_layout.tsx` Stack as the tab's content.
   - Verify the tab icon (`tram.fill`) and label ("Tracker") still bind correctly.

3. **Verify Map and Settings tabs are unaffected** — they remain at `apps/mobile/app/map.tsx` and `apps/mobile/app/settings.tsx` (siblings of the route group).

4. **Test navigation** — temporarily add a button to `(tracker)/index.tsx` that calls `router.push('/add-bus')` and confirm the modal animates up with the iOS native dismiss gesture. Remove the test button after.

5. **Future upgrade — `'formSheet'`**: once the user has reviewed the v1 modal, the most likely next iteration is a half-sheet. The change is local to this file:
   ```tsx
   presentation: 'formSheet',
   sheetAllowedDetents: [0.5, 1.0],   // half + full
   sheetGrabberVisible: true,
   sheetCornerRadius: 24,
   ```
   At that time, query context7 to confirm the prop names match the pinned `expo-router` version.

## Verification
- Tracker tab loads with the existing UI; no visible change to the user.
- `router.push('/add-bus')` from any handler in `(tracker)/index.tsx` opens the placeholder Add Bus screen as a full-screen modal.
- Swipe-down dismisses the modal; user lands back on Tracker.
- Switching to Map or Settings tab still works; switching back to Tracker preserves modal state if open.

## Handoff to next step ([08-search-screen-ui.md](./08-search-screen-ui.md))
- The modal route exists. Task 08 fills `add-bus.tsx` with the search field + results list.
- The Stack layout is in place — future Tracker-tab subscreens (e.g. a bus detail view) can be added without further structural changes.
