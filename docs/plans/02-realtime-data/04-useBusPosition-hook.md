# 02-Realtime-Data / 04 — useBusPosition Hook

## Context
- Steps 01–03: clean T816 positions are available in a store.
- Screens need a React-friendly way to subscribe.

## Goal
Ship `apps/mobile/hooks/useBusPosition.ts` returning `{ positions, lastUpdated, error }` and starting/stopping the poller on mount/unmount.

## Prerequisites
- Steps 01–03.

## Steps
1. Hook mounts → calls `realtimeStore.start()` (idempotent — count subscribers).
2. Subscribes with `useSyncExternalStore`.
3. Returns latest `positions` + metadata.
4. Cleanup decrements ref count; when 0, stop polling.

## Verification
- Two screens using the hook simultaneously → one poller.
- Unmounting all consumers stops network traffic (verify in React Native Debugger).

## Handoff — Phase 02 complete
- `useBusPosition()` is the single entry point for live vehicle data.
- Phase 03 feeds its output into the ETA engine.
