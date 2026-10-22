# 14-Journey-Engine / 00 — Prototype: smallest RAPTOR and a timing harness

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.4 sets the budget: one `plan()` call must take under 400 ms of JS time on an iPhone 13 in Hermes. If it does not, the escalation order is a 20-min window, then a `react-native-worklets` runtime, then `apps/api`. Nothing has been measured yet.
- Phase 12 provides the inputs:
  - fixture zips in `packages/shared/src/transit/__fixtures__/2026-10-23/` (12/00 step 1);
  - `readFeed` (12/02), `compileNetworkSync` and `stopsNear(net, lat, lon, radiusM)` (12/03 steps 1 and 10);
  - FIFO-split patterns, so a binary search on `dep` is valid (12/03 step 8).
- Trip times are flat arrays indexed `arr[timeStart[p] + t * stopLen[p] + s]` (spec §3.3). 12/03 step 9 exposes the only accessor, `ev(net, p, t, s)`, and tests that patterns never overlap. Every engine read goes through `ev()`.
- Existing helpers this prototype reuses:
  - `haversineMeters` (`packages/shared/src/utils/outlier.ts:6`);
  - `toMalaysiaParts` and `MY_TZ_OFFSET_MIN` (`packages/shared/src/utils/gtfs-time.ts:44`, `:3`);
  - `WALKING_METERS_PER_MINUTE = 80` (`packages/shared/src/utils/rail.ts:53`).
- Worklets: `apps/mobile/package.json` pins `react-native-worklets` 0.13.0. It exports `createWorkletRuntime` and `runOnRuntimeAsync` (`node_modules/react-native-worklets/lib/typescript/runtimes.native.d.ts:16`, `:132`).
- The 12/00 device harness uses the same gate as this one: `__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1'`, reached from a row in the About section of `apps/mobile/app/settings.tsx:163`. The Expo dev menu does not exist in Release builds, so a dev-menu entry cannot measure the Release target.
- Playbook: **Prototype** (poteto-mode). Produce numbers and a decision. The prototype engine becomes the starting point for 01. The device screen is throwaway and is deleted in 06.

## Goal
Measure an earliest-arrival range RAPTOR on the real fixture network, in Node and on an iPhone in Hermes. Then record whether `plan()` runs on the JS thread, on a worklet runtime, or on the `apps/api` fallback.

## Prerequisites
- Phase 12 tasks 00–04: fixtures, `readFeed`, `compileNetworkSync` with transfers, and `stopsNear`.
- Phase 12 task 06 for the device part: `useTransitNetwork()` gives a built network on the phone.
- A physical iPhone 13 (or the oldest supported device) with a **Release** dev build.

## Steps

1. **Prototype engine** in `packages/shared/src/transit/raptor.ts`, the file 01 grows:
   ```ts
   export const INF = 0x3fffffff;                       // safe for + seconds; fits Int32
   export interface StopTime { stop: number; seconds: number; meters: number }
   export function raptorProto(net: TransitNetwork, access: readonly StopTime[], egress: readonly StopTime[],
     t0: number, opts?: { windowSec?: number; stepSec?: number; maxRides?: number }): { arrive: number; rounds: number; runs: number };
   ```
   - Arrays: `tau` = `maxRides + 1` `Int32Array(stops.count)` filled with `INF`, plus `tauStar`, a marked-stop `Uint8Array`, and a route queue `Int32Array(patterns.count)` filled with `-1`.
   - **Timetable boarding:** binary search on `dep[ev(net, p, t, s)]` over `t ∈ [0, tripLen[p])`.
   - **Frequency boarding** (spec §4.1): for each window `w`, `r = runOffset[stopStart[p] + s]`, `start = max(tReady − r, fStart[w]) + (fHeadway[w] >> 1)`, valid while `start ≤ fEnd[w]`; `board = start + r`. Take the minimum `board` over the windows.
   - Footpaths: one relaxation from the stops a round improved, using `net.transfers` as stored.
   - Range: departures from `t0 + windowSec` down to `t0` in steps of `stepSec` (defaults 2400 and 120). Labels are kept between runs, which is the rRAPTOR reuse.
   - No journey pointers, ranking or reconstruction yet. Return the best egress arrival.
   - Export it from `packages/shared/src/transit/index.ts`.

2. **Smoke test** `packages/shared/src/transit/__tests__/raptor-proto.test.ts`:
   - `raptorProto finds an arrival from Hotel Lisa De Inn to KLCC on the fixture network`. Origin is stop `12000759` (feeder `stops.txt`: `12000759,PJ210,HOTEL LISA DE INN,3.118231,101.63065`). Destination is the member stops of station `klcc` (`rail:KJ10`, `packages/shared/src/data/rail-stations.ts:86`). Depart 2026-10-28 08:00 MYT. Expect `arrive < INF`.
   - Add the shared fixture loader `packages/shared/src/transit/__tests__/helpers/fixture-network.ts`:
     ```ts
     export function fixtureNetwork(opts?: { serviceDate?: string; exclude?: readonly FeedId[] }): TransitNetwork;
     ```
     It reads the four zips with `readFeed`, sets `meta.included = false` for `exclude`, compiles with `compileNetworkSync(feeds, serviceDate ?? '20261028')` and memoises by key. Tasks 01–06 reuse it.

