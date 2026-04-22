# 11-Multi-Bus-Search / 04 — Mobile Favorites Store

## Context
- The active route is currently a single `RouteId` validated against `AVAILABLE_ROUTE_CODES = ['T816', 'T815']` in `apps/mobile/hooks/useSettings.ts`. The "list of buses the user uses" doesn't exist yet — it's an implicit two-element constant.
- We need a persisted, mutable list (`favoritedRoutes: string[]`) that drives the dropdown, the Settings list, the realtime poll, and the bootstrap fetch.

## Goal
Replace the static `AVAILABLE_ROUTE_CODES` with a persisted `favoritedRoutes: string[]` in `useSettings`, plus add/remove/reorder setters. Existing users land in the empty state — no pre-seed.

## Prerequisites
- Task 01 — `RouteId` is `string`.
- Existing SecureStore + `setState/writeValue` pattern in `useSettings.ts` understood.

## Steps

1. **Extend `Settings`** in `apps/mobile/hooks/useSettings.ts`:
   ```ts
   export interface Settings {
     // …existing fields…
     favoritedRoutes: string[];        // NEW: ordered list, e.g. ["T816", "T815"]
     preferredRouteCode: string | null; // CHANGED: was RouteId, now nullable
     preferredStopByRoute: Record<string, string>; // CHANGED: was Partial<Record<RouteId, …>>
   }
   ```

2. **Drop the constants** that hard-code the route set:
   - Delete `AVAILABLE_ROUTE_CODES`.
   - Delete `STOP_DEFAULTS_BY_ROUTE`.
   - Delete `DEFAULT_PREFERRED_ROUTE_CODE`.
   - Update `DEFAULT_SETTINGS`: `favoritedRoutes: []`, `preferredRouteCode: null`, `preferredStopByRoute: {}`.

3. **Update validators**:
   - Replace `parseRouteOr(value, fallback)` with `parseRouteOr(value, knownFavorites)` — returns the value if it's in `knownFavorites`, else returns `null`.
   - Update `parseStopByRoute` to accept any string keys (drop the `AVAILABLE_ROUTE_CODES.includes` check).

4. **Add a `favoritedRoutes` storage key** in `STORAGE_KEYS`:
   ```ts
   favoritedRoutes: 'bt.favoritedRoutes',
   ```
   - On load: `JSON.parse` the array; default to `[]` if missing or malformed.

5. **Add new setters on `SettingsApi`**:
   ```ts
   addFavorite(code: string, stopId: string): void;
   removeFavorite(code: string): void;
   reorderFavorites(nextOrder: string[]): void;
   ```
   - `addFavorite`: appends to `favoritedRoutes` (no-op if already present), writes `preferredStopByRoute[code] = stopId`, and if `preferredRouteCode` is `null`, sets it to `code`.
   - `removeFavorite`: removes from `favoritedRoutes`, deletes the matching `preferredStopByRoute[code]`. If the active route was removed, set `preferredRouteCode` to `favoritedRoutes[0] ?? null`.
   - `reorderFavorites`: replaces the array; validates that the new order contains exactly the same codes (no add/remove side-effects).
   - All three persist via `writeValue(STORAGE_KEYS.favoritedRoutes, JSON.stringify(next))` and `writeValue(STORAGE_KEYS.preferredStopByRoute, JSON.stringify(next))` as appropriate.

6. **Update `setPreferredRouteCode`** to accept `string | null` and validate against `favoritedRoutes` at call time.

7. **Drop the legacy single-stop migration code** (`legacyStop` / `resolveStopByRoute`). Existing users with the old `bt.preferredRouteCode` value land in the empty state by design — see migration note in the README.

8. **Update `preferredStopId` derivation**:
   ```ts
   preferredStopId:
     state.preferredRouteCode != null
       ? state.preferredStopByRoute[state.preferredRouteCode] ?? ''
       : '',
   ```

9. **Touch the consumers** that imported `AVAILABLE_ROUTE_CODES`:
   - `apps/mobile/app/index.tsx`: replace with `settings.favoritedRoutes`.
   - `apps/mobile/app/settings.tsx`: replace with `settings.favoritedRoutes` (full Settings rewrite happens in task 11; this task just keeps the existing rendering working with the new source).
   - `apps/mobile/db/bootstrap.ts`: temporarily import nothing — task 05 rewrites the bootstrap shape.

## Verification
- `pnpm --filter mobile typecheck` passes.
- Add a unit test for `useSettings` with a fake SecureStore: `addFavorite('T816', 's1')` then `addFavorite('T815', 's2')` → `favoritedRoutes === ['T816', 'T815']`, `preferredRouteCode === 'T816'`. `removeFavorite('T816')` → active becomes `'T815'`. `removeFavorite('T815')` → active becomes `null`.
- Manual: launch the app on Simulator → empty state path is exercised (Tracker still mounts even with `null` route, will be polished in task 12).

## Handoff to next step ([05-mobile-incremental-bundle.md](./05-mobile-incremental-bundle.md))
- `useSettings` now exposes `favoritedRoutes`, `addFavorite`, `removeFavorite`, `reorderFavorites`. The bootstrap layer can subscribe to this list and fetch per-route bundles.
