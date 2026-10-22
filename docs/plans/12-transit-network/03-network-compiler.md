# 12-Transit-Network / 03 — Network compiler

**Build impact:** JS-only (Metro reload)

## Context
- Spec §3.3 fixes the output shape (`TransitNetwork`, now in `packages/shared/src/transit/network.ts` from task 01). Spec §3.5 says the compile is a generator that yields about every 16 ms.
- Inputs are task 02's `NormalisedFeed`s. Times are seconds after service-day midnight via `gtfsTimeToSeconds` (`packages/shared/src/utils/gtfs-time.ts:12`), and they can exceed 86,400.
- Headway templates:
  - `expandFrequencies` (`packages/shared/src/utils/t816-bundle.ts:203`) expands windows inclusively (`start ≤ t ≤ end`, `:247`).
  - It names instances with `frequencyInstanceId` (`:159`), which spec §3.3 reuses as `tripKey`.
  - bus-kl has `exact_times=0` and headways of 300–12,600 s. Rail headways are 180–840 s.
- Headway rule (spec §3.3, decided): **every rail window, whatever its headway, and every bus window ≤ 720 s** is turn-up-and-go. Only bus windows > 720 s expand to concrete trips.
- Active services: the SQL semantics in `getActiveServiceIdsForDate` (`apps/mobile/db/queries.ts:274`) match the calendar's day of week and date range, then apply `calendar_dates` (2 removes, 1 adds). Only the feeder and KTMB have `calendar_dates`.
- Stations: `RAIL_STATIONS` (`packages/shared/src/data/rail-stations.ts:20`) holds **raw** rail stop ids (`"KJ15"`). Network ids are `rail:KJ15`.
- Slicing: `runSteps` (task 02, `packages/shared/src/utils/steps.ts`) pauses for a macrotask once a slice passes `sliceMs`. A generator must therefore yield often enough that no single step overruns.

## Goal
`compileNetwork(feeds, serviceDate)` builds one service day's `TransitNetwork`. It produces patterns, timetabled trips, turn-up-and-go windows, `stopRoutes`, stations and a grid, as a generator with bounded work between yields. Transfers stay empty until task 04.

## Prerequisites
- Tasks 01 and 02.

## Steps

1. **Signatures** in `packages/shared/src/transit/compile.ts`:
   ```ts
   export interface FeedMeta { fetchedAt: number; hash: string; validUntil: string; included: boolean }
   export type CompileFeeds = Partial<Record<FeedId, { data: NormalisedFeed; meta: FeedMeta }>>;
   export interface CompileOptions { builtAt?: number; busHeadwayCutoffSec?: number /* 720; never applied to rail */; yieldEvery?: number /* 2048 */ }
   export function compileNetwork(feeds: CompileFeeds, serviceDate: string, opts?: CompileOptions): Generator<void, TransitNetwork, void>;
   export function compileNetworkSync(feeds: CompileFeeds, serviceDate: string, opts?: CompileOptions): TransitNetwork; // drains; tests/scripts
   export function activeServiceIds(cal: readonly GtfsCalendar[], dates: readonly GtfsCalendarDate[], ymd: string): Set<string>;
   export const BUS_HEADWAY_CUTOFF_SEC = 720;
   export function isTurnUpAndGo(feed: FeedId, headwaySec: number, cutoff = BUS_HEADWAY_CUTOFF_SEC): boolean; // feed === 'rail' || headwaySec <= cutoff
   export const GRID_CELL_DEG = 0.005;
   ```
   - **Feed inclusion:** feeds with `meta.included === false` are skipped entirely. Task 07 decides `included`.
   - **Feed order:** process feeds in `FEED_IDS` order so the indices are deterministic. Task 05's byte-identical round-trip depends on this.

2. **Yield contract:** keep a counter `work`; after each unit (one CSV row, one trip, one stop event or one grid insert), run `if (++work % yieldEvery === 0) yield;`.
   - The default is 2,048 units. It is sized so one step stays well under 16 ms on Hermes (task 00 measured the step cost; adjust the default from its Results).
   - The driver (`runSteps(gen, 8)`) does the clock checks. The generator never reads the clock.

