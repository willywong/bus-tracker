# 11-Multi-Bus-Search / 06 — Dynamic Realtime Polling

## Context
- `apps/mobile/services/realtime.ts` defines `ROUTE_CODES = ["T816", "T815"] as const` at line 15 and uses it in the default `loadTripMap`. Vehicles whose trip_id maps to any other route get filtered out before they reach the UI.
- The `realtimeStore` is a module-level singleton (`export const realtimeStore = createRealtimeStore()`), so there's no place to inject the active route set.

## Goal
Make the realtime poll target the user's full `favoritedRoutes` list, dynamically. Active route's positions still feed the Tracker; other favorites' positions remain in the snapshot for future Map use.

## Prerequisites
- Task 04 — `useSettings.favoritedRoutes` available.

## Steps

1. **Drop the constant** `ROUTE_CODES` in `apps/mobile/services/realtime.ts`.

2. **Refactor `loadTripMap`** to be parameterized rather than fixed:
   ```ts
   loadTripMap: async (routeCodes: readonly string[]) => {
     if (routeCodes.length === 0) return new Map();
     const db = await openDb();
     const raw = await getTripToRouteMap(db, routeCodes);
     const typed = new Map<string, string>();
     for (const [tripId, code] of raw) typed.set(tripId, code);
     return typed;
   }
   ```

3. **Add `setRouteCodes(codes: readonly string[])`** to the `RealtimeStore` interface:
   - Stores the codes in a closure variable.
   - Clears the cached `tripMap` so the next tick rebuilds it.
   - If polling is active, schedules an immediate tick.
   - No-op if `codes` are equal (compare via `JSON.stringify(sorted)`).

4. **Convert the singleton to a hook** `apps/mobile/hooks/useRealtimeRoutes.ts`:
   ```ts
   export function useRealtimeRoutes(routeCodes: readonly string[]): void {
     useEffect(() => {
       realtimeStore.setRouteCodes(routeCodes);
     }, [routeCodes.join(',')]);
   }
   ```
   - Mount this hook in `RootLayout` (or a child) that has access to `useSettings`.

5. **Update `useBusPosition`** in `apps/mobile/hooks/useBusPosition.ts`:
   - Currently it returns positions filtered to the active route. Keep that filter; just sourcing changes.
   - Verify `positions` array now contains entries for every favorite — apply the existing `routeCode === settings.preferredRouteCode` filter at the consumer.

6. **Empty favorites guard**: when `routeCodes.length === 0`, `setRouteCodes([])` should stop polling entirely (no point hitting the realtime feed). Add `start/stop` short-circuit logic.

7. **Test**: extend `realtime.test.ts` (if it exists; otherwise add) with a case that calls `setRouteCodes(["T816"])`, then `setRouteCodes(["T816", "T815"])`, asserting `loadTripMap` is called with each set in turn.

## Verification
- Add T816 + T815 favorites → realtime feed yields positions for both. Switch active to T815 → CurrentBusCard shows T815 vehicle.
- Remove T816 → next tick's tripMap excludes T816. Vehicles for T816 stop appearing.
- Empty favorites → no realtime requests fire (verify in Charles/network log).

## Handoff to next step ([07-add-bus-modal-route.md](./07-add-bus-modal-route.md))
- All data layers (SQLite + realtime) are now driven by `settings.favoritedRoutes`. Adding/removing favorites flows through automatically. UI for the "Add bus" flow is next.
