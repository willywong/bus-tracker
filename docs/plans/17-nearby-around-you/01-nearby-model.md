# 17-Nearby-Around-You / 01 — Nearby Model

**Build impact:** JS-only (pure TypeScript, no UI).

## Context
- **From phase 16:**
  - Nearby is today's trip body (`components/sheet/NearbySection.tsx`) under the Plan · Nearby · Saved picker;
  - `components/sheet/` holds pure models next to views (`planModel.ts`, `savedModel.ts`), tested under `components/sheet/__tests__/`.
- **The network** (`TransitNetwork`, `packages/shared/src/transit/network.ts`):
  - stops (`id`, `name`, `lat`, `lon`, `feed`, `station`), stations, routes (`label`, `mode`, `color`, `textColor`, `feed`), patterns (stop sequences plus timetables) and `stopRoutes`.
  - Stop ids are namespaced (`kl:1005840`, `rail:KJ15`, `ktm:19100`); feeder ids are raw.
- **Helpers in `@bus-tracker/shared`:**
  - `stopsNear(net, lat, lon, radiusM)` → stop indexes (grid lookup);
  - `stopDepartures(net, stopIndex, now)` → `BoardRow[]`, one per route and direction: `{ route, pattern, dir, towards, next, first, last }`;
  - `stationBoard(net, stationIndex, now)`;
  - `feedOfStopId`, `FEED_INFO[feed].idPrefix`, `walkingMinutes(m)`, `haversineMeters`.
- **Precedent:** `components/rail/stationModel.ts`.
  - `nearbyOf()` groups a stop's rows by route and picks the soonest.
  - `busNext()` gives "next 09:14", "every 10 mins", "first 06:00" or "No more buses today".
  - Reuse these, and export them if they're private, rather than re-deriving the wording.

## Goal
Pure functions turn the network, your position and the time into everything Nearby shows: the places around you, a stop's routes, and a route preview. They are fully tested without React Native.

## Prerequisites
- Phase 16 merged.
- This task writes only `components/sheet/nearby/model.ts`, `components/sheet/nearby/__tests__/model.test.ts`, and the exports it needs from `stationModel.ts`. Moving functions there must not change behaviour, and its tests must stay green.

## Data shape
The types are as in the README (`NearbyPlace`, `StopRouteRow`, `RoutePreview`), plus:
```ts
export const STOP_RADIUS_M = 600;
export const STATION_RADIUS_M = 1500;
export const MAX_PLACES = 8;
export const MERGE_SAME_NAME_M = 80;

export function aroundYou(net: TransitNetwork, here: LatLng, now: number,
  o: { clock: (ms: number) => string; yourStopId: string | null; yourRouteCode: string | null }): NearbyPlace[];
export function stopRoutes(net: TransitNetwork, stopIndexes: readonly number[], now: number,
  o: { clock: (ms: number) => string; liveRoutes?: ReadonlySet<string> }): StopRouteRow[];
export function routePreview(net: TransitNetwork, pattern: number, fromStopIndex: number, now: number,
  o: { clock: (ms: number) => string; roadShape?: readonly LatLng[] }): RoutePreview | null;
export function gtfsStopId(networkStopId: string): string;   // 'kl:1005840' → '1005840'; feeder raw stays
export function placeKey(p: NearbyPlace): string;            // 'station:<id>' | 'stop:<first stop id>'
```

## Steps
1. **`aroundYou`.**
   - Take `stopsNear` at `STATION_RADIUS_M`.
   - Split the stops: rail and KTM stops with `station >= 0` become one `station` place per station, at the station's own lat and lng, within 1.5 km. Bus-kl and feeder stops within 600 m become `stop` places.
   - Merge stops with the same formatted name within `MERGE_SAME_NAME_M`: union their routes and keep the nearest distance.
   - Drop stops whose `stopDepartures` is empty (nothing to board).
   - Sort by distance, then name. Cap at `MAX_PLACES`.
   - **`next`:**
     - stations: their board's soonest row ("every 4 min", "~3 min");
     - stops: the soonest across routes, worded as `busNext`;
     - `isYourStop` when any merged stop id matches `yourStopId`.
   - **`spoken`:** "Jalan 17/21C, bus stop, 240 metres, routes PJ02 and 780, next in 6 minutes", or "Taman Jaya, Kelana Jaya line station, 650 metres, trains every 4 minutes".
