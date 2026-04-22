# 11-Multi-Bus-Search / 10 — Dropdown "Add bus…" Button

## Context
- `RouteSwitcher.tsx` is the @expo/ui Menu pill at the top of the Tracker screen. It currently maps over `options: readonly RouteId[]` and renders one Menu Button per route.
- We need to append an "Add bus…" Button at the bottom of the same Menu, plus handle the empty-favorites case where the trigger itself becomes an "Add bus" pill (no menu, taps directly open the modal).

## Goal
Append "Add bus…" to the dropdown Menu. When `options.length === 0`, the trigger is a single-tap shortcut to the Add Bus modal.

## Prerequisites
- Tasks 04 + 07 + 09 complete.

## Skills to invoke first
- **`mcp__plugin_context7_context7`** — query `@expo/ui/swift-ui` docs for:
  - `Menu` — confirm whether menu items can be visually grouped (SwiftUI `Section` inside a `Menu` is the canonical way to put "Add bus…" under a divider; verify exposure in the pinned version).
  - `Button` props inside a `Menu` — `role: 'destructive'` styling and `systemImage` placement.
  - `glassEffect` and `Pressable`/`onPress` semantics inside a `Host matchContents` — the empty-state trigger needs reliable tap handling.
- **`frontend-design:frontend-design`** — invoke to decide whether the empty-state pill says "Add bus" (matches the menu item label) or something more inviting like "Add your first bus", and whether the + glyph leads or trails the label.

The plan below assumes a flat menu with "Add bus…" appended last. If `Section`-inside-`Menu` is supported, prefer wrapping the route Buttons in one Section and the Add bus Button in a separate Section so iOS renders the divider automatically.

## Steps

1. **Extend `RouteSwitcher` props** in `apps/mobile/components/tracker/RouteSwitcher.tsx`:
   ```tsx
   interface RouteSwitcherProps {
     selected: string | null;
     options: readonly string[];
     onSelect: (code: string) => void;
     onAddBus: () => void;
   }
   ```

2. **Empty-state trigger**: when `options.length === 0`, render a Pressable HStack instead of a Menu:
   ```tsx
   if (options.length === 0) {
     return (
       <Host matchContents style={{ alignSelf: 'center' }}>
         <HStack
           spacing={6}
           modifiers={[
             fixedSize(),
             padding({ horizontal: 14, vertical: 8 }),
             glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
           ]}
         >
           <Image systemName="plus" size={14} />
           <Text>Add bus</Text>
         </HStack>
       </Host>
     );
   }
   ```
   - Wrap in a RN `Pressable` outside the `Host` (or inside, depending on @expo/ui's tap semantics — verify with Simulator). Tap → `onAddBus()`.

3. **Append the Add Button to the Menu** for the populated case:
   ```tsx
   {options.map((code) => (
     <Button key={code} systemImage={code === selected ? 'checkmark' : undefined} label={code} onPress={() => onSelect(code)} />
   ))}
   <Button key="__add" systemImage="plus" label="Add bus…" onPress={onAddBus} />
   ```

4. **Wire the prop chain**:
   - `apps/mobile/components/tracker/HeroCountdown.tsx`: add `onAddBus: () => void` to its props, forward to `RouteSwitcher`.
   - `apps/mobile/app/(tracker)/index.tsx`: import `useRouter` from `expo-router`, pass `onAddBus={() => router.push('/add-bus')}` to `HeroCountdown`.

5. **Handle the `selected` widening**: `RouteSwitcher` now accepts `selected: string | null`. Update the trigger label rendering — if `selected == null`, show "Add bus" (handled by the empty-state branch above).

6. **Visual touch**: the Menu's last item (Add bus) gets a subtle separator above it via SwiftUI's native menu styling (no manual divider needed — iOS does this automatically when items have `systemImage`).

## Verification
- With ≥ 1 favorite: dropdown shows favorites + "Add bus…" at the bottom. Tap it → modal opens.
- With 0 favorites: trigger pill shows "Add bus" with a + icon. Tap → modal opens.
- After adding a bus from the empty state, the trigger morphs into the normal route pill on next render.

## Handoff to next step ([11-settings-favorites-management.md](./11-settings-favorites-management.md))
- The end-to-end add flow is functional from the Tracker screen. Task 11 brings remove + reorder + per-route stop edit to the Settings screen.
