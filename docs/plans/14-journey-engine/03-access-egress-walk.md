# 14-Journey-Engine / 03 — Access, egress, walk-only and mode filters

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.1 access and egress: up to 25 stops within 1,000 m of each end. Walk time is `haversine × 1.25 / walkSpeed`. A walk-only option is offered under 2 km. Spec §4.4 `PlanQuery`: `walkMetersPerMin`, `maxWalkMeters` (default 1000), `modes` (default: all included feeds) and `Place { kind: 'here' | 'place' | 'stop' | 'station'; …; ref? }`.
- 12/03 step 10 exports `stopsNear(net, lat, lon, radiusM): number[]`. It scans the `grid` (`cellDeg = 0.005`, key `gridKey`) and filters with `haversineMeters` (`packages/shared/src/utils/outlier.ts:6`).
- 12/04's `walkSeconds` adds the 60 s "find the stop" constant for transfers. Access and egress have no such constant in the spec, so this task has its own formula. Do not reuse `walkSeconds`.
- Feed exclusion: 12/03 step 1 skips feeds with `meta.included === false` entirely, so their stops and patterns are not in the network. `net.meta.feeds[f].included` still records the exclusion. Spec §3.6 wants a one-line note ("Showing bus-only routes"). Spec §4.4 carries it in `PlanResult.excludedFeeds`, not in itinerary warnings, so the banner shows even when nothing is returned.
- Indices: `stops.feed` is a `FEED_IDS` index and `routes.mode` a `MODES` index (12/01 step 3). `stops.station` indexes `net.stations`, whose `id` is a slug such as `'klcc'` (`packages/shared/src/data/rail-stations.ts:86`).
- 12/03 builds `idToIndex` but does not store it. Snapping a `Place.ref` needs a lookup.

## Goal
Turn `PlanQuery.from` / `to` into `StopTime[]` access and egress lists, build the per-query pattern mask from `modes`, add the walk-only candidate, and list the excluded feeds.

## Prerequisites
- Task 02 (`StopTime`, `Candidate`, `rankCandidates`).

## Steps

1. **Walk maths** in `packages/shared/src/transit/walk.ts`:
   ```ts
   export const DETOUR = 1.25;
   export const WALK_ONLY_MAX_METERS = 2000;
   export function walkedMeters(a: LatLng, b: LatLng): number;       // haversineMeters(a, b) × DETOUR
   export function accessWalkSeconds(walkedM: number, metersPerMin: number): number; // Math.ceil(walkedM / (metersPerMin / 60))
   ```
   - `metersPerMin` falls back to `WALKING_METERS_PER_MINUTE` (`packages/shared/src/utils/rail.ts:53`) when it is not a finite number > 0.

2. **Id lookups** in `packages/shared/src/transit/lookup.ts`. Build them lazily and cache them in a `WeakMap<TransitNetwork, …>`:
   ```ts
   export function stopIndexById(net: TransitNetwork, id: string): number;       // -1 if absent
   export function stationIndexById(net: TransitNetwork, id: string): number;    // by RailStation.id slug
   export function stationMembers(net: TransitNetwork, station: number): number[]; // stops whose stops.station === station
   ```

3. **Pattern mask and excluded feeds** in `packages/shared/src/transit/modes.ts`:
   ```ts
   export function patternMask(net: TransitNetwork, modes?: readonly Mode[]): Uint8Array; // 1 = allowed
   export function excludedFeeds(net: TransitNetwork): FeedId[];   // FEED_IDS order
   ```
   - `patternMask`: allowed when `MODES[routes.mode[patterns.route[p]]]` is in `modes`, or when `modes` is undefined. Cache the all-modes mask per network.
   - `excludedFeeds`: every `FeedId` with `net.meta.feeds[f].included === false`, in `FEED_IDS` order. This covers rail and KTM alike. It does not depend on `modes`; phase 15 decides which banner to show.

