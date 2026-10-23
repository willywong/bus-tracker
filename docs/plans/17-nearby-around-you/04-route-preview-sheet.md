# 17-Nearby-Around-You / 04 — Route Preview Sheet

**Build impact:** JS-only (Metro reload).

## Context
- **From 02:** the `preview` sheet mode renders `components/sheet/nearby/RouteView.tsx`, a stub `({ view, scheme })` where `view = { kind: 'route', route, pattern, fromStopIndex }`. Back calls `pop()`. `reset()` and `push` are on `NearbyContext`.
- **From 01:**
  - `routePreview(net, pattern, fromStopIndex, now, { clock, roadShape })` gives `RoutePreview` (stops onward with times, `nextAt` and `path`);
  - `gtfsStopId(networkId)`.
- **Tracking:**
  - `settings.addFavorite(code, gtfsStopId)` returns `AddFavoriteResult`, failing at `MAX_FAVORITES = 10`;
  - `setPreferredStopForRoute(code, stopId)` and `setPreferredRouteCode(code)`; the code must already be a favourite;
  - `useRouteStatic` (TripContext) then downloads the route's rows for the trip view.
  - Precedent: `app/add-route.tsx` runs the same three calls.
- **Live:** 05 adds the `'preview'` realtime source and puts the previewed route's positions on `NearbyContext.previewPositions` (`VehiclePosition[]`). This file only reads them; until 05 lands the array is empty.
- **Design:** board "Then · tap a route: path on the map".

## Goal
The preview gives the countdown at your stop, two actions (Track this route, Walk there) and the stops from yours onward, so you can decide without leaving Nearby.

## Prerequisites
- 02 merged.
- Invoke `expo:expo-ui`, `apple-design` and `emil-design-eng`.
- This task writes only `components/sheet/nearby/RouteView.tsx` and `components/sheet/nearby/track.ts` (with a test in `components/sheet/__tests__/track.test.ts`).

## Data shape
```ts
// components/sheet/nearby/track.ts (pure)
export type TrackPlan =
  | { kind: 'already'; code: string }                  // already a favourite: switch the stop and the route
  | { kind: 'add'; code: string; stopId: string }
  | { kind: 'full' };                                  // 10 favourites: send to Settings
export function trackPlan(label: string, networkStopId: string, favorites: readonly string[], max: number): TrackPlan;
```

## Steps
1. **`trackPlan`,** with tests:
   - `already a favourite switches stop`
   - `adds with the GTFS stop id`
   - `full at 10 says so`
2. **Header.** Back ("Back to <stop>"), `RouteBadge`, "to Pasar Seni", and "From Jalan 17/21C · 240 m".
3. **Countdown.**
   - The minutes until `nextAt`, in the hero style of `TripView` (thin numerals, "mins"), with "Scheduled · Arrives 7:41".
   - When a `previewPositions` vehicle is heading for your stop, add a live dot and "Live · 2 stops away". Use `nearestStopIds` (`components/trip/OnTheWay.tsx`) over the pattern's stops, upstream of yours only.
   - With no more trips today: "No more today · first 6:05 tomorrow", from the pattern's first departure.
4. **Actions** (a 48 pt row):
   - **Track this route** (filled ink) runs `trackPlan`, then the matching settings calls, `haptics.success()`, `reset()` and `push({ kind: 'trip' })`.
   - **Full:** `Alert` "You're tracking 10 routes. Remove one in Settings to add 780." with Cancel and "Open Settings".
   - **Walk there** (outlined) opens walking directions to your stop.
5. **Stops onward.**
   - Label: "Your stop onwards".
   - A grid of a ring (yours bold), the stop name and the scheduled time.
   - Show the first 4 and the last. "Show all N stops" expands the list in place, with no navigation.
6. **Accessibility.**
   - The countdown reads "Route 780 to Pasar Seni, 6 minutes, arrives 7:41, scheduled".
   - The buttons are real buttons with hints ("Makes this your route at Jalan 17/21C").

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator:**
  - From a stop, open a route you don't track. The countdown, both actions and the stops onward show.
  - **Track this route:**
    - the sheet goes to the trip view for that route and stop;
    - the map's route switcher shows the new code;
    - Saved → Your routes lists it.
  - **With 10 favourites:** the alert shows and Open Settings works.
  - Walk there opens Maps.

## Handoff to next step
- `RouteView` is complete; `trackPlan` is tested.
- **05** draws the same `routePreview(...).path` on the map and fills `previewPositions`.

## Implementation notes (2026-10-23)

Built by a subagent alongside 03 and 05, then validated on the Simulator. JS-only.

- **`trackPlan` saves the network stop id** (`kl:1001247`), not a stripped GTFS id; see 01's correction. `'already'` carries `stopId` too, so tracking a favourite at another stop moves its stop.
- **Verified:**
  - From Sin Chew Daily, T790 → Track this route switches the route menu to T790 and opens the trip view at "PJ274 Sin Chew Daily", with a scheduled countdown and today's times.
  - Walk there opens Maps.
  - The stops onward collapse to "Show all 10 stops".
  - T787 showed "Live · 15 stops away" when the feed had its bus.
- **The two buttons** use `textStyle: 'body'`, so they scale. From the first accessibility size they stack full width; side by side at AX3 they broke mid-word.
- **After midnight** the "first 6:05 tomorrow" line says tomorrow only when the time really is tomorrow.
- **Caveat:** "Live" comes from `upstreamStopsAway` over the route's positions, which aren't filtered by direction. An opposite-direction bus that happens to sit upstream could read as live. It wasn't seen in testing.
