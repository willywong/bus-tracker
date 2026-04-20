# 01-Static-Data / 04 — Daily GTFS Refresh Cron

## Context
- Step 03 complete. Endpoint caches on demand.
- Upstream publishes updates "as required"; we refresh once a day at ~04:00 Asia/Kuala_Lumpur (brief §3.2).

## Goal
Add a Vercel Cron trigger that hits an internal `/api/cron/refresh-gtfs` route daily, which re-downloads and re-caches the bundle.

## Prerequisites
- Step 03.

## Steps
1. Create `apps/api/api/cron/refresh-gtfs.ts` that re-runs the parse/filter pipeline and upserts to KV.
2. Add cron to `vercel.json`:
   ```json
   {
     "crons": [
       { "path": "/api/cron/refresh-gtfs", "schedule": "0 20 * * *" }
     ]
   }
   ```
   (UTC 20:00 == 04:00 Asia/KL.)
3. Protect the endpoint: require `Authorization: Bearer ${CRON_SECRET}` in production. Vercel includes this automatically for scheduled cron invocations.

## Verification
- After deploy: Vercel dashboard → Logs shows daily cron execution.
- Manually: `curl -H "Authorization: Bearer $CRON_SECRET" $API/cron/refresh-gtfs` returns 200.

## Handoff to next step ([05-mobile-sqlite-cache.md](./05-mobile-sqlite-cache.md))
- Server-side cache is always warm and fresh.
- Mobile client can treat `/gtfs-static` as effectively instant.
