# 11-Multi-Bus-Search / 03 — API Route Detail Endpoint

## Context
- Task 02 added `/api/routes/search` backed by `getParsed()`. The mobile app also needs a way to fetch the full GTFS data (stops, trips, shapes, stop_times, calendar) for a **single** route on demand, so it can merge that route into its local SQLite when the user adds a favorite.
- The existing `/api/gtfs-static` returns a five-route bundle — too coarse for the new incremental model.

## Goal
Add `GET /api/route/[code]` on Vercel Edge that returns a `T816Bundle`-shaped payload containing only the requested route.

## Prerequisites
- Task 01 complete — `filterToRoutes(parsed, [code])` available.
- Task 02 complete — `GtfsBundleService.getParsed()` available.

## Steps

1. **Create the endpoint** at `apps/api/api/route/[code].ts`:
   ```ts
   export const config = { runtime: "edge" };

   export default async function handler(req: Request, ctx: { params: { code: string } }): Promise<Response> {
     const code = String(ctx.params.code).trim().toUpperCase();
     if (!code || code.length > 16) return new Response("invalid code", { status: 400 });

     const { parsed } = await defaultService.getParsed();
     const bundle = withTrafficSignals(filterToRoutes(parsed, [code]));
     if (bundle.routes.length === 0) return new Response("not found", { status: 404 });

     return new Response(JSON.stringify(bundle), {
       headers: {
         "content-type": "application/json",
         "cache-control": "public, max-age=86400, stale-while-revalidate=86400",
       },
     });
   }
   ```
   - Vercel's Edge runtime extracts `code` from the path via the `[code].ts` filename convention.

2. **Traffic signals**: `withTrafficSignals` already keys by `route_code`, so only the signals for this route leak into the response. Verify at test time that only the requested route's signals are present.

3. **Add integration test** `apps/api/src/__tests__/route-detail.test.ts`:
   - Fixture ZIP with T816 + T815. Request `T816` → `routes.length === 1 && routes[0].code === "T816"`, `trips.every(t => t.route_id === "R_T816")`, `stopTimes.length > 0`.
   - Request `XYZ` → HTTP 404.
   - Request case-insensitive: `t816` → same as `T816`.

## Verification
- `curl "http://localhost:3000/api/route/T816" | jq '.routes[0].code'` → `"T816"`.
- `curl "http://localhost:3000/api/route/T816" | jq '.trips | length'` > 0.
- `curl -i "http://localhost:3000/api/route/XYZ"` → HTTP 404.
- Response size typically < 200 KB per route (well below Edge limits).

## Handoff to next step ([04-mobile-favorites-store.md](./04-mobile-favorites-store.md))
- `GET /api/route/:code` returns a T816Bundle with exactly one route's data.
- The mobile can now fetch + merge per-route GTFS on demand; task 04 wires the favorites store that drives which routes to fetch.
