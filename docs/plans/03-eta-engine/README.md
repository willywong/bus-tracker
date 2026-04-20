# Phase 03 — ETA Engine

Combine realtime bus position (Phase 02), static route shape + stop list (Phase 01), and a traffic-aware routing API (HERE, via the backend proxy) to produce a traffic-adjusted "minutes until bus reaches user's stop".

## Dependencies
- Phase 01 complete (stops + polyline cached).
- Phase 02 complete (`useBusPosition()` emits live positions).
- HERE API key obtained and set as `HERE_API_KEY` in `apps/api` env.

## Success criteria
1. `packages/shared/utils/route.ts` exposes `projectOntoRoute(busLatLng, polyline)` returning the nearest index + remaining distance along the polyline.
2. `packages/shared/utils/eta.ts` detects which leg of the T816 loop the bus is on (outbound vs inbound) given heading + position.
3. `GET /traffic-eta?origin=lat,lng&destination=lat,lng` (API) proxies HERE Maps and returns `{ trafficMinutes, sourceProvider, generatedAt }`.
4. Dwell-time buffer adds 1–2 min per intermediate stop.
5. `useEta()` hook emits `{ minutesToStop, isStale, source }` and re-computes whenever realtime or static inputs change.

## Task order
1. [01-route-projection.md](./01-route-projection.md)
2. [02-loop-leg-detector.md](./02-loop-leg-detector.md)
3. [03-traffic-proxy.md](./03-traffic-proxy.md)
4. [04-dwell-buffer.md](./04-dwell-buffer.md)
5. [05-useEta-hook.md](./05-useEta-hook.md)

## Hand-off to Phase 04
- `useEta()` returns a minute value that updates approximately every 30s.
- Tracker screen can subtract `walkMinutes` from `minutesToStop` to derive the "Leave in X" countdown.
