# 14-Journey-Engine / 01 — RAPTOR core

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.1: rounds (one per ride, at most 4), scanning marked patterns, pluggable boarding (`earliestBoard(p, s, t)` returning `trip` or `freq`), and footpaths after each round. 12/03 step 8 splits overtaking trips into separate patterns, so trips within a pattern are FIFO at every stop.
- Task 00 left `raptorProto`, `INF` and `StopTime` in `packages/shared/src/transit/raptor.ts`, plus the fixture loader `__tests__/helpers/fixture-network.ts`.
- Transfers come from 12/04 with `TRANSFER_KIND = { walk: 0, station: 1, interchange: 2, interchangeVerified: 3 }` (12/01 step 4). Proximity (`walk`) seconds were baked at 80 m/min plus 60 s (`walkSeconds`, 12/04 step 3).
- Spec §4.1/§4.4: `PlanQuery.walkMetersPerMin` varies per query and defaults to 80. There is no walk-speed setting: `Settings.walkMinutes` (`apps/mobile/hooks/useSettings.ts:32`, default 10 at `:51`) is the walk to your stop, not a pace. The default is `WALKING_METERS_PER_MINUTE` (`packages/shared/src/utils/rail.ts:53`). Proximity transfers compiled at 80 m/min are rescaled to the query's pace (spec §4.1).
- Spec §4.1 sets the same-stop change cost: `CHANGE_SEC = 60`. Trip times are read only through `ev(net, p, t, s)` = `timeStart[p] + t * stopLen[p] + s` (12/03 step 9).

## Goal
A correct, allocation-free earliest-arrival RAPTOR with journey pointers. It runs a given number of rounds from a set of access labels at one departure time, and it can be re-entered for the range query in 02.

## Prerequisites
- Task 00 (prototype, fixture loader, decision on the window).

## Steps

1. **Constants and types** in `packages/shared/src/transit/raptor.ts`:
   ```ts
   export const MAX_RIDES = 4;
   export const CHANGE_SEC = 60;                 // same-stop ride → ride
   export const Lbl = { None: 0, Access: 1, Ride: 2, Walk: 3 } as const;   // not a const enum: tsx/esbuild transpile per file
   export type Boarding = { kind: 'trip'; trip: number } | { kind: 'freq'; window: number; board: number };
   export type RawLeg =
     | { kind: 'access'; stop: number; seconds: number; meters: number }
     | { kind: 'ride'; pattern: number; boardPos: number; alightPos: number; trip: number /* -1 = freq */; window: number /* -1 = trip */; boardTime: number }
     | { kind: 'walk'; from: number; to: number; seconds: number; transferKind: number };
   ```

2. **Workspace** in `packages/shared/src/transit/workspace.ts`, allocated once per network in a `WeakMap<TransitNetwork, Workspace>`. With `n = stops.count`, `K = MAX_RIDES` and index `k * n + s`:
   ```ts
   export interface Workspace {
     n: number; K: number;
     tau: Int32Array;        // (K+1)·n  best arrival with exactly round k (INF)
     arrRide: Int32Array;    // (K+1)·n  ride-phase arrival in round k (footpath source)
     tauStar: Int32Array;    // n        best over all rounds (local pruning)
     lbl: Uint8Array;        // (K+1)·n  Lbl of tau[k][s]
     // ride pointer at (k, s): reached s by riding pattern from fromStop
     rPattern: Int32Array; rBoardPos: Int32Array; rAlightPos: Int32Array;
     rTrip: Int32Array; rWindow: Int32Array; rBoardTime: Int32Array; rFrom: Int32Array;
     // walk pointer at (k, s): walked from wFrom (whose ride pointer is at (k, wFrom))
     wFrom: Int32Array; wSeconds: Int32Array; wKind: Uint8Array;
     // access label at (0, s)
     accSeconds: Int32Array; accMeters: Int32Array;
     marked: Uint8Array; markedList: Int32Array; markedCount: number;
     queuePos: Int32Array; queueList: Int32Array; queueCount: number;   // per pattern, -1 = not queued
     destBest: Int32Array;   // K+1, best egress arrival with ≤ k rides (target pruning)
   }
   export function workspaceFor(net: TransitNetwork): Workspace;
   export function resetWorkspace(ws: Workspace): void;   // fill INF / -1 / 0; called once per plan(), not per range step
   ```
   - About 5 × 6.5k × 15 arrays × 4 B ≈ 2 MB per network, allocated once. Nothing in the hot loop allocates.