3. **Active services:** `activeServiceIds` is the pure port of `queries.ts:274`.
   - Get the day of week from `new Date(Date.UTC(y, m-1, d)).getUTCDay()`.
   - Keep services whose day-of-week flag is set and where `start_date ≤ ymd ≤ end_date`, compared as strings.
   - Then apply `calendar_dates` for that `ymd`.

4. **Stops:**
   - Give every stop in an included feed an index, in feed order and then file order.
   - Fill `id`, `name` (from `stopNames`), `lat`, `lon` (`Float32Array`) and `feed` (the `FEED_IDS` index).
   - Build `idToIndex: Map<string, number>` for the rest of the compile. It is not stored.

5. **Stations:**
   - Start from `RAIL_STATIONS`, with each `stopIds` mapped through `namespaceFeedId('rail', …)`.
   - Then add one `RailStation` per KTM stop:
     - `id: 'ktm-' + slug`, the name from `stopNames`, and `stopIds: [ktmId]`;
     - `lines`: one `RailLine` per KTM route serving the stop, with `mode: 'KTM'`, `code: 'KTM'` and colours from `routeMeta`.
   - Set `stops.station[i]` to the station index, or `-1`.
   - Rail stops missing from `RAIL_STATIONS` (a new station in the feed) get their own single-stop station, with a `console.warn`.

6. **Trip instances**, for each trip whose `service_id` is active:
   1. Sort its stop_times by `stop_sequence` and map the stops to indices. Skip a trip with < 2 stops or with any unparsable time.
   2. Without frequency windows, it is one timetabled instance: `arr[]`/`dep[]` from the times (a missing arrival takes the departure, and the other way round), and `tripKey = trip_id`.
   3. With frequency windows, compute `offset[s] = dep[s] − dep[0]` from the template. Split the windows with `isTurnUpAndGo(feed, headway_secs)`:
      - **Turn-up-and-go** (every rail window; a bus window ≤ 720 s) becomes a **freq window** `{ fStart: start, fEnd: end, fHeadway: headway }` on the trip's pattern. The pattern's `runOffset[stopStart + s] = offset[s]`, taken from the first template seen; later templates on the same pattern must agree within 60 s at every stop, or they start a new pattern.
      - **Longer bus windows** (> 720 s) go through `expandFrequencies([trip], sts, longWindows)`, and each resulting trip is a timetabled instance (`tripKey` is `<template>@HH:MM`).
   - Rail windows therefore never expand. A rail trip with no windows at all would still be timetabled; none exist in the 2026-10-23 fixture. A bus template can yield both kinds. KTM and the feeder have no `frequencies.txt` and are always timetabled.

7. **Patterns:**
   - Key each instance by `route_id + '|' + (direction_id ?? '') + '|' + stopIndices.join(',')`.
   - `headsign` = the first instance's `trip_headsign`, else the last stop's display name.
   - `route` indexes `routes`, which hold one entry per `route_id` used by an included feed. Fill `id`, `label`, `longName`, `mode` (the `MODES` index), `color`, `textColor` and `feed` from `routeMeta`, and `shapeId` from the first trip's `shape_id` (`''` for KTM).

8. **FIFO:**
   - Within a pattern, sort the instances by `dep[0]`.
   - Then assign them greedily to sub-patterns. An instance joins the first sub-pattern whose last instance it does **not** overtake: it needs `dep[s] ≥ last.dep[s]` and `arr[s] ≥ last.arr[s]` for every `s`.
   - Otherwise it opens a new sub-pattern with the same route, stops and headsign. Each sub-pattern becomes its own pattern.
   - This keeps RAPTOR's binary search on `dep` valid (spec §4.1).

9. **Flatten:** `stopStart`/`stopLen`/`stops` hold the stop sequences, and `tripStart`/`tripLen` index the trip rows.
   - Each pattern gets a base offset `timeStart[p]`, the running sum of `tripLen[q] * stopLen[q]` over earlier patterns.
   - For trip `t` of pattern `p` at stop `s`: `arr[timeStart[p] + t * stopLen[p] + s]`, and the same for `dep`.
   - Expose a single accessor `ev(net, p, t, s)` and test that two patterns with different `stopLen` never overlap. A flat `(tripStart + t) * stopLen` index collides.
   - `freqStart`/`freqLen` index the `fStart`/`fEnd`/`fHeadway` windows, sorted by `fStart`.
   - `runOffset` is all zeros for patterns with no windows.
   - Allocate typed arrays once from the counts. Do not grow JS arrays of numbers.

