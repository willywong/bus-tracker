# Phase 04 — UI Shell (Navigation + Theme + Glass Guard)

Set up the navigation skeleton using Expo Router Native Tabs (real `UITabBarController` — renders iOS 26 Liquid Glass tab bar automatically), define the color + typography tokens, and ship the shared glass availability guard used throughout later phases.

## Dependencies
- Phase 00 complete: `expo-router` installed, `expo-glass-effect` installed.

## Success criteria
1. `app/_layout.tsx` renders `<NativeTabs>` with three triggers: Tracker (index, SF Symbol `house.fill`), Map (`map.fill`), Settings (`gear`).
2. Placeholder screens boot in Simulator; tab switching works.
3. `DynamicColorIOS()` drives `tintColor` + `labelStyle` for dark/light.
4. `components/GlassGuard.tsx` centralises the `isGlassEffectAPIAvailable() || isLiquidGlassAvailable()` runtime check, returning either the glass child or a `BlurView` fallback.

## Task order
1. [01-native-tabs-layout.md](./01-native-tabs-layout.md)
2. [02-theme-tokens.md](./02-theme-tokens.md)
3. [03-glass-availability-guard.md](./03-glass-availability-guard.md)

## Hand-off to Phase 05
- Tracker tab (`app/(tabs)/index.tsx`) is mounted but renders only a "hello world" placeholder.
- Glass guard is importable and returns `true` on iOS 26 devices / `false` on iOS 25 and below (+ Simulator fallbacks).
