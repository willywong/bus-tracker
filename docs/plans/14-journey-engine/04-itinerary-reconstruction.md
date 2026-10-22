# 14-Journey-Engine / 04 — Itinerary reconstruction and `plan()`

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.4 fixes the public types: `Place`, `PlanQuery`, `LegPoint` (`stop?` index, `name`, `lat`, `lng`, `time` in epoch ms), `Timing` (`scheduled` | `headway` | `live`), `Leg` (`walk` | `ride` with `via`, `timing` and `tripKey?`), `Itinerary` (`id`, `departAt`, `arriveAt`, `legs`, `rides`, `walkMeters`, `tags`, `warnings: ItineraryWarning[]`, `previousArriveAt?`), `ItineraryWarning`, `LiveSnapshot`, `PlanResult { itineraries, excludedFeeds }`, and `plan(net, q): Generator<void, PlanResult>`. Copy them verbatim.
- Network times are seconds after service-day midnight and can exceed 86,400 (spec §3.3). Malaysia is UTC+8 with no DST:
  - `MY_TZ_OFFSET_MIN` (`packages/shared/src/utils/gtfs-time.ts:3`);
  - `toMalaysiaParts(...).midnightUtcMs` = `Date.UTC(y, m−1, d) − MY_TZ_OFFSET_MIN·60 000` (`gtfs-time.ts:44`, `:55`);
  - `secondsToClockHHMM` (`gtfs-time.ts:25`) for test messages.
  `ScheduledStopTime` (`packages/shared/src/utils/scheduled-position.ts:3`) uses the same seconds convention.
- Tasks 01–03 provide `RawLeg` / `backtrack`, `RawJourney` / `rangeRaptor`, `Candidate` / `latestLeave` / `journeySignature` / `rankCandidates`, and `accessStops` / `patternMask` / `excludedFeeds` / `walkOnlyCandidate`.
- Spec §4.4: `ItineraryWarning = 'last-service' | 'long-wait' | 'missed-connection'` (the last is set only by `retime`, 05). Feed expiry is not a warning; it is `PlanResult.excludedFeeds`.

## Goal
Turn ranked candidates into spec-exact `Itinerary` objects with epoch-ms times, merged walks, `via` stops, `timing`, stable ids and warnings. Then wire everything into `plan()`.

## Prerequisites
- Tasks 01–03.

## Steps

1. **Public types** in `packages/shared/src/transit/plan.ts`: paste the spec §4.4 block exactly, including `ItineraryWarning`, `LiveSnapshot`, `PlanResult` and the `retime` signature (implemented in 05).

2. **Time** in `packages/shared/src/transit/time.ts`:
   ```ts
   export function serviceDayStartMs(ymd: string): number;           // Date.UTC(y, m-1, d) - MY_TZ_OFFSET_MIN * 60_000
   export function toServiceSeconds(net: TransitNetwork, epochMs: number): number; // Math.floor((epochMs - start) / 1000)
   export function toEpochMs(net: TransitNetwork, sec: number): number;            // start + sec * 1000
   ```
   - Test: 2026-10-28 08:00 MYT (`Date.UTC(2026, 9, 28, 0, 0)`) → `28800` on a `20261028` network, and `serviceDayStartMs('20261028') === toMalaysiaParts(new Date(Date.UTC(2026, 9, 28, 4))).midnightUtcMs`.
   - Queries after midnight against yesterday's network (trips past 24:00) are out of scope. The caller passes the network whose `serviceDate` is the Malaysia date of `departAt`.

3. **Forward timing** in `packages/shared/src/transit/reconstruct.ts`:
   ```ts
   export function toLegs(net: TransitNetwork, cand: Candidate, from: Place, to: Place): Leg[];
   ```
   Walk the raw legs with a clock `t` (seconds):
   - Start at `t = latestLeave(net, raw)` (task 02).
   - **access** `{ stop, seconds, meters }`: if `seconds > 0`, emit `walk` from `from` (a `LegPoint` with no `stop`) to the stop, over `[t, t + seconds]`; then `t += seconds`. A snapped origin (0 s) emits nothing.
   - **ride:** compute `board` and `alight`:
     - trip: `board = dep[ev(net, p, trip, boardPos)]`, `alight = arr[ev(net, p, trip, alightPos)]` (`ev` from 12/03), `timing = { kind: 'scheduled' }`, `tripKey = patterns.tripKey[tripStart[p] + trip]`;
     - freq: with `r = runOffset[stopStart + boardPos]`, `start = max(t − r, fStart[w]) + (fHeadway[w] >> 1)`, `board = start + r`, `alight = start + runOffset[stopStart + alightPos]` (spec §4.1, same code as `earliestBoard` in 01), `timing = { kind: 'headway', headwaySec: fHeadway[w] }`, no `tripKey`.
     - Assert `board ≥ t` (+ `CHANGE_SEC` after a same-stop ride). A failure is an engine bug: throw in tests, and drop the candidate in production.
     - `via` = positions `boardPos + 1 … alightPos − 1`, each with its arrival time.
     - `mode = MODES[routes.mode[r]]`, `route = r`, `label`, `color`, `headsign = patterns.headsign[p]`.
     - Then `t = alight`.
   - **walk** `{ from, to, seconds }`: emit `walk` from stop to stop over `[t, t + seconds]`, with `meters = round(walkedMeters(a, b))` (03).
   - **egress:** if `seconds > 0`, emit `walk` from the last stop to the `to` place.
   - **walk-only** (`raw === null`): one `walk` leg from `from` to `to`, starting at `cand.leave`.
   - `LegPoint`s use `stops.name`, `stops.lat` / `stops.lon` (as `lng`) and `toEpochMs`. Place points use `Place.name` / `lat` / `lng`.
   - **Merge consecutive walks** (for example a transfer walk followed by egress): keep the first `from` and the last `to`, and sum `meters` and `seconds`.

