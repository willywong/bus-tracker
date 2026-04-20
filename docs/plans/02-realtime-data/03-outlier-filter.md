# 02-Realtime-Data / 03 — Outlier Filter

## Context
- Step 02: positions stream in.
- Brief §9 flags that GTFS can return bad GPS (>500m jump per 30s).

## Goal
Drop positions that jump >500m per vehicle since the last accepted reading. Log drops; don't silently lose data.

## Prerequisites
- Step 02; `@turf/distance` or haversine helper.

## Steps
1. Maintain an in-memory `Map<vehicleId, VehiclePosition>` of last-accepted.
2. Before accepting a new position, compute distance to the last accepted. If >500m → `console.warn('Outlier rejected', …)` and skip.
3. Edge case: a genuinely new vehicle has no prior — always accept first reading.
4. Reset state on `start()` / route change.

## Verification
- Unit test: inject synthetic jumps → correct ones accepted, bad one dropped.
- Live test: polling for >5 min shows no obvious teleports on the map.

## Handoff to next step ([04-useBusPosition-hook.md](./04-useBusPosition-hook.md))
- Downstream consumers can trust incoming positions.
