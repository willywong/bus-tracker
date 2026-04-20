# Phase 01 — Static GTFS Data Pipeline

Download the daily GTFS Static ZIP from data.gov.my, parse it, filter to T816-relevant rows, and cache the result in SQLite on device. This is the source of truth for stop coordinates, route shape polyline, and trip→route mapping used by every downstream phase.

## Dependencies
- Phase 00 complete: monorepo runs, API deploys, shared package importable, SQLite dep installed.

## Success criteria
1. `packages/shared/utils/gtfs-parser.ts` parses a real downloaded ZIP and returns typed rows for `routes`, `stops`, `trips`, `stop_times`, `shapes`, `calendar`.
2. `GET /gtfs-static` (API) returns a small JSON payload filtered to T816 only.
3. A daily Vercel cron at 04:00 Asia/Kuala_Lumpur refreshes the cache.
4. Mobile app on first launch fetches the filtered payload and persists it to `expo-sqlite`.
5. On subsequent launches the app reads from SQLite without re-downloading (unless cache is >24h old).

## Task order
1. [01-gtfs-static-parser-util.md](./01-gtfs-static-parser-util.md)
2. [02-t816-filter-and-shape.md](./02-t816-filter-and-shape.md)
3. [03-backend-gtfs-endpoint.md](./03-backend-gtfs-endpoint.md)
4. [04-daily-cron.md](./04-daily-cron.md)
5. [05-mobile-sqlite-cache.md](./05-mobile-sqlite-cache.md)

## Hand-off to Phase 02
- Route polyline (`shapes.txt` rows for T816) is available in device SQLite as `Array<{lat, lng, seq}>`.
- Stop table includes `Hotel Lisa De Inn` and `PJ210 Bangunan Sin Chew Daily (Opp)` with lat/lng.
- Trip→route lookup available so we can match realtime `trip_id` → T816.
