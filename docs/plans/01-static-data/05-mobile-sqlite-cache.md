# 01-Static-Data / 05 — Mobile SQLite Cache

## Context
- Steps 01–04 complete. Backend serves a clean T816 JSON bundle.
- Mobile must work offline after first launch and not re-download on every open.

## Goal
On first launch, fetch `/api/gtfs-static`, write rows to `expo-sqlite`. Subsequent launches read from SQLite; refresh only if local data is >24h old.

## Prerequisites
- `expo-sqlite` installed (Phase 00 step 03).
- Backend endpoint live (step 03).

## Steps
1. Define schema in `apps/mobile/db/schema.ts`: tables `routes`, `stops`, `trips`, `shape_points`, `meta(fetchedAt INTEGER)`.
2. Implement `apps/mobile/db/bootstrap.ts`:
   - `openDatabaseAsync('t816.db')`.
   - If `meta.fetchedAt` is missing or older than 24h → fetch `/api/gtfs-static` → populate tables in a single transaction.
3. Expose typed query functions: `getStops()`, `getRoutePolyline()`, `getTripsForRoute(routeId)`.
4. Add a `useStaticGtfs()` hook that kicks off bootstrap on mount and exposes `{ ready, error }`.
5. Gate the Tracker/Map screens on `ready === true`.

## Verification
- Cold-launch: app fetches once, tables populated (verify via SQLite debugger).
- Warm-launch within 24h: no network call, screens render immediately.
- Airplane mode after first launch: app still works with cached data.

## Handoff — Phase 01 complete
- Static data is reliably on-device.
- Route polyline, stops, and trip↔route mapping available synchronously.
- Phase 02 can now consume the static trip↔route map to filter realtime vehicles.
