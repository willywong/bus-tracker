# 17-Nearby-Around-You / 03 — Stop View

**Build impact:** JS-only (Metro reload).

## Context
- **From 02:**
  - `NearbyContext` (`push`, `pop`, `places`, `here`) and the `place` sheet mode render `components/sheet/nearby/StopView.tsx`, currently a stub `({ view, scheme })` with a back header.
  - The sheet shows "Where to?" above it, and no picker.
  - Push and pop crossfade and reset the scroll.
- **From 01:** `stopRoutes(net, stopIndexes, now, { clock, liveRoutes })` gives `StopRouteRow[]`; `placeKey(place)` is the key in `view.key`.
- **Existing pieces to reuse:**
  - `RouteBadge` (`components/trip/SheetHeader.tsx`, which grows with Dynamic Type since 16/06);
  - `Hairline` and `SectionLabel` (`components/trip/Rows.tsx`);
  - `openWalkingDirections` (`components/sheet/nearby/TripView.tsx`, moved in 02; export it);
  - `formatClockHHMM` with the user's clock format.
- **Design:** board "Then · tap a bus stop".

## Goal
A stop lists every route and direction boarding there, soonest first, with the next time and two more. A route row opens its preview. Walking directions are one tap away.

## Prerequisites
- 02 merged.
- Invoke `expo:expo-ui` and `apple-design`.
- This task writes only `components/sheet/nearby/StopView.tsx` and an optional `components/sheet/nearby/StopRouteRowView.tsx`. It does not edit `app/trip.tsx` or the context.

## Steps
1. **Resolve the place.**
   - Find `places.find((p) => placeKey(p) === view.key)`.
   - If it's missing (you moved and the list recomputed), keep the last resolved place in a ref, so the open view never empties under you.
   - If there was never one, show `EmptyState compact` ("Stop not found") with a back button.
2. **Header.** The back button (44 pt, "Back to Nearby"), the stop name (`type.title3`), and "Bus stop · 240 m · 3 min walk", using the distance from `here`.
3. **Rows.**
   - Compute `stopRoutes(net, place.stopIndexes, now, …)` on a 30 s clock.
   - Each row: `RouteBadge`; "to Pasar Seni" with "then 7:58 · 8:13" under it; the next time on the right (a live dot and "6 min" when live, else the clock time); and a chevron.
   - `ended` rows sort last and read "No more today", with "Last bus left 6:40".
   - **Live:** pass `liveRoutes` = your tracked route's label when `trip.bus.positions` is non-empty and this stop is on its route; otherwise none. Live for other routes arrives only in their preview (05).
   - Tapping a row calls `push({ kind: 'route', route, pattern, fromStopIndex: row.stopIndex })`.
4. **Walking directions** as a `LinkRow` under the list, opening Apple Maps walking to the stop, as the trip view does.
5. **Accessibility.**
   - Each row is one element: "Route 780 to Pasar Seni, in 6 minutes, live. Then 7:58 and 8:13", with the hint "Shows the route on the map".
   - The header name is `accessibilityRole="header"`.

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green.
- **Simulator** (location at the tracked stop):
  - Open a nearby feeder stop from the list. Each route and direction shows, soonest first. A route that ended today reads "No more today" at the bottom.
  - Open your own stop: your route shows live when the bus feed has it.
  - Walking directions open Maps.
  - Back returns to the list, scrolled to the top.
  - Dark mode and AX3: rows grow, badges stay whole.

## Handoff to next step
- `StopView` is complete. Route rows push `route` views that **04** renders in the sheet and **05** draws on the map.

## Implementation notes (2026-10-23)

Built by a subagent alongside 04 and 05, then validated on the Simulator. JS-only.

- **`whenSpoken`.** `StopRouteRow` carries the spoken "when" (`next at 8:16 AM, scheduled`, `no more today`). The row builds its VoiceOver sentence from it, rather than parsing `spoken`.
- **Your stop** compares `net.stops.id[s]` with `trip.stopId` directly (see 01's correction).
- **Row keys** are `route|pattern|stopIndex`. Two directions with the same display name can't collide.
- **Heading row** ("Routes · Soonest first") wraps at large type.
- **Verified:** Sin Chew Daily lists T787 and T790, soonest first, with "then …" times and walking directions (1 min). The selected stop shows as a solid square at the end of a dotted walk line. Back returns to the list, scrolled to the top. Checked in light, dark and AX3.
- **Known:** at AX3 the shared `DetailHeader` clips a long stop name to one line ("Sin Chew D"). It's shared with the trip and station sheets; recorded as a follow-up.
