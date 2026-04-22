# 11-Multi-Bus-Search / 02 — API Routes Search Endpoint

## Context
- Task 01 delivered `searchRoutes(parsed, query)` in `@bus-tracker/shared`. It needs a server-side caller.
- The existing `GtfsBundleService` in `apps/api/src/gtfs-service.ts` caches the **filtered** T816 bundle. Search needs the **unfiltered** parsed GTFS so results can span every MRT-feeder route, not just the five we currently expose.

## Goal
Add `GET /api/routes/search?q=<query>` on Vercel Edge that returns up to 25 `RouteSearchHit` results from the unfiltered MRT-feeder feed.

## Prerequisites
- Task 01 complete — `searchRoutes` and `RouteSearchHit` exported.
- Existing `GtfsBundleService` pattern understood — singleton with 24 h TTL, in-memory cache per isolate.

## Steps

1. **Extend `GtfsBundleService`** in `apps/api/src/gtfs-service.ts`:
   - Add a second cache slot for `ParsedGtfs` (the result of `parseGtfsZip` before filtering). Same TTL; same ZIP fetch.
   - New method: `async getParsed(): Promise<{ parsed: ParsedGtfs; cached: boolean }>`. Reuses the same ZIP fetcher — if a ZIP was just parsed for `getBundle`, reuse the parsed result rather than re-parsing.
   - Refactor `getBundle` / `refresh` to call a private `fetchParsed()` helper so the ZIP is parsed once and both caches are populated in lockstep.

2. **Create the endpoint** at `apps/api/api/routes/search.ts`:
   ```ts
   export const config = { runtime: "edge" };

   export default async function handler(req: Request): Promise<Response> {
     const url = new URL(req.url);
     const qRaw = url.searchParams.get("q");
     if (!qRaw) return new Response("q required", { status: 400 });
     const q = qRaw.trim().slice(0, 32);
     if (q.length === 0) return new Response("q required", { status: 400 });

     const { parsed } = await defaultService.getParsed();
     const hits = searchRoutes(parsed, q, 25);
     return new Response(JSON.stringify(hits), {
       headers: {
         "content-type": "application/json",
         "cache-control": "public, max-age=300, stale-while-revalidate=86400",
       },
     });
   }
   ```

3. **Handle upstream failure** — if `getParsed()` throws and there is no cache, return `503`. If the cache is stale-but-present, serve it (same pattern as `getBundle`).

4. **Add unit/integration test** `apps/api/src/__tests__/routes-search.test.ts` — use a tiny fixture ZIP, assert HTTP 400 on missing `q`, 200 with results on `?q=T816`, 200 with empty array on `?q=zzzzzzz`, and that `cache-control` header is set.

5. **No change to `/api/gtfs-static`** — it remains the legacy endpoint serving the filtered five-route bundle. Task 05 will migrate the mobile off it in favor of the per-route detail endpoint.

## Verification
- Local dev: `pnpm --filter @bus-tracker/api dev`, then:
  - `curl "http://localhost:3000/api/routes/search?q=T8" | jq '.[0].code'` → starts with `"T"`.
  - `curl "http://localhost:3000/api/routes/search?q=Phileo" | jq '.[0].matchedStops'` → non-empty array.
  - `curl -i "http://localhost:3000/api/routes/search?q="` → HTTP 400.
  - Second identical request < 200 ms (warm).
- `pnpm --filter @bus-tracker/api test` passes.

## Handoff to next step ([03-api-route-detail-endpoint.md](./03-api-route-detail-endpoint.md))
- `/api/routes/search?q=` is live and memory-cached.
- `GtfsBundleService` now caches both parsed + filtered variants without double-parsing.
- Task 03 reuses `getParsed()` for the per-route endpoint.