2. **`stopRoutes`.**
   - One row per `BoardRow` across the merged stops, sorted by soonest, then label.
   - `then`: the next two scheduled times, from the pattern timetable at that stop.
   - `ended`: no more today. Its caption is "Last bus left 6:40", from `last`.
   - `live`: `liveRoutes?.has(label)`. The caller decides what counts as live (05).
3. **`routePreview`.**
   - Take the stops of `pattern` from `fromStopIndex` to the end, with the next trip's scheduled time at each stop.
   - `yours`: the first stop.
   - `path`: `roadShape` sliced between the first and last stops, if given and the slice passes `itineraryGeometry`'s off-shape and detour checks. Otherwise stop to stop. Import those rules rather than copying them; export a small `slicePath` from `itineraryGeometry.ts` if needed.
   - Returns null when `fromStopIndex` is not on `pattern`.
4. **`gtfsStopId`.** Strip the feed prefix that `feedOfStopId` identifies. Test bus-kl, feeder (raw) and an unknown prefix (unchanged).
5. **Tests** (`components/sheet/nearby/__tests__/model.test.ts`), using a small hand-built network:
   - `aroundYou orders by distance and caps at 8`
   - `stations within 1.5 km, stops only within 600 m`
   - `same-name stops across the road merge`
   - `stop with no departures is dropped`
   - `your stop is captioned`
   - `stopRoutes sorts by soonest and marks ended`
   - `routePreview starts at your stop and falls back to stop-to-stop`
   - `gtfsStopId strips kl: and keeps feeder raw`

## Verification
- `npx tsc --noEmit -p .` and `pnpm test` are green, and `stationModel` tests are unchanged.
- **One real-data check:** a throwaway `tsx` script, not committed, loads the network blob from the Simulator's app container and prints `aroundYou` at Hotel Lisa De Inn (its lat and lng from the network's stops). Paste the output into this file's "Implementation notes".

## Handoff to next step
- `components/sheet/nearby/model.ts` exports `aroundYou`, `stopRoutes`, `routePreview`, `gtfsStopId`, `placeKey` and the constants, all tested.
- **02** renders `aroundYou`; **03** renders `stopRoutes`; **04** and **05** render `routePreview`.

## Implementation notes (2026-10-23)

- **Station radius is 2 km, not 1.5 km** (`STATION_RADIUS_M`). Around Hotel Lisa De Inn the nearest stations are Taman Paramount (1717 m), Asia Jaya (1733 m) and Phileo Damansara (1842 m), so 1.5 km listed none. The list also keeps at least `MIN_STATIONS = 2` stations: when stops fill all 8 places, the farthest stops give way to the nearest missing stations, which then sit at the end. The README's Around you decision is updated to match.
- **Stop codes in names** (`placeName`). Rapid KL names carry a code ("PJ210 Hotel Lisa De Inn") and feeder names may start "(m)", so the same kerb had two names and never merged. `placeName` runs `formatStopName`, then drops a leading "(m)" and a 1–3 letter, 2–5 digit code. A name that is only a code is kept.
- **Merging** groups same-name stops within `MERGE_SAME_NAME_M = 80` m. At KL Sentral, the two "KL Sentral" stops 115 m and 222 m away stay separate, as they are on different streets. The two "KL Sentral" stations (rail and KTM) stay separate too, told apart by their line chips.
- **Tests** run on the real fixture feeds (`fixtureNetwork()`, compiled for 2026-10-28) for `aroundYou` and `stopRoutes`, and on a hand-built network (`buildNetwork`) for `routePreview`, including a headway-only rail line and a road shape.
- **Real-data check** (a throwaway `tsx` script on the fixture network, deleted), at Hotel Lisa De Inn, 07:30:
  - 6 stops, then Taman Paramount ("about 2 min") and Asia Jaya ("about 3 min"); about 5 ms per call.
  - The first place merges two stops (Rapid KL and feeder) with PJ01, PJ02, T786, T787, T790 and T816, captioned "Your stop".
  - `stopRoutes` there: T816 to MRT Phileo Damansara Pintu A at 7:32, T787 and T786 to LRT Asia Jaya at 7:36, then PJ01, T790 and PJ02.
  - `routePreview` for T816 from that stop: 21 stops, next at 7:36, first at 6:06.

## Correction (2026-10-23, found validating 03–05)

`gtfsStopId` is gone. It stripped `kl:`, but the static database, `trip.stopId` and `setPreferredStopForRoute` all keep the network's ids (`kl:1000944`, feeder `12000759`). Tracking T790 saved "1001247", and the trip view showed "No buses scheduled". Bus stop ids now compare and save as they are. The "a Rapid KL tracked stop is captioned" test covers it.