3. **Boarding** in `packages/shared/src/transit/boarding.ts`:
   ```ts
   export interface BoardOut { kind: 0 | 1 /* trip | freq */; trip: number; window: number; dep: number }
   export function earliestBoardInto(net: TransitNetwork, p: number, pos: number, t: number, out: BoardOut): boolean;
   export function earliestBoard(net: TransitNetwork, p: number, pos: number, t: number): Boarding | null; // spec shape, tests only
   export function depAt(net: TransitNetwork, p: number, b: BoardOut | RideState, pos: number): number;
   export function arrAt(net: TransitNetwork, p: number, b: BoardOut | RideState, pos: number): number;
   ```
   - **Trip:** binary search `t'` in `[0, tripLen[p])` for the first `dep[ev(net, p, t', pos)] ≥ t` (`ev` from 12/03). FIFO comes from 12/03 step 8.
   - **Freq**, for each window `w` in `[freqStart[p], freqStart[p] + freqLen[p])`:
     ```ts
     const r = runOffset[stopStart[p] + pos];                       // spec §4.1
     const start = Math.max(t - r, fStart[w]) + (fHeadway[w] >> 1); // trip start at the first stop
     if (start <= fEnd[w] && start + r < best) { best = start + r; bestW = w; }
     ```
     - Downstream: `arrAt = start + runOffset[stopStart + pos']`, i.e. `board − r + runOffset[stopStart + pos']`. `depAt` is the same (dwell 0).
     - **FIFO caveat at window boundaries.** One window's candidate rises with `t` and, once `start > fEnd`, stays invalid. A boundary jump (the last `h/2` of window A falls through to `fStart_B + h_B/2`) is therefore a step up, never down. Taking the **minimum over all candidate windows** keeps `earliestBoard` non-decreasing in `t` even if windows overlap. Never stop at the first valid window.
   - **Both kinds on one pattern** (a bus template with some windows ≤ 720 s and others expanded; rail is always frequency, per 12/03): take the earlier `dep`; on a tie the trip wins (it has a real time). Both kinds share the template offsets (12/03 step 6), so earlier departure means earlier arrival.

4. **Rounds** in `raptor.ts`. `runRounds` is a generator that yields after each round:
   ```ts
   export interface RoundInput { egress: readonly StopTime[]; maxRides: number; allowed: Uint8Array /* per pattern */; walkMetersPerMin: number }
   export function* runRounds(net: TransitNetwork, ws: Workspace, inp: RoundInput): Generator<void, void>;
   ```
   Callers set round-0 labels (`tau[0][s]`, `lbl = Access`, `accSeconds`, `accMeters`) and mark those stops first. Per round `k = 1..maxRides`:
   ```ts
   // a. queue: earliest marked position per pattern
   for (const s of marked) for (i of stopRoutes[s]) {
     const p = stopRoutes.pattern[i]; if (!inp.allowed[p]) continue;
     const pos = stopRoutes.pos[i];
     if (queuePos[p] < 0) { queueList[queueCount++] = p; queuePos[p] = pos; } else if (pos < queuePos[p]) queuePos[p] = pos;
   }
   clearMarked();
   // b. traverse each queued pattern
   for (const p of queue) {
     let cur: RideState | null = null;          // {kind, trip|window, board, boardPos, fromStop}; reused object
     for (let pos = queuePos[p]; pos < stopLen[p]; pos++) {
       const s = stops[stopStart[p] + pos];
       if (cur) {                                 // alight?
         const a = arrAt(net, p, cur, pos);
         if (a < Math.min(tauStar[s], destBest[k])) {
           tau[k*n+s] = arrRide[k*n+s] = tauStar[s] = a; lbl[k*n+s] = Lbl.Ride;
           writeRidePtr(k, s, p, cur, pos); mark(s);
         }
       }
       const ready = boardReady(k - 1, s);       // tau[k-1][s] + (lbl === Ride ? CHANGE_SEC : 0); INF if unset
       if (ready < INF && (!cur || ready <= depAt(net, p, cur, pos))   // "can we catch an earlier trip?"
           && earliestBoardInto(net, p, pos, ready, out)
           && (!cur || out.dep < depAt(net, p, cur, pos))) {
         cur = startRide(out, pos, s);
       }
     }
     queuePos[p] = -1;
   }
   // c. footpaths from stops improved by riding in this round (snapshot of markedList)
   for (const s of rideMarked) for (j of transfers[s]) {
     const sec = scaledTransferSeconds(net, j, inp.walkMetersPerMin);
     const a = arrRide[k*n+s] + sec;
     if (a < Math.min(tauStar[to], destBest[k])) {
       tau[k*n+to] = tauStar[to] = a; lbl[k*n+to] = Lbl.Walk; wFrom/wSeconds/wKind = s/sec/kind; mark(to);
     }
   }
   // d. destBest[k] = min(destBest[k-1], destBest[k], min over egress e of tau[k][e.stop] + e.seconds)
   yield;
   ```
   - Footpaths start from `arrRide`, never from a walk label. That stops walk chains, and a walk pointer always leads to a ride pointer in the same round.
   - `scaledTransferSeconds`: for `kind === walk`, `ceil((seconds − 60) · 80 / walkMetersPerMin) + 60`. Station and interchange times are fixed.
   - A loop pattern (T816 starts and ends at `12000750`, MRT Phileo Damansara Pintu A) has the stop twice in `stopRoutes`. The earliest position wins. A ride back to the boarding stop never improves `tauStar`, so it is never recorded.
   - Stop early when no stop is marked.