4. **Access / egress** in `packages/shared/src/transit/access.ts`:
   ```ts
   export interface AccessOptions { walkMetersPerMin: number; maxWalkMeters?: number /* 1000 */; maxStops?: number /* 25 */; allowed: Uint8Array }
   export function accessStops(net: TransitNetwork, place: Place, o: AccessOptions): StopTime[];
   ```
   1. **Snapping** (the place *is* a stop or station). For `kind === 'stop'` with `ref`, look up `stopIndexById(net, ref)`. For `kind === 'station'` with `ref`, take `stationMembers(stationIndexById(net, ref))`. Each hit becomes `{ stop, seconds: 0, meters: 0 }`. A missing ref (stale network) falls through to step 2 with no error.
   2. **Grid:** `stopsNear(net, place.lat, place.lng, maxWalkMeters)` → compute `haversineMeters` → sort ascending (tie: stop index).
   3. **Coverage pruning** while filling up to `maxStops`:
      - Skip stops already added by snapping.
      - Skip stops that serve no allowed pattern (`stopRoutes` entries all masked out).
      - Skip a stop when **every** allowed pattern it serves is already served by a closer chosen stop.
      - This keeps 25 slots from filling with one bus corridor's stops before the rail station at 900 m. It stays within the spec's 25-stop, 1,000 m bound.
   4. Each chosen stop: `meters = round(walkedMeters(place, stop))`, `seconds = accessWalkSeconds(meters, walkMetersPerMin)`.
   - Egress uses the same function with `to`. RAPTOR treats egress seconds as a cost added after the last label.
   - The radius check uses straight-line metres (`≤ maxWalkMeters`); `meters` is the walked estimate (× 1.25). The property test in 06 relies on this split.

5. **Walk-only candidate** in `walk.ts`:
   ```ts
   export function walkOnlyCandidate(from: Place, to: Place, t0: number, metersPerMin: number): Candidate | null;
   ```
   - `meters = walkedMeters(from, to)`. Return `null` when `meters ≥ WALK_ONLY_MAX_METERS` (spec: "under 2 km"; measured on the walked estimate, like the leg it produces).
   - Otherwise: `{ raw: null, leave: t0, arrive: t0 + accessWalkSeconds(meters, …), rides: 0, walkSec, walkMeters: meters, firstWaitSec: 0, signature: 'walk' }`.

6. **Same place, both ends:** when `from` and `to` snap to overlapping stops, or are under 50 m apart, return only the walk-only candidate. Plan code (04) short-circuits on this.

7. **Tests** in `packages/shared/src/transit/__tests__/access.test.ts`:
   - `accessWalkSeconds(800, 80) === Math.ceil(800 / (80 / 60))`, and `walkedMeters` is haversine × 1.25.
   - `grid access returns ≤ 25 stops within 1000 m, nearest first` (fixture, around Pasar Seni `3.142366, 101.695437`).
   - `coverage pruning keeps a rail station that 25 bus stops would crowd out` (tiny network: 30 bus stops on one pattern, one rail stop at 900 m).
   - `stop place snaps to its ref with 0 s and still adds nearby stops` (`ref: '12000759'`).
   - `station place snaps to all member stops` (`ref: 'kl-sentral'` → `rail:KJ15`, `rail:MR1`).
   - `unknown ref falls back to coordinates`.
   - `modes filter masks patterns`: `['bus', 'feeder']` excludes every rail pattern.
   - `rail excluded → excludedFeeds returns ['rail'] and no rail: stops are reachable` (`fixtureNetwork({ exclude: ['rail'] })`); `all feeds included → []`.
   - `walk-only offered at 300 m, not at 2.1 km`.
   - `walk speed scales access seconds` (60 vs 80 m/min).

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts`: the bench now uses `accessStops`. Log the access and egress counts per query; each should be ≤ 25.

## Handoff to next step ([04-itinerary-reconstruction.md](./04-itinerary-reconstruction.md))
- `accessStops`, `patternMask`, `excludedFeeds`, `walkOnlyCandidate`, `accessWalkSeconds`, `walkedMeters`, `stopIndexById`, `stationIndexById` and `stationMembers` are exported from `packages/shared/src/transit/index.ts`.
- Access and egress `StopTime`s carry `meters`, so 04 can fill `Leg.meters` without recomputing.
- `excludedFeeds` is computed once per query and returned as `PlanResult.excludedFeeds` by `plan()` (04).
