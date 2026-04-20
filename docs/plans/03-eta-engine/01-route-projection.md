# 03-ETA-Engine / 01 — Route Projection

## Context
- Phase 01 ships the T816 polyline; Phase 02 ships live bus coordinates.
- To estimate travel distance remaining, project the bus point onto the polyline.

## Goal
`projectOntoRoute(bus: LatLng, polyline: LatLng[]) → { segmentIndex, progress, remainingMeters }` in `packages/shared/src/utils/route.ts`.

## Prerequisites
- `@turf/nearest-point-on-line`, `@turf/helpers`, `@turf/length` or `distance`.

## Steps
1. Convert polyline to `lineString`, bus to `point`.
2. `nearestPointOnLine(line, point)` returns `{ location, dist, index }`.
3. Compute remaining meters along the polyline from `location` to the user's stop (also projected). Sum segment lengths.

## Verification
- Unit test with a 3-point polyline + a bus halfway → correct segment index + ~50% progress.
- On live data, remaining meters decreases over time as bus approaches stop.

## Handoff to next step ([02-loop-leg-detector.md](./02-loop-leg-detector.md))
- Projection returns geometry only — doesn't know outbound vs inbound leg of the circular route. Next step adds that.
