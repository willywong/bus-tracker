# 11-Multi-Bus-Search / 01 — Shared Package Generalization

## Context
- The shared package was written assuming a tiny, fixed set of RapidKL routes. `filterToT816` in `packages/shared/src/utils/t816-bundle.ts` defaults its `codes` parameter to `T816_TARGET_CODES` (five hard-coded codes). `RouteId` in `packages/shared/src/types/bus.ts` is a closed string-literal union.
- Both are structural blockers to serving arbitrary routes through the same code paths. Before any API or mobile work, the shared primitives must become route-agnostic.

## Goal
Rename `filterToT816` → `filterToRoutes`, drop the T816 default, widen `RouteId` to `string`, and add a new `searchRoutes(parsed, query)` helper that will back the `/api/routes/search` endpoint.

## Prerequisites
- Monorepo build green (`pnpm -w build` / `pnpm -w typecheck`).
- Phases 01–10 complete — the existing filter implementation and its two callers (`GtfsBundleService.getBundle`, `GtfsBundleService.refresh`) are in place.

## Steps

1. **Widen `RouteId`** in `packages/shared/src/types/bus.ts`:
   - Replace `export type RouteId = "T816" | "T815" | "T786" | "PJ01" | "PJ02";` with `export type RouteId = string;`.
   - Keep the `RouteId` name — call sites still read as "route id" without a find/replace. The alias documents intent.

2. **Rename and generalize the filter** in `packages/shared/src/utils/t816-bundle.ts`:
   - Rename `filterToT816` → `filterToRoutes`.
   - Remove the default value for `codes` — callers must pass an explicit array. (Prevents accidental reuse of the old T816-specific default.)
   - Keep `T816_TARGET_CODES` exported **only** as a convenience for tests/fixtures — drop any production use.
   - Re-export under the old name for one release: `export { filterToRoutes as filterToT816 }` with a `@deprecated` JSDoc tag.

3. **Add `searchRoutes` helper** in a new file `packages/shared/src/utils/search-routes.ts`:
   ```ts
   export interface RouteSearchHit {
     code: string;
     long_name?: string;
     matchedStops?: { stop_id: string; stop_name: string }[];
   }

   export function searchRoutes(
     parsed: ParsedGtfs,
     query: string,
     limit: number = 25,
   ): RouteSearchHit[];
   ```
   - Normalize the query (trim, uppercase, strip punctuation).
   - Three match passes, in priority order:
     1. Exact match on `route_short_name` → rank = 0.
     2. Substring match on `route_short_name` or `route_long_name` → rank = 1.
     3. Substring match on any stop name the route serves (via `trips → stop_times → stops` join) → rank = 2, and attach the up-to-3 matching stops to `matchedStops`.
   - De-dupe by `route_id`, keep the lowest-rank hit. Sort by rank then code. Cap at `limit`.

4. **Export from the package barrel** `packages/shared/src/utils/index.ts`:
   - Add `export { filterToRoutes, filterToT816, T816_TARGET_CODES } from "./t816-bundle.js";`
   - Add `export { searchRoutes, type RouteSearchHit } from "./search-routes.js";`

5. **Update call sites in `apps/api/src/gtfs-service.ts`**:
   - Replace `filterToT816(parseGtfsZip(zip), undefined, this.now)` with `filterToRoutes(parseGtfsZip(zip), T816_TARGET_CODES as unknown as string[], this.now)`. (Keeps behavior identical for the existing `/api/gtfs-static` endpoint.)

## Verification
- `pnpm -w typecheck` passes — no callers broken by the `RouteId` widening.
- `pnpm -w test` passes — add unit tests for `searchRoutes` covering: exact code match (`"T816"`), partial code match (`"T8"`), partial long-name match (`"Mutiara"`), stop-name match (`"Phileo"`), empty query, > 25 results (cap respected).
- `apps/api` still responds to `/api/gtfs-static` with the same shape (behavior unchanged).

## Handoff to next step ([02-api-routes-search-endpoint.md](./02-api-routes-search-endpoint.md))
- Shared package exports `filterToRoutes`, `searchRoutes`, `RouteSearchHit`.
- `RouteId` is `string`. No more literal-union friction for downstream code.
- The API layer can now wire a new search endpoint with `searchRoutes` as the core function.
