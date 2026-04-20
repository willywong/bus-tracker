# 06-Map-Screen / 03 — Animated Bus Marker

## Context
- Polyline drawn; realtime positions available via `useBusPosition()`.

## Goal
Render each live T816 bus as a marker that tweens smoothly between 30s positional updates.

## Steps
1. For each `VehiclePosition`, render a `Marker`.
2. Use `MarkerAnimated` + `AnimatedRegion` to interpolate lat/lng over 30 seconds when a new position arrives.
3. Rotate marker to `bearing` if present.

## Verification
- Bus marker moves fluidly, not teleporting every 30s.

## Handoff to next step ([04-user-stop-marker.md](./04-user-stop-marker.md))
