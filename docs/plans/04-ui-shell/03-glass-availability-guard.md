# 04-UI-Shell / 03 — Glass Availability Guard

## Context
- `expo-glass-effect` exposes `isGlassEffectAPIAvailable()` + `isLiquidGlassAvailable()` (verified in docs).
- Crashes have been observed on iOS 26 betas without a guard (brief §4.2).

## Goal
Ship `components/GlassGuard.tsx` centralising the runtime check and fallback.

## Prerequisites
- `expo-glass-effect` installed (Phase 00 step 03).

## Steps
1. ```tsx
   import { BlurView } from 'expo-blur';
   import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
   export function GlassGuard({ children, fallback, ...glassProps }) {
     if (isGlassEffectAPIAvailable() && isLiquidGlassAvailable()) {
       return <GlassView {...glassProps}>{children}</GlassView>;
     }
     return fallback ?? <BlurView intensity={30}>{children}</BlurView>;
   }
   ```
2. For `@expo/ui/swift-ui` trees, provide a parallel helper `glassIfAvailable()` that returns the `glassEffect` modifier or a no-op.

## Verification
- On iOS 26 device (later phase 09): glass renders.
- On a fresh Simulator on iOS 25 (if available): fallback `BlurView` renders, no crash.

## Handoff — Phase 04 complete
- Navigation, theme, glass guard all ready.
- Tracker screen (Phase 05) can now focus on content using `@expo/ui` primitives + `glassEffect` modifier.
