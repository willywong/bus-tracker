# 02-Realtime-Data / 02 — Realtime Fetcher Service

## Context
- Step 01: decoder is available.
- Static trip→route map is in SQLite.

## Goal
Implement `apps/mobile/services/realtime.ts` that polls the upstream endpoint every 30s while the app is foregrounded, decodes, and emits T816 vehicle positions.

## Prerequisites
- Step 01; Phase 01 trip→route map in SQLite.

## Steps
1. Create a small event emitter or `BehaviorSubject`-style store:
   ```ts
   export const realtimeStore = createStore<VehiclePosition[]>([]);
   ```
2. `start()` schedules a 30s loop (respect foreground state via `AppState`).
3. On each tick: `fetch('https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder')`, decode, filter to T816 trip ids, map to `VehiclePosition`, write to store.
4. Use `AbortController` to cancel in-flight requests on stop.
5. Handle network errors: keep last good state, expose `lastError` on store.

## Verification
- Console logs decoded positions at 30s cadence.
- Backgrounding the app pauses polling; foregrounding resumes it.

## Handoff to next step ([03-outlier-filter.md](./03-outlier-filter.md))
- Raw T816 positions flow every 30s; next step rejects bad GPS spikes before consumers see them.
