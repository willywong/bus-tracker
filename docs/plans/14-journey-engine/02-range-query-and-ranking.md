# 14-Journey-Engine / 02 — Range query, Pareto set and ranking

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.1: run RAPTOR at departures from `t0` to `t0 + 40 min` in 2-min steps, latest first, reusing labels (rRAPTOR). The result is a Pareto set over (depart later, arrive earlier, fewer rides).
- Spec §4.2 sets the ranking:
  1. collect the Pareto set;
  2. drop options arriving more than 30 min after the fastest;
  3. score `arrive + 3 min per transfer + 1.5 × walk minutes beyond 5 + 2 min if the first wait is over 15 min`;
  4. return the top 5, with the fastest first and "fewest transfers" / "least walking" present when they differ;
  5. tags `fastest`, `fewer-changes`, `less-walking` (spec §4.4 `Itinerary.tags`).
- Task 01 gives `runRounds` (labels persist until `resetWorkspace`), `backtrack(net, ws, k, stop)` and `RawLeg`. Pointers are overwritten by the next, earlier departure run. So a journey must be **backtracked as soon as its run finds it**, not at the end.
- Task 00's Results set the window: 2400 s, or 1200 s if the decision fell back.

## Goal
`rangeRaptor` returns every non-dominated raw journey in the window. `rankCandidates` turns raw journeys (plus the walk-only option from 03) into at most five tagged candidates, deduplicated by leg sequence.

## Prerequisites
- Task 01.

## Steps

1. **Range loop** in `packages/shared/src/transit/range.ts`:
   ```ts
   export interface RawJourney { legs: RawLeg[]; rides: number; run: number /* departure step, s */; arrive: number /* incl. egress */; egress: StopTime }
   export interface RangeInput { access: readonly StopTime[]; egress: readonly StopTime[]; t0: number;
     windowSec?: number /* 2400 */; stepSec?: number /* 120 */; maxRides?: number /* MAX_RIDES */;
     allowed: Uint8Array; walkMetersPerMin: number }
   export function* rangeRaptor(net: TransitNetwork, inp: RangeInput): Generator<void, RawJourney[]>;
   ```
   ```ts
   const ws = workspaceFor(net); resetWorkspace(ws);
   const bestUpTo = new Int32Array(K + 1).fill(INF);      // across runs: best arrival with ≤ k rides
   for (let d = t0 + windowSec; d >= t0; d -= stepSec) {
     for (const a of access) setAccess(ws, a, d + a.seconds);   // tau[0], lbl Access, mark
     yield* runRounds(net, ws, { egress, maxRides, allowed, walkMetersPerMin });
     for (let k = 1; k <= maxRides; k++) {
       const { arrive, e } = bestEgress(ws, k, egress);           // min over egress of tau[k][e.stop] + e.seconds
       if (arrive < bestUpTo[k]) {                                // strictly better than later runs and fewer rides
         out.push({ legs: backtrack(net, ws, k, e.stop), rides: k, run: d, arrive, egress: e });
         for (let j = k; j <= maxRides; j++) bestUpTo[j] = Math.min(bestUpTo[j], arrive);
       }
     }
     yield;
   }
   ```
   - `setAccess` writes only when `d + a.seconds < tau[0][a.stop]`. An earlier run always improves round 0, so every access stop is marked each run.
   - Round labels from later runs stay valid upper bounds (FIFO). A label carried over from a later run never yields a *strict* improvement at the egress, so it is never recorded twice.
   - A raw journey's `rides` is `k`, but `backtrack` may return fewer ride legs if the label came from a cheaper round. Recount ride legs from `legs`.

2. **Candidate summary** in `packages/shared/src/transit/rank.ts`:
   ```ts
   export interface Candidate {
     raw: RawJourney | null;            // null = walk-only (task 03)
     leave: number; arrive: number;     // service-day seconds
     rides: number; walkSec: number; walkMeters: number;
     firstWaitSec: number;              // wait at the first boarding stop if you set off at t0
     signature: string;                 // leg-sequence key, see step 4
   }
   export function summarize(net: TransitNetwork, raw: RawJourney, t0: number): Candidate;
   ```
   - **leave (latest leave):** for a timetabled first ride, `max(raw.run, boardTime − accessSec − 60)`. For a headway first ride, `raw.run` (the expected wait is part of the model). For a journey with no ride, `raw.run`. Task 04 builds leg times from the same rule. Export it as `latestLeave(net, raw)` so 04 does not re-derive it.
   - `walkSec` / `walkMeters`: the sum of access, transfer-walk and egress legs. Transfer meters are `haversineMeters(stopA, stopB) × 1.25` (`packages/shared/src/utils/outlier.ts:6`), because transfers store seconds only.
   - `firstWaitSec = max(0, firstBoardTime − (t0 + accessSec))`. Spec §4.2 does not define "first wait". With latest-leave the wait at the stop is always ≤ 60 s, so the useful reading is "how long you would wait if you left now" (reported upward).

