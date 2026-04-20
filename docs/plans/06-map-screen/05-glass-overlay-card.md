# 06-Map-Screen / 05 — Glass Overlay Card

## Context
- Map is functional; need a floating ETA readout that doesn't cover the map.

## Goal
Add a floating `GlassView` (via `GlassGuard`) at the bottom of the map showing the live ETA.

## Prerequisites
- `GlassGuard` (Phase 04 step 03).
- `useEta()`.

## Steps
1. Absolute-positioned view above the tab bar:
   ```tsx
   <GlassGuard style={styles.overlay} glassEffectStyle="clear">
     <Text>Bus in {minutesToStop} min</Text>
   </GlassGuard>
   ```
2. Avoid stacking glass layers — only this one glass view on the Map screen (brief §4.2).

## Verification
- Overlay sits above map; glass effect renders on real device.

## Handoff — Phase 06 complete
- Map is fully functional.
- Phase 07 moves to Settings, which will feed `preferredStop` into both this map and the ETA engine.
