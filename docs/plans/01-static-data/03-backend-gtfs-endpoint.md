# 01-Static-Data / 03 — Backend GTFS Static Endpoint

## Context
- Steps 01–02 complete. We can turn a ZIP into a small T816 bundle.
- Doing this in the mobile app every launch is wasteful; do it once on the server and cache.

## Goal
Implement `GET /api/gtfs-static` in `apps/api` that serves the cached T816 bundle as JSON. Cache in memory (edge runtime) with a 24h TTL, warming from the upstream ZIP on miss.

## Prerequisites
- Steps 01–02.

## Steps
1. Create `apps/api/api/gtfs-static.ts`:
   - Fetch the upstream ZIP.
   - Parse + filter via `@bus-tracker/shared` utils.
   - Respond `Cache-Control: public, max-age=86400, stale-while-revalidate=86400`.
2. Optionally persist to Vercel KV (or blob) keyed by date so multiple regions share the cache.
3. Handle upstream failure: return stale cached bundle if present, else HTTP 503.

## Verification
- `curl $API/gtfs-static | jq '.stops | length'` ≥ 2.
- Second request is served from cache (sub-200ms).

## Handoff to next step ([04-daily-cron.md](./04-daily-cron.md))
- Endpoint exists and caches.
- Still relies on cold-start for refresh; next task wires a daily cron.