3. **Pareto filter:** `paretoFilter(cands)` keeps `c` unless another candidate has `leave ≥`, `arrive ≤` and `rides ≤`, with at least one strict. O(n²) is fine for n ≤ 21 × 4 + 1.

4. **Signature and dedupe:**
   ```ts
   export function journeySignature(net: TransitNetwork, raw: RawJourney | null): string;
   // ride legs only: `${routes.label[r]}:${stops.id[boardStop]}>${stops.id[alightStop]}` joined by '|'; walk-only → 'walk'
   ```
   - Two journeys on the same routes between the same stops (T816 at 08:05 and at 08:35) share a signature. Keep the one with the lower score; on a tie, the later `leave`.
   - Walk legs are left out, so a re-timed walk does not change the key. Task 04 hashes this exact string into `Itinerary.id` via `signatureFromLegs`, which must produce the same string.

5. **Score and selection:**
   ```ts
   export interface Ranked { cand: Candidate; score: number; tags: ('fastest' | 'fewer-changes' | 'less-walking')[] }
   export function scoreOf(c: Candidate, t0: number): number;
   //   (c.arrive − t0) / 60 + 3 · max(0, c.rides − 1) + 1.5 · max(0, c.walkSec / 60 − 5) + (c.firstWaitSec > 900 ? 2 : 0)
   export function rankCandidates(cands: Candidate[], t0: number, limit = 5): Ranked[];
   ```
   1. `paretoFilter`.
   2. `fastest` = min `arrive` (tie: lower score, then later `leave`). Drop `arrive > fastest.arrive + 1800`.
   3. Dedupe by signature (step 4).
   4. Sort by score (tie: earlier `arrive`, fewer rides, later `leave`). Take `limit`. Move `fastest` to index 0.
   5. `fewer` = the min-rides candidate among those with `rides ≥ 1` (tie: score). If `fewer.rides < fastest.rides` and it is not selected, it replaces the last selected entry that is neither `fastest` nor a guaranteed pick. Walk-only never takes this tag.
   6. `lessWalk` = min `walkMeters` (tie: score). If `lessWalk.walkMeters ≤ fastest.walkMeters − 100` and it is not selected, it replaces the same way. The 100 m floor stops noise-level differences from earning a tag.
   7. Tags: index 0 gets `fastest`, `fewer` gets `fewer-changes`, and `lessWalk` gets `less-walking`, each only when the condition above held. Keep score order after index 0.

6. **Tests:**
   - `packages/shared/src/transit/__tests__/range.test.ts` (with `tinyNetwork`):
     - `latest run first: a later departure with the same arrival dominates`;
     - `two rides arriving earlier and one ride arriving later are both kept`;
     - `labels are reused: the second run scans fewer patterns` (count queued patterns per run);
     - `journeys are backtracked in the run that found them`: two runs on different trips give different first-ride trips;
     - `headway first ride: leave equals the run time`;
     - `rangeRaptor yields between rounds and between runs`.
   - `packages/shared/src/transit/__tests__/rank.test.ts` (plain `Candidate` literals):
     - `pareto drops dominated`;
     - `drops arrivals more than 30 min after the fastest`;
     - `score formula matches spec §4.2` (one hand-computed case per term);
     - `fastest is always first`;
     - `fewer-changes is guaranteed a slot when it differs`;
     - `less-walking needs ≥ 100 m less`;
     - `identical signatures dedupe to the better score`;
     - `walk-only never gets fewer-changes`;
     - `returns at most 5`.
   - Fixture (in `range.test.ts`): Hotel Lisa De Inn → KLCC at 08:00 returns ≥ 2 candidates after `rankCandidates`, and index 0 has the minimum `arrive`.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts` now times `rangeRaptor` + `rankCandidates`, and the p95 stays under the task 00 decision's budget.

## Handoff to next step ([03-access-egress-walk.md](./03-access-egress-walk.md))
- `rangeRaptor`, `RawJourney`, `Candidate`, `summarize`, `latestLeave`, `paretoFilter`, `journeySignature`, `scoreOf`, `rankCandidates` and `Ranked` are exported from `packages/shared/src/transit/index.ts`.
- `rangeRaptor` takes access and egress as `StopTime[]` and an `allowed` pattern mask. Task 03 builds all three from `Place`s and `modes`.
- `Candidate.raw === null` is reserved for walk-only. Task 03 builds that candidate, and `rankCandidates` already handles it.
