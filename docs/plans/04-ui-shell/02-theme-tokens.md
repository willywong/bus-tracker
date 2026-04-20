# 04-UI-Shell / 02 — Theme Tokens

## Context
- Native Tabs wired; screens are empty.
- Both SwiftUI (`@expo/ui`) and React Native (Map) trees need consistent colors.

## Goal
Create `apps/mobile/theme/tokens.ts` exposing dark/light color pairs via `DynamicColorIOS()` + semantic names. Reuse in `tintColor`, `labelStyle`, NativeWind classes, and `PlatformColor` on @expo/ui.

## Prerequisites
- Phase 04 step 01.

## Steps
1. Define semantic tokens: `bg`, `fg`, `muted`, `accent`, `success`, `warning`, `danger`.
2. For RN: `DynamicColorIOS({ light, dark })`. For @expo/ui: `PlatformColor('systemGreen')` etc. where possible.
3. Add typography scale: `title`, `body`, `caption` sizes.
4. Export from a single module so every screen imports from one place.

## Verification
- Dark-mode toggle in Simulator flips all colors as expected.

## Handoff to next step ([03-glass-availability-guard.md](./03-glass-availability-guard.md))
- Ready to add the runtime glass guard that screens will use before rendering glass.
