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

## Implementation notes
- **Two arrival labels per (k, s), not one `tau` pruned by `tauStar`.** The step 4 sketch prunes ride arrivals by `tauStar`. That is 00's bug 2: an earlier walk label drops a later ride arrival, and only a ride arrival may walk on. `CHANGE_SEC` also breaks time dominance. A ride arriving at 08:10:00 is ready to board at 08:11:00, while a walk arriving at 08:10:10 is ready at once, so keeping only the earlier arrival can miss a connection. The workspace therefore holds:
  - `arrRide`, with its ride pointer; it is the only footpath source.
  - `arrWalk`, with its walk pointer. Round 0 is the access label.
  - `tau = min(arrRide, arrWalk)`, with `lbl` saying which. This is the egress label.

  Boarding uses `ready = min(arrRide + CHANGE_SEC, arrWalk)`. The ride pointer records the kind of label it boarded from (`rFromLbl`), so `backtrack` follows the label actually used, not `lbl`.
- **Per-departure pruning:** `tauStar` is replaced by `rideStar` and `readyStar`.
  - A ride arrival is kept only if it beats `rideStar[s]`, `arrRide[k][s]` and `destBest[k]`.
  - A walk is kept only if it beats `readyStar[s]`, the round's ready time `min(arrWalk, arrRide + CHANGE_SEC)` and `destBest[k]`.
  - Both arrays are reset per departure, as 00's note 1 requires. Labels persist until `resetWorkspace`.
- **Added `startDeparture(ws, access, dep)`.** It clears the per-departure pruning and marks, then writes and marks the round-0 labels. Range departures must run latest first, because a label only moves earlier.
- **Mark flags.** The step 4 sketch takes a snapshot of `markedList`. Here `marked[s]` holds two bits instead:
  - `1`: board from s next round, set when `readyStar` improved;
  - `2`: walk on from its ride arrival.

  Phase b marks only ride arrivals, so step 3 relaxes the list as it stands after phase b. Ride arrivals that only matter for footpaths are not queued for the next round.
- **Loop rule.** Ride arrivals are no longer pruned by an access or walk label, so `tauStar` cannot stop a loop from recording a ride back to the stop where you boarded. The scan skips alighting at the stop where the current vehicle was boarded (`T816`'s `12000750`).
- **Boarding.**
  - `BoardOut`/`RideState` carry `start`, the run's start at the first stop. Without it, `depAt`/`arrAt` cannot place a window run from a `BoardOut`.
  - `earliestBoardInto` takes an optional `tripHi`, which bounds the trip search as 00 did; it was worth about 7% of scan time.
  - On a tie between a trip and a window, the trip wins, as specified.
- **`destBest[k]`:**
  - Each round lowers `destBest[j]` for every `j ≥ k`, so it is the best arrival with ≤ k rides over the departures run so far.
  - Round 0 is never settled; the walk-only option belongs to 03.
  - Because walks are no longer pruned by earlier rides, 00's Q4-style gap is closed for ride arrivals at stops that are both access and egress stops.
- **`resetWorkspace` leaves the pointer arrays alone.** They are only read behind a set label, and `backtrack` checks the arrival before reading a pointer. `accMeters` is rounded to whole metres. The workspace is 1.77 MB on the fixture network.
- **Exports:** `scaledTransferSeconds(net, j, walkMetersPerMin)` (04 needs it for walk legs), `startDeparture`, `RoundInput`, `BoardOut`, `RideState`, `Workspace`.
- **Prototype removed:**
  - `raptorProto`, `raptorProtoSteps`, `RaptorProtoOptions`, `RaptorProtoResult` and `raptor-proto.test.ts` are gone. Their fixture smoke test and range-equals-best-single-departure check now live in `raptor.test.ts`.
  - The bench and the device harness (`apps/mobile/app/dev-planner.tsx`, JS-only) time `rangeArrival`/`rangeArrivalSteps` in `scripts/raptor-queries.ts`. That is a stand-in range driver over `startDeparture` + `runRounds` until 02's `plan()`.
  - `engineBytes(net)` now sums the workspace.
- **Tests (22 in `raptor.test.ts`):**
  - the step 6 cases;
  - "a ride arrival after an earlier walk label still walks on";
  - "a walk arriving within CHANGE_SEC after a ride still boards first";
  - persistence across departures;
  - corrupt-label throws;
  - a naive round-by-round oracle (no pruning, same rules) on 24 seeded random fixture queries. Per-round `destBest` must match exactly, and every backtracked journey must replay forward to its label.

  Mutation checks against the suite all fail it: dropping `CHANGE_SEC`, walks from `tau`, rides pruned by walk labels, walks pruned by arrival rather than ready time, and no loop rule.
- **Bench (Node v24, `--expose-gc`, 3 runs, dev Mac shared with another agent's test runs).** Arrivals and runs are identical to 00. Q2 scans 77 rounds against 75.

  | p95 ms | Q1 | Q2 | Q3 | Q4 | Q5 |
  |---|---:|---:|---:|---:|---:|
  | core, 40-min | 0.86–0.90 | 0.52–0.54 | 2.56–2.69 | 0.14–0.15 | 1.04–1.07 |
  | prototype, same session | 0.86–0.88 | 0.44–0.46 | 2.31–2.35 | 0.15–0.16 | 0.82–0.90 |
  | core, 20-min | 0.70 | 0.31 | 1.47 | 0.09 | 0.76 |

  Against 00's recorded p95 + 10%, Q1, Q2 and Q4 pass, and Q3 (+15–21%) and Q5 (+20–23%) miss.
  - The work is nearly the same: about 7% more scanned positions, from walks kept for `CHANGE_SEC`.
  - The rest is per-step cost: pointer writes, the per-round target bound that 02's Pareto set needs, and the workspace reset.
  - A global bound would recover about 4% on Q5, but it is wrong for 02.
  - The worst case is still about 2.7 ms, roughly 20× under spec §4.4's 60 ms Node target.
- Root review (2026-10-23): the Q3/Q5 p95 regression vs the prototype (+15–23%, worst 2.7 ms on Node) is accepted. It buys correct CHANGE_SEC and walk/ride label handling, and stays ~20× under the 60 ms Node target (14/00 Hermes p95 ≤ 48 ms).
