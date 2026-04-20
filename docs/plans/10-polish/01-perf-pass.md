# 10-Polish / 01 — Performance Pass

## Context
- Brief §4.2 warns: stacking translucent views is GPU-intensive.
- Target: 60 FPS on device, especially on the Map screen with the glass overlay.

## Goal
Measure and fix any perf regressions.

## Steps
1. Connect iPhone → Xcode → Instruments → **Core Animation** template.
2. Profile Tracker, then Map with bus movement.
3. Look for:
   - FPS < 58 during scroll or map pan.
   - Multiple overlapping glass views (collapse into `GlassContainer` or single `GlassView`).
   - Re-renders from `useEta()` or `useBusPosition()` that can be memoised.
4. Fix top 1–2 hotspots.

## Verification
- Instruments shows ≥58 FPS sustained.

## Handoff to next step ([02-error-states.md](./02-error-states.md))
