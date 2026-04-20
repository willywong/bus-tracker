# 03-ETA-Engine / 03 — Traffic API Proxy

## Context
- We have a bus position and a target stop; geometry alone doesn't know about traffic.
- HERE API key lives only in `apps/api` (Phase 00 step 07).

## Goal
`GET /api/traffic-eta?origin=lat,lng&destination=lat,lng` proxies HERE Maps Routing v8 with `transportMode=bus`, returns `{ trafficMinutes, source: 'here', generatedAt }`.

## Prerequisites
- HERE API key set in Vercel env.
- Phase 00 step 07.

## Steps
1. Create `apps/api/api/traffic-eta.ts` (Hono route or Vercel function).
2. Validate query params (lat/lng ranges).
3. Call `https://router.hereapi.com/v8/routes?...&apiKey=$HERE_API_KEY&departureTime=now&return=summary`.
4. Return compact JSON. Cache for 15s to absorb bursts.
5. Fall back to HERE if TomTom is selected? (Per Settings; default HERE.) Initial version: HERE only. Add TomTom later.

## Verification
- `curl $API/traffic-eta?origin=3.1,101.6&destination=3.12,101.62` returns a number of minutes.
- Rate-limit: repeated calls within 15s return cached.

## Handoff to next step ([04-dwell-buffer.md](./04-dwell-buffer.md))
- Mobile now has a traffic-aware number of minutes; next step layers on dwell time per intermediate stop.