3. **Node benchmark** `packages/shared/scripts/bench-raptor.ts`:
   - Compile the fixtures once and print the compile time.
   - Define the five golden queries from 06 inline (origin and destination lat/lng + depart time; access and egress via `stopsNear(…, 1000)` capped at 25 by distance).
   - For each query: 3 warm-up runs, then 20 timed runs with `performance.now()`. Print p50, p95 and max.
   - Print `process.memoryUsage().heapUsed` before and after, plus the bytes in the engine's typed arrays.
   - Flags: `--window 2400|1200`, `--step 120`, `--rides 4`. Run the default and `--window 1200` (escalation step 1).
   - Run it: `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts`.

4. **Device harness** `apps/mobile/app/dev-planner.tsx` (throwaway):
   - Render `null` unless `__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1'`. Reach it from a second temporary About row in `settings.tsx`, next to 12/00's row, behind the same flag, and by deep link `t816://dev-planner` (scheme `t816`, `apps/mobile/app.json:8`).
   - Take the network from `useTransitNetwork()`. Run the same five queries, with 2 warm-ups and then **20 runs each**:
     - **Sync:** call the prototype directly; record `performance.now()` deltas. This is the JS time.
     - **Sliced:** wrap the prototype in a generator that yields after each round, and drive it with `runSteps(gen, 8)` (`packages/shared/src/utils/steps.ts`, 12/02). Record the total and the longest slice.
     - **Memory:** `HermesInternal?.getInstrumentedStats?.()`, reading `js_heapSize` before and after, plus the Xcode memory gauge.
   - Show p50, p95 and max per query in a monospaced `Text`, with a Copy button.

5. **Worklet probe** (only if step 4's p95 exceeds 400 ms at both window sizes): in the same screen, create `createWorkletRuntime({ name: 'planner' })` once. Then:
   - time `runOnRuntimeAsync` for one query, including the cost of moving the network in;
   - if moving the network fails or costs more than the plan, try passing `encodeNetwork(net)` bytes (12/05) and calling `decodeNetwork` once inside the runtime;
   - record whether typed arrays and the `grid` `Map` survive the move.

6. Fill in **Results** and tick the decision.

## Verification
- `pnpm --filter @bus-tracker/shared test`: the smoke test passes.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts` prints five rows with p50/p95. Spec §4.4 expects a Node p95 under 60 ms per query for the 40-min window; note any miss.
- `pnpm type-check` passes (the script sits outside `tsconfig` `include`; the harness compiles inside `apps/mobile`).
- Manual: a Release build (`npx expo run:ios --configuration Release --device`, with `EXPO_PUBLIC_DEV_TOOLS=1`) opens `t816://dev-planner`, and the numbers are pasted below with device and iOS version.

## Results
| Measure | Q1 Lisa→KLCC | Q2 PJ14→KL Sentral | Q3 SJ→Bukit Bintang | Q4 300 m walk | Q5 rail expired |
|---|---:|---:|---:|---:|---:|
| Node p50 / p95 (ms), 40-min window | | | | | |
| Node p50 / p95 (ms), 20-min window | | | | | |
| Hermes sync p50 / p95 (ms), 40-min | | | | | |
| Hermes sync p50 / p95 (ms), 20-min | | | | | |
| Hermes sliced total / longest slice (ms) | | | | | |
| Worklet p95 incl. transfer (ms) | | | | | |

- Device / iOS / build config: ___
- Node compile of fixtures: ___ ms. Engine typed arrays: ___ MB.
- Hermes heap before / after one query: ___ / ___ MB. Xcode gauge peak delta: ___ MB.
- **Decision:** `[ ] JS thread, 40-min window` / `[ ] JS thread, 20-min window` / `[ ] worklet runtime (react-native-worklets 0.13 createWorkletRuntime)` / `[ ] apps/api fallback`. Reason: ___

**Decision rule** (spec §4.4):
1. If the Hermes sync p95 is under 400 ms on every query with the 40-min window → JS thread, yielding between rounds. Done.
2. Else, if it is under 400 ms with the 20-min window → JS thread with `windowSec = 1200`. Record it as the default in 02.
3. Else, if the worklet p95 (network already resident) is under 400 ms and the one-off transfer is under 1 s → worklet runtime. 15/04's `usePlanner` owns the runtime; the shared engine does not change.
4. Else → `apps/api` fallback: an endpoint that runs the same `plan()` from `@bus-tracker/shared` on the server's copy of the network. File a follow-up; v1 still ships the 20-min JS path.

## Handoff to next step ([01-raptor-core.md](./01-raptor-core.md))
- `raptor.ts` holds `raptorProto`, `INF` and `StopTime` (it reads times only through 12/03's `ev()`). Task 01 replaces `raptorProto` with the full round engine and keeps the boarding code.
- `fixtureNetwork()` in `__tests__/helpers/fixture-network.ts` is the shared fixture loader for 01–06.
- The decision above fixes the default window (2400 or 1200 s) and where `plan()` runs. 15/04 reads it.
