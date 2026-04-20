# 01-Static-Data / 02 — T816 Filter & Shape Extraction

## Context
- Step 01 complete: `parseGtfsZip` returns all rows across all routes.
- We only need T816 (and the alternative routes T786/PJ01/PJ02 per brief §2) — a few hundred rows total vs hundreds of thousands in the full feed.

## Goal
Add `filterToT816(parsed: ParsedGtfs): T816Bundle` reducing the full ZIP payload to only rows we need. Shape polyline, stop list, trip→route map.

## Prerequisites
- Step 01.

## Steps
1. Implement in `packages/shared/src/utils/gtfs-parser.ts` (or split into `t816-bundle.ts`):
   - Find T816 `route_id` in `routes.txt` by matching `route_short_name === 'T816'`.
   - Collect `trip_id`s for that route from `trips.txt`.
   - Collect `shape_id`s referenced by those trips.
   - Reduce `shapes.txt` to only those `shape_id` rows and emit a flat polyline `Array<{lat, lng, seq}>`.
   - Collect `stop_id`s referenced by `stop_times.txt` for those trips → filter `stops.txt`.
   - Repeat for T786/PJ01/PJ02 so the Settings alternative-stop feature works later.
2. Add `T816Bundle` type to `types/gtfs.ts`.
3. Test with a real ZIP snapshot committed as a fixture.

## Verification
- `filterToT816(parseGtfsZip(buf))` returns:
  - `routes.length >= 1`
  - `stops.length >= 2` (at least Hotel Lisa De Inn + PJ210)
  - `polyline.length > 50`

## Handoff to next step ([03-backend-gtfs-endpoint.md](./03-backend-gtfs-endpoint.md))
- Given a ZIP, we can produce a compact JSON bundle (< 100 KB) ready for shipping to the mobile client.