5. **Backtrack**, also in `raptor.ts`:
   ```ts
   export function backtrack(net: TransitNetwork, ws: Workspace, k: number, stop: number): RawLeg[];  // access → … → stop
   ```
   - At `(k, s)`: on `Walk`, emit a walk leg, then continue from the **ride pointer** at `(k, wFrom)`. On `Ride`, emit a ride leg, then go to `(k − 1, rFrom)` and read its `lbl`. On `Access`, emit an access leg and stop.
   - Throw if the chain exceeds `2K + 1` legs or reaches `Lbl.None` (corrupt labels).
   - Leg times are **not** read from `tau`. Task 04 recomputes them forward from the pointers.

6. **Tests** in `packages/shared/src/transit/__tests__/raptor.test.ts`, written first. Add the builder `__tests__/helpers/tiny-network.ts`:
   ```ts
   export function tinyNetwork(spec: { stops: { id: string; lat: number; lon: number }[];
     patterns: { route: string; mode?: Mode; stops: string[]; trips?: number[][] /* dep per stop */;
       freq?: { start: number; end: number; headway: number; offsets: number[] }[] }[];
     transfers?: { a: string; b: string; seconds: number; kind?: number }[] }): TransitNetwork;
   ```
   Cases:
   - `one line: boards the first trip departing at or after t`, and `after the last trip the stop stays INF`.
   - `two lines, same-stop change honours CHANGE_SEC`: a trip leaving 30 s after the arrival is missed, one leaving 60 s after is caught.
   - `two lines via a footpath: walk pointer then ride pointer`. Includes `proximity footpaths scale with walkMetersPerMin`.
   - `frequency vs timetable on parallel lines picks the earlier arrival`.
   - `frequency boarding at a middle stop adds runOffset`, `trip start past fEnd is rejected`, and `overlapping windows take the minimum board`.
   - `overtaking express (two FIFO patterns) wins although it departs later`.
   - `catches an earlier trip downstream`: a footpath label at stop 2 beats the trip boarded at stop 0.
   - `needs 5 rides → no journey with maxRides 4`.
   - `loop pattern never records a ride back to its first stop`.
   - `runRounds yields once per round`.
   - Fixture: `Hotel Lisa De Inn reaches rail:KJ10 within 4 rides`, with `backtrack` giving `access, ride, …` ending at a KLCC stop.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts` (switched from `raptorProto` to `runRounds`): p95 no worse than task 00's Node numbers + 10%.

## Handoff to next step ([02-range-query-and-ranking.md](./02-range-query-and-ranking.md))
- `workspaceFor`, `resetWorkspace`, `runRounds`, `backtrack`, `earliestBoard(Into)`, `depAt`/`arrAt`, `CHANGE_SEC`, `MAX_RIDES` and `RawLeg` are exported from `packages/shared/src/transit/index.ts`.
- Labels persist between `runRounds` calls until `resetWorkspace`. That is what 02's range loop relies on.
- `raptorProto` is deleted; the bench script uses `runRounds`.
