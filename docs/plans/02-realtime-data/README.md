# Phase 02 — GTFS Realtime Pipeline

Poll the realtime vehicle-position endpoint every 30 seconds, decode the protobuf, filter to T816 vehicles using the static trip→route map, and drop GPS outliers (jumps >500m per 30s).

## Dependencies
- Phase 00: `protobufjs` installed.
- Phase 01: static trip→route mapping + T816 route id are cached in SQLite.

## Success criteria
1. `services/realtime.ts` fetches `https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder` every 30s while the app is foregrounded.
2. Response decodes successfully via `protobufjs` using the canonical `gtfs-realtime.proto`.
3. Only vehicles whose `trip_id` maps to T816 are kept.
4. Outlier filter discards any position that jumps >500m since the previous reading for the same vehicle.
5. `useBusPosition()` React hook exposes the latest valid position(s), last-updated timestamp, and error state.

## Task order
1. [01-protobuf-schema.md](./01-protobuf-schema.md)
2. [02-realtime-fetcher.md](./02-realtime-fetcher.md)
3. [03-outlier-filter.md](./03-outlier-filter.md)
4. [04-useBusPosition-hook.md](./04-useBusPosition-hook.md)

## Hand-off to Phase 03
- Hook available: `const { positions, lastUpdated, error } = useBusPosition()`.
- Each `position` has `{ vehicleId, lat, lng, bearing?, speed?, tripId, observedAt }`.
- Outlier-rejected positions are logged but not emitted.
