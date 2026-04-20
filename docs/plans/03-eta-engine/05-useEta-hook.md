# 03-ETA-Engine / 05 — useEta Hook

## Context
- All pieces exist: realtime positions, projection, leg detector, traffic proxy, dwell buffer.

## Goal
Expose a single hook `useEta({ stopId })` → `{ minutesToStop, isStale, source, vehicleId }` for UI consumers.

## Prerequisites
- Phase 02 + phase 03 steps 01–04.

## Steps
1. Compose: `useBusPosition()` → choose approaching vehicle via loop-leg detector → project → fetch traffic-eta → add dwell → return total minutes.
2. Debounce recomputation to ≤ once per 30s.
3. `isStale = (Date.now() - lastComputed) > 60_000`.
4. Fall back to `source: 'schedule'` (use `stop_times.txt`) when realtime/traffic unavailable.

## Verification
- Hook emits a value within ~3s of app launch (once SQLite warm).
- Value updates every 30s; doesn't spam traffic API.

## Handoff — Phase 03 complete
- UI can simply `const { minutesToStop } = useEta({ stopId })` and render.
- Phase 04 builds the navigation shell around this.
