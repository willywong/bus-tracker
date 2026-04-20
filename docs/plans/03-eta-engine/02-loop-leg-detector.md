# 03-ETA-Engine / 02 — Loop Leg Detector

## Context
- T816 is circular (brief §9). A bus at point P could be approaching the user's stop or just passed it.

## Goal
Determine whether the bus's current heading + position means it's approaching the user's stop (accept) or moving away (skip — pick the next bus).

## Prerequisites
- Phase 03 step 01.

## Steps
1. Extract heading from realtime `VehiclePosition.bearing` when present; otherwise compute from last two positions.
2. Compare heading vector to the polyline tangent at the stop's projected index.
3. If dot product > 0 and bus is "before" the stop along the polyline → approaching.
4. Otherwise → pick the *next* vehicle that is approaching.

## Verification
- Manual test: select a vehicle known to be inbound — detector returns "approaching". Pick an outbound — returns "departing" and a fallback vehicle is chosen.

## Handoff to next step ([03-traffic-proxy.md](./03-traffic-proxy.md))
- Given projection + leg detector, we have `(bus, remainingPolyline, stop)` with confidence this is the right vehicle.
