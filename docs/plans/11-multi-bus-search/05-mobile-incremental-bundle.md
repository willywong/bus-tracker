# 11-Multi-Bus-Search / 05 — Mobile Incremental Bundle Fetching

## Context
- `bootstrapStaticGtfs` in `apps/mobile/db/bootstrap.ts` calls `GET /api/gtfs-static`, replaces every row in SQLite, and validates the cache against `AVAILABLE_ROUTE_CODES`. This is incompatible with a dynamic favorites list — adding one bus shouldn't blow away the other routes' rows, and removing one shouldn't leave orphan stops.
- The new model: keep the SQLite schema, but populate it route-by-route from `GET /api/route/:code`.

## Goal
Rewrite `bootstrapStaticGtfs` to take a `routes: string[]` argument, fetch each route's bundle on demand from the new per-route endpoint, and merge into SQLite. Add a `pruneRoute` helper for removed favorites.

## Prerequisites
- Tasks 03 + 04 complete — per-route endpoint live, favorites store wired.

## Steps

1. **Replace `fetchBundleFromApi`** in `apps/mobile/db/bootstrap.ts`:
   ```ts
   export async function fetchRouteBundle(
     code: string,
     baseUrl: string = API_BASE_URL,
     signal?: AbortSignal,
   ): Promise<T816Bundle> {
     const res = await fetch(`${baseUrl}/api/route/${encodeURIComponent(code)}`, { signal });
     if (res.status === 404) throw new RouteNotFoundError(code);
     if (!res.ok) throw new Error(`route ${code}: ${res.status}`);
     return (await res.json()) as T816Bundle;
   }
   ```

2. **Add `mergeBundle(db, bundle)`** — same transaction shape as `writeBundle`, but per-route delete-then-insert:
   - For each `route` in `bundle.routes`:
     - `DELETE FROM trips WHERE route_id = ?` (cascade-equivalent — `stop_times`, `shape_points` get cleaned via the existing schema's join semantics, see step 3).
     - `DELETE FROM routes WHERE route_id = ?`.
     - `INSERT` the new route + its trips + shape_points + stop_times rows.
   - For each unique stop in `bundle.stops` not yet in the DB: `INSERT OR IGNORE INTO stops`. Stops are shared across routes — never delete.
   - For each calendar entry: `INSERT OR REPLACE INTO calendar`.
   - For traffic signals: `INSERT OR IGNORE INTO traffic_signals` keyed by `(route_code, osm_id)`.

3. **Add cascade-cleanup queries** since SQLite doesn't have ON DELETE CASCADE in this schema:
   ```sql
   DELETE FROM stop_times WHERE trip_id IN (SELECT trip_id FROM trips WHERE route_id = ?);
   DELETE FROM shape_points WHERE shape_id IN (SELECT shape_id FROM trips WHERE route_id = ?);
   ```
   Run these **before** the `DELETE FROM trips`. Do not delete shared stops or calendar entries (other routes may need them).

4. **Add `pruneRoute(db, code)`** — same logic as the per-route delete in `mergeBundle`, exposed as a standalone export so the favorites store's `removeFavorite` can trigger it.

5. **Rewrite `needsRefresh`** to return `string[]` (routes needing fetch), not boolean:
   - Stale (ts > 24 h ago): every route in `favoritedRoutes` needs refresh.
   - Missing routes: every favorite not present in the `routes` table needs fetch.
   - Routes-without-trips: every such route needs fetch.
   - Returns deduped array.

6. **Rewrite `bootstrapStaticGtfs`**:
   ```ts
   export async function bootstrapStaticGtfs(opts: {
     routes: string[];                                          // NEW: required
     db?: Db;
     fetchBundle?: (code: string, signal?: AbortSignal) => Promise<T816Bundle>;
     now?: () => number;
     force?: boolean;
     signal?: AbortSignal;
   }): Promise<{ refreshed: string[]; failed: string[] }>;
   ```
   - Coalescing: keep a per-`routes`-set inflight map (key = `routes.sort().join(',')`).
   - For each code in `needsRefresh(...)`: `fetchRouteBundle(code) → mergeBundle`. Catch per-route errors so one bad route doesn't block the rest.
   - Update `META_KEYS.fetchedAt` only if **all** fetches succeeded; otherwise leave it stale so the next launch retries.

7. **Wire to `RootLayout`** in `apps/mobile/app/_layout.tsx`:
   - Move the `useEffect(() => { bootstrapStaticGtfs(...) }, [])` inside a child component of `SettingsProvider` (since it now depends on `useSettings`).
   - Re-run when `settings.favoritedRoutes` changes (compared by stringified array).
   - On `removeFavorite` (detected via diff against previous list), call `pruneRoute(db, removedCode)`.

8. **Backwards compat**: leave `/api/gtfs-static` untouched on the API side. The mobile no longer calls it.

## Verification
- Fresh install with empty favorites → no API calls, no DB rows.
- Add `T816` → `/api/route/T816` is hit once, SQLite has T816 routes/trips/stop_times/shape_points; `stops` table has T816's stops.
- Add `T815` → `/api/route/T815` is hit, T816's data is still there, T815's data is added, shared stops are not duplicated.
- Remove `T816` → T816 rows gone, T815 rows still present, shared stops still present.
- Force-quit + relaunch → cache is reused (no fetches if < 24 h old).
- Background app for 25 h, foreground → all favorites refresh.

## Handoff to next step ([06-realtime-multi-route.md](./06-realtime-multi-route.md))
- SQLite holds GTFS data for exactly the user's favorites.
- The realtime poll still hard-codes `["T816", "T815"]` — task 06 makes that dynamic.
