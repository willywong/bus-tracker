# 06-Map-Screen / 02 — Route Polyline

## Context
- Map is empty beyond the region.

## Goal
Overlay the T816 polyline (from SQLite) on the map.

## Steps
1. Query cached `shape_points` ordered by sequence.
2. Render `<Polyline coordinates={points} strokeColor={tokens.accent} strokeWidth={4} />`.

## Verification
- Thick coloured line follows T816 route in the Simulator.

## Handoff to next step ([03-animated-bus-marker.md](./03-animated-bus-marker.md))