10. **`stopRoutes` and grid:**
    - `stopRoutes` (CSR by stop) lists every `(pattern, pos)` where the stop appears. A loop visiting a stop twice gets two entries.
    - Grid: `cellDeg = 0.005` (about 550 m). The cell key is `latCell * 1_000_000 + lonCell`, with `latCell = Math.floor((lat + 90) / cellDeg)` and `lonCell = Math.floor((lon + 180) / cellDeg)`. `cells` maps the key to an `Int32Array` of stop indices, ascending.
    - Export `gridKey(lat, lon, cellDeg)` and `stopsNear(net, lat, lon, radiusM): number[]`. The helper scans the 3×3 block (more when `radiusM > cellDeg·111 km`) and filters with `haversineMeters` (`packages/shared/src/utils/outlier.ts:6`).
    - Transfers: empty CSR arrays of length `stops.count`. Task 04 fills them.
    - `meta`: `{ version: NETWORK_VERSION, serviceDate, builtAt, feeds }`, where every `FeedId` has an entry and missing feeds get `included: false`.

11. **Tests** in `packages/shared/src/transit/__tests__/compile.test.ts`. Write the synthetic cases first with `fflate` `zipSync` + `readFeed`, following the `makeFixture()` style of `utils/__tests__/gtfs-parser.test.ts:6`:
    - `activeServiceIds honours day-of-week, date range and calendar_dates add/remove`.
    - `trips with identical stop sequences share a pattern; different directions do not`.
    - `trips sort by first departure within a pattern`.
    - `an overtaking express is split into its own pattern (FIFO)`.
    - `bus headway ≤ 720 s becomes a freq window with runOffset from the template`.
    - `bus headway > 720 s expands to concrete trips keyed <template>@HH:MM`.
    - `an 840 s rail window stays a freq window (no expanded trips)`: a synthetic rail feed (read as `'rail'`) with one 840 s window; assert `freqLen = 1`, `tripLen = 0`.
    - `isTurnUpAndGo: rail at any headway, bus only ≤ 720 s`.
    - `a template with both short and long windows yields both kinds on one pattern`.
    - `times past 24:00:00 are kept above 86400`.
    - `excluded feeds contribute nothing`.
    - `generator yields at least stopEvents / yieldEvery times`.
    - `stopsNear finds stops across a cell boundary`.
    - Fixture test `compiles all four fixture feeds for 20261028`. Assert:
      - stops ≈ 6.5k minus the KTM stops cut by task 02;
      - per feed, patterns within ±5% of rail 16, bus-kl 171 and feeder 92, allowing for FIFO splits (log them);
      - *trip-equivalents* (timetabled trips + Σ windows `floor((fEnd − fStart)/headway) + 1`) within ±5% of 12.3k minus the KTM trips cut;
      - every `arr ≤ dep` and every stop sequence non-decreasing.
      Also assert that no rail `tripKey` contains `@`, so no rail window was expanded, and that the rail windows include the 721–840 s ones counted in task 00.
    - Fixture test `compile time on node`: log the milliseconds for `compileNetworkSync` (no assertion; informational).

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm -C packages/shared exec tsx scripts/network-sizing.ts packages/shared/src/transit/__fixtures__/2026-10-23 20261028` (task 00) and the fixture test agree on stops, patterns and trip-equivalents within 1%.

## Handoff to next step ([04-transfers-and-interchanges.md](./04-transfers-and-interchanges.md))
- `compileNetwork` / `compileNetworkSync` return a complete `TransitNetwork` except for `transfers`, which is empty CSR.
- `gridKey`, `stopsNear`, `activeServiceIds`, `isTurnUpAndGo`, `BUS_HEADWAY_CUTOFF_SEC` and `GRID_CELL_DEG` are exported from `packages/shared/src/transit/index.ts`.
- Stations include the KTM stops, and `stops.station` is filled. Task 04 uses it for same-station transfers.