4. **Ids** in `packages/shared/src/transit/ids.ts`:
   ```ts
   export function signatureFromLegs(net: TransitNetwork, legs: readonly Leg[]): string; // same string as journeySignature (02)
   export function fnv1a32(s: string): number;
   export function itineraryId(net: TransitNetwork, legs: readonly Leg[]): string;        // fnv1a32(signature).toString(36).padStart(7, '0')
   ```
   - The signature covers ride legs only: `${label}:${stops.id[from.stop]}>${stops.id[to.stop]}` joined by `'|'`, or `'walk'` when there are none. It uses string stop ids, not indices, so the id also survives tomorrow's network.
   - Times are excluded, so `retime()` (05) keeps the id unless the legs change.

5. **Warnings** in `reconstruct.ts`:
   ```ts
   export function legWarnings(net: TransitNetwork, legs: readonly Leg[]): ItineraryWarning[];
   ```
   - `'last-service'`: for any ride leg, `earliestBoard(net, p, boardPos, boardSec + 1)` (01) is null, or departs more than 3,600 s after `boardSec`. Use `trip + 1` for trips; for headway legs, the window end decides.
   - `'long-wait'`: any gap before a ride leg (previous leg's `to.time` to this leg's `from.time`) over 15 min. The first ride's gap is ≤ 60 s under latest-leave, so in practice this flags transfers.
   - Dedupe; order `last-service`, then `long-wait`.

6. **Assembly:**
   ```ts
   export function toItinerary(net: TransitNetwork, q: PlanQuery, r: Ranked): Itinerary;
   ```
   - `legs = toLegs(...)`, `departAt = legs[0].from.time`, `arriveAt = legs.at(-1).to.time`, `rides` = the number of ride legs, `walkMeters` = Σ walk `meters`, `tags = r.tags`, `id = itineraryId(net, legs)`, `warnings = legWarnings(net, legs)`. `previousArriveAt` stays unset (only `retime` sets it).

7. **`plan()`** in `plan.ts`:
   ```ts
   export function* plan(net: TransitNetwork, q: PlanQuery): Generator<void, PlanResult> {
     const t0 = toServiceSeconds(net, q.departAt);
     const mpm = q.walkMetersPerMin > 0 ? q.walkMetersPerMin : WALKING_METERS_PER_MINUTE;
     const allowed = patternMask(net, q.modes);
     const o = { walkMetersPerMin: mpm, maxWalkMeters: q.maxWalkMeters ?? 1000, allowed };
     const access = accessStops(net, q.from, o), egress = accessStops(net, q.to, o);
     const walk = walkOnlyCandidate(q.from, q.to, t0, mpm);
     const raws = sameSpot(access, egress, q) ? [] :
       yield* rangeRaptor(net, { access, egress, t0, maxRides: q.maxRides ?? MAX_RIDES, allowed, walkMetersPerMin: mpm, windowSec: PLAN_WINDOW_SEC });
     const cands = raws.map((r) => summarize(net, r, t0)); if (walk) cands.push(walk);
     return { itineraries: rankCandidates(cands, t0).map((r) => toItinerary(net, q, r)), excludedFeeds: excludedFeeds(net) };
   }
   export function planSync(net: TransitNetwork, q: PlanQuery): PlanResult;   // drain(plan(...)), tests and scripts
   export const PLAN_WINDOW_SEC: number;                                        // 2400, or 1200 per task 00 Results
   ```
   - Export from `packages/shared/src/transit/index.ts`. The root barrel already re-exports `transit/` (12/01 step 5).

8. **Tests** in `packages/shared/src/transit/__tests__/reconstruct.test.ts` and `plan.test.ts`:
   - `time: 08:00 MYT is 28800 s and round-trips through toEpochMs`.
   - `timetabled ride legs carry tripKey and scheduled timing`, and `headway legs carry headwaySec and no tripKey` (tiny network).
   - `via lists intermediate stops with monotonic times`.
   - `transfer walk + egress walk merge into one walk leg`.
   - `snapped origin emits no zero-length walk`.
   - `latest leave: the access walk ends 60 s before a timetabled board`.
   - `id ignores times, changes with route or stops; signatureFromLegs equals journeySignature`.
   - `last-service when the next departure is > 60 min away`, and `long-wait on a 20-min transfer`.
   - `plan() yields, and planSync returns ≤ 5 itineraries whose first is tagged fastest, with excludedFeeds = []` (fixture, Hotel Lisa De Inn → station `klcc`).
   - `plan() on fixtureNetwork({ exclude: ['rail'] }) returns excludedFeeds ['rail'], no rail legs, and no feed strings in any warnings`.
   - `excludedFeeds is returned even when itineraries is empty` (a query in the sea).

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm --filter @bus-tracker/shared build`, then `grep -c "declare function plan" packages/shared/dist/index.d.ts` prints `1`.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts` now times `planSync` end to end. Compare it with the task 00 decision.

## Handoff to next step ([05-live-retiming.md](./05-live-retiming.md))
- `plan`, `planSync` (both return `PlanResult`), the spec §4.4 types, `toLegs`, `toItinerary`, `itineraryId`, `signatureFromLegs`, `legWarnings`, `serviceDayStartMs`, `toServiceSeconds` and `toEpochMs` are exported.
- Ride legs keep the network `route` index and stop indices in `LegPoint.stop`, so `retime()` can find the pattern and stops again. To recover `pattern`, search `stopRoutes` for the board/alight pair on a pattern of `route` with the same headsign.
