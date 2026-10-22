# 14-Journey-Engine / 05 — Live re-timing and the realtime subscription

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- Spec §4.3:
  - plan on the timetable, then re-time the **first bus leg** if it boards within 60 min;
  - accept the live bus only if it reaches the stop after you can (your arrival + 60 s);
  - shift the downstream times; re-plan from the transfer stop if a connection breaks, and show "Updated · was 9:12";
  - rail is never live;
  - planner categories that are not already followed poll every 60 s, **only from spare budget**. With no spare budget the itinerary stays Scheduled and says so. It is never dropped silently.
- Spec §4.4 (binding):
  - `retime(its, live, net, ctx: Pick<PlanQuery, 'to' | 'walkMetersPerMin' | 'modes'>): Itinerary[]`, where `ctx` is **required**;
  - `LiveSnapshot = { byCategory: Record<string, { asOf: number; positions: VehiclePosition[] }> }`, one entry per polled category;
  - `Timing.live = { vehicleId, asOf, deltaSec }`;
  - `Itinerary.previousArriveAt?` carries "was 9:12";
  - `ItineraryWarning` includes `'missed-connection'`.
- Existing pieces:
  - `computeEta({ vehicles, stop, polyline, intermediateCandidates, loop = true, … })` (`packages/shared/src/utils/eta.ts:223`, args at `:184`). It picks the nearest approaching bus via `pickApproachingVehicle` (`eta.ts:123`) and drives at `DEFAULT_BUS_CRUISE_KMH = 25` (`eta.ts:15`) plus 1.5 min per intermediate stop. It needs a **polyline**. `TransitNetwork` keeps only `shapeId`, so the engine uses the pattern's stop chain as the polyline.
  - `resolveRouteAlias(raw, aliases)` (`packages/shared/src/utils/realtime.ts:151`) tries the raw id, then its first word ("T155 Inbound" → "T155").
  - `dropImplausibleFixes(positions, now)` (`realtime.ts:176`, `MAX_FIX_AGE_MS` 10 min at `:165`). `entitiesToPositions` (`realtime.ts:74`) gives `VehiclePosition.routeId` as the resolved route key.
  - `rawGtfsId` (`packages/shared/src/utils/categories.ts:162`) strips the `kl:` prefix. Rapid KL realtime sends the GTFS `route_id` ("U4000"); the feeder sends the code ("T816") (`apps/mobile/services/realtimePlan.ts:25`–`:29`).
- The mobile poller today:
  - `POLL_INTERVAL_MS = 30_000` (`apps/mobile/services/realtime.ts:28`);
  - every polled category is fetched **in parallel** each tick (`Promise.allSettled`, `realtime.ts:250`);
  - the plan is built only from followed route codes (`setRouteCodes`, `:72`/`:419`; `loadPlan`, `:108`/`:128`; `buildRealtimePlan`, `realtimePlan.ts:56`);
  - feeds are filtered to followed routes (`isFollowed`, `realtimePlan.ts:162`; `positionsFromFeed`, `:171`);
  - all categories' positions are merged into one `positions` array without per-category `asOf` (`realtime.ts:286`–`:314`).
  Two followed categories already use 2 × 2 = 4 requests per minute.

## Goal
`retime()` makes the first bus leg live when a plausible bus is approaching, shifts what follows, and re-plans a broken tail once. The mobile realtime store polls planner categories only from spare budget, reports the ones it could not poll, and exposes per-category positions in the `LiveSnapshot` shape.

## Prerequisites
- Task 04 (`plan`, `toLegs`, `itineraryId`, `legWarnings`; the spec §4.4 types are already in `plan.ts`).

## Steps

1. **Constants and helpers** in `packages/shared/src/transit/live.ts`:
   ```ts
   export const LIVE_HORIZON_MS = 60 * 60_000;     // first bus leg must board within this
   export const CATCH_MARGIN_MS = 60_000;
   export const MAX_LIVE_SHIFT_SEC = 20 * 60;      // larger |delta| on a timetabled leg = a different run; ignore
   export const UPDATED_MIN_SHIFT_MS = 60_000;     // set previousArriveAt only when arriveAt moves at least this much
   export function liveNow(live: LiveSnapshot): number | null;   // max asOf over byCategory; null when empty
   ```
   - `LiveSnapshot` has no clock, so `retime` stays pure by using the newest `asOf` as "now". An empty snapshot returns the input unchanged.

2. **Matching vehicles** (`live.ts`):
   - Category of the leg: `FEED_INFO[FEED_IDS[routes.feed[leg.route]]].category` (12/01 step 3). Only `rapid-bus-mrtfeeder` and `rapid-bus-kl` have one. Rail and KTM legs are skipped.
   - Read `live.byCategory[category]`. Skip it if missing or if `now − asOf > MAX_FIX_AGE_MS`.
   - Aliases for the route: `new Map([[rawGtfsId(routes.id[r]), label], [label, label]])`. Keep a vehicle when `resolveRouteAlias(v.routeId, aliases) === label`. This accepts both resolved keys and raw feed ids.
   - Then `dropImplausibleFixes(vehicles, now)`.

3. **ETA for the boarding stop:**
   - `findPattern(net, leg)`: a pattern of `leg.route` whose stops contain `leg.from.stop` before `leg.to.stop`, with the same headsign. FIFO siblings share stops, so any match works.
   - Polyline: the pattern's stop coordinates in order. `loop`: first stop === last stop (T816).
   - `intermediateCandidates`: the pattern's stops other than the boarding stop.
   - `computeEta({ vehicles, stop, polyline, intermediateCandidates, loop })`.
   - `liveBoard = picked.observedAt + minutesToStop · 60_000`. Use the fix time, because a fix can be up to a poll old.

4. **`retime()`** in `packages/shared/src/transit/retime.ts`, with the spec §4.4 signature:
   - **Input contract:** `its` is `plan()` output (scheduled). `usePlanner` (15/04) keeps that base list and the query, and passes `ctx = { to, walkMetersPerMin, modes }` from it. It never feeds `retime` output back in.
   For each itinerary:
   1. Find the first ride with mode `bus` | `feeder` and `from.time − now ≤ LIVE_HORIZON_MS`. None → unchanged.
   2. `reachAt` = the previous leg's `to.time`. For an access walk, it is `max(now, walk.from.time) + walk.seconds · 1000`. With no previous leg (snapped origin), `now`.
   3. Accept when `liveBoard ≥ reachAt + CATCH_MARGIN_MS`, and (for scheduled legs) `|liveBoard − from.time| ≤ MAX_LIVE_SHIFT_SEC · 1000`. Otherwise → unchanged.
   4. `delta = liveBoard − leg.from.time`. Shift `from`, `via` and `to` by `delta`. Set `timing = { kind: 'live', vehicleId, asOf, deltaSec: round(delta / 1000) }`.
   5. **Propagate** with `ready = leg.to.time` through the later legs:
      - walk: shift it to start at `ready`; `ready = to.time`.
      - headway ride: re-board with `earliestBoard` at `toServiceSeconds(ready)` (01) and rebuild its times. Later times follow.
      - scheduled ride: if `ready (+ CHANGE_SEC on a same-stop change) ≤ from.time`, stop propagating; the rest is unchanged. Otherwise the transfer is **broken** → step 6.
   6. **Tail re-plan** (at most once per itinerary per call):
      - `planTail(net, stop, readySec, ctx)`: one `rangeRaptor` run with `windowSec = 0`, access `[{ stop, seconds: 0, meters: 0 }]`, egress `accessStops(net, ctx.to, …)` with `ctx.walkMetersPerMin`, `patternMask(net, ctx.modes)`, and `maxRides = 4 − ridesSoFar`. Drain it synchronously and take the earliest arrival.
      - Splice: keep the legs up to the transfer stop and add the new tail legs from `toLegs`. Recompute `id`, `rides`, `walkMeters` and `legWarnings`.
      - No tail found → keep the live leg, leave the tail scheduled, and add the `'missed-connection'` warning.
   7. If the final `arriveAt` moved by at least `UPDATED_MIN_SHIFT_MS`, set `previousArriveAt` to the planned `arriveAt` ("Updated · was 9:12").
   8. Re-sort nothing. Ranking and tags stay as planned; 15/04 shows the new times in place.

5. **Planner subscriptions** in `live.ts`:
   ```ts
   export interface PlannerFeedRoutes { category: 'rapid-bus-mrtfeeder' | 'rapid-bus-kl'; aliases: Map<string, string>; routes: string[] }
   export function plannerRealtimeRoutes(its: readonly Itinerary[], net: TransitNetwork, now: number): PlannerFeedRoutes[];
   ```
   - Collect the first bus leg (step 4.1 rule) of each itinerary and group by category. Klang Valley has two live bus categories, so the result is ≤ 2. Assert it.

6. **Mobile store integration** (JS-only; `apps/mobile/services/`):
   - `realtimePlan.ts`:
     - `buildRealtimePlan(routeCodes, stored, tripToRoute, extra: readonly PlannerFeedRoutes[] = [])` merges `extra` into the per-category entries (aliases and `routes`).
     - `RealtimeFeedPlan` gains `intervalMs: number`. A category with a followed route stays at `30_000`; its planner routes ride along at no cost.
     - Add `requestsPerMinute(plan) = Σ 60_000 / intervalMs`. Planner-only categories are added at `60_000` **only while the total stays ≤ 4**.
     - Those that do not fit go to `RealtimePlan.plannerSkipped: BusCategory[]` instead of being polled.
   - `realtime.ts`:
     - Add `setExtraRoutes(source: 'planner', extra: readonly PlannerFeedRoutes[])` to `RealtimeStore`. It is compared like `sameRouteCodes`, and it clears `plan`.
     - `loadPlan(routeCodes, extra)`.
     - In `tick()`, fetch only the feeds that are due (`now − lastFetchAt[category] ≥ intervalMs − 1_000`). The rest keep `lastByCategory`.
     - Polling runs while `routeCodes` **or** extras is non-empty. Update the guards at `realtime.ts:233`, `:331`, `:380` and `:426`.
     - Add to `RealtimeSnapshot`:
       - `byCategory: Record<string, { asOf: number; positions: VehiclePosition[] }>`, with every polled route's positions; this is the `LiveSnapshot` shape;
       - `plannerSkipped: BusCategory[]`.
     - `positions` stays filtered to **followed** routes, so planner buses never appear as "my buses" on the map.
   - 15/04's `usePlanner` passes `{ byCategory: snapshot.byCategory }` to `retime`. For an itinerary whose first bus leg's category is in `plannerSkipped`, the status line shows "Scheduled": visible, never silent.

7. **Tests**:
   - `packages/shared/src/transit/__tests__/retime.test.ts`:
     - `empty snapshot → itineraries deep-equal the input`.
     - `T816 bus two stops upstream of Hotel Lisa De Inn makes the first leg live and shifts downstream` (fixture network; vehicle at `12000757` JEJANTAS SS2/24 with a bearing toward `12000762`; `byCategory['rapid-bus-mrtfeeder']`).
     - `bus that arrives before you can reach the stop is ignored`, `stale category (asOf > 10 min) is ignored`, and `|delta| > 20 min on a timetabled leg is ignored`.
     - `headway rail leg after the live bus re-boards at the new arrival`.
     - `broken timetabled transfer re-plans the tail once using ctx and sets previousArriveAt` (tiny network: feeder A → feeder B with a 2-min connection, then a later B trip).
     - `no tail found → 'missed-connection'`.
     - `id unchanged when legs unchanged` (README criterion 5), `rail legs are never live`, and `previousArriveAt unset when arrival moves < 60 s`.
     - `plannerRealtimeRoutes returns ≤ 2 categories with rawGtfsId aliases`.
   - `apps/mobile/services/__tests__/realtimePlan.test.ts`:
     - `planner extras merge into a followed category at 30 s`;
     - `planner-only category polls at 60 s when budget allows`;
     - `planner-only category goes to plannerSkipped when two followed categories use the budget`.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm --filter mobile test`.
- `pnpm type-check`.
- Manual: none in this phase; 15/04 checks the Live and Scheduled status on device.

## Handoff to next step ([06-golden-journey-tests.md](./06-golden-journey-tests.md))
- `retime`, `liveNow`, `plannerRealtimeRoutes` and `PlannerFeedRoutes` are exported from `packages/shared/src/transit/index.ts`; `LiveSnapshot` is in `plan.ts` (04).
- The mobile store has `setExtraRoutes('planner', …)`, `snapshot.byCategory` and `snapshot.plannerSkipped`. 15/04 wires them in `usePlanner`.

## Implementation notes
- **Public API** (`@bus-tracker/shared`; `index.ts` re-exports these by name, so the helpers stay internal):
  ```ts
  retime(its: Itinerary[], live: LiveSnapshot, net: TransitNetwork, ctx: RetimeContext): Itinerary[];
  type RetimeContext = Pick<PlanQuery, 'to' | 'walkMetersPerMin' | 'modes'>;
  liveNow(live: LiveSnapshot): number | null;
  plannerRealtimeRoutes(its: readonly Itinerary[], net: TransitNetwork, now: number): PlannerFeedRoutes[];
  interface PlannerFeedRoutes { category: PlannerLiveCategory; aliases: Map<string, string>; routes: string[] }
  type PlannerLiveCategory = 'rapid-bus-mrtfeeder' | 'rapid-bus-kl';
  LIVE_HORIZON_MS, CATCH_MARGIN_MS, MAX_LIVE_SHIFT_SEC, UPDATED_MIN_SHIFT_MS
  ```
  `retime` is in `transit/retime.ts`. The steps 1–3 helpers are in `transit/live.ts`: `liveCategoryOf`, `firstLiveLeg`, `findPattern` and `liveBoarding`. The commented `retime` signature in `plan.ts` is now a one-line pointer to `retime.ts`.
- **Deviations from the steps:**
  - **Step 4.3:** when the nearest approaching bus fails the catch or shift check, the next approaching bus is tried (spec §4.3: "if *a* live bus will reach the stop after you can"). Example: one bus is 30 s out and the one behind it is 6 min out. The rider catches the second one, and that bus is used.
  - **Step 4.4:** `delta` is rounded to whole seconds, so every time stays on the second grid that the headway re-board uses. `Timing.live.asOf` is the fix's `observedAt`, not the category's poll time.
  - **Step 4.4:** legs before the live ride are not moved. If you are snapped to the stop, `departAt` moves with the bus. After an access walk it stays as planned.
  - **Step 4.6:** the tail uses `egressStops` for `ctx.to`, not `accessStops` as written. This follows 03's notes; `maxWalkMeters` takes its default.
  - **Step 4.6:** the tail cannot be walk-only, because `rangeRaptor` records only journeys with at least one ride. It always starts at the broken ride's boarding stop.
  - **Step 4.5:** a headway ride is re-boarded only on its windows (`earliestBoardInto(…, tripHi = 0)`), so it stays a headway leg. If its windows have closed, the transfer counts as broken.
  - **Step 4.6:** with no tail found, the walk before the broken ride is still shifted, and the broken ride and everything after it are left exactly as planned.
  - **Step 4.6:** after every retime, `warnings` are recomputed with `legWarnings`, not only after a splice. `rides`, `walkMeters` and `id` are recomputed every time too.
  - **Step 6:** `tick()` checks the "due" rule only for feeds whose `intervalMs` is longer than the poll interval, which in practice means planner-only feeds. Followed feeds are still fetched on every tick, so pull-to-refresh and foreground resume stay immediate, as before. `feedVehicleCount` sums only followed feeds.
  - **Step 6:** `setExtraRoutes` triggers a tick only when the store was idle. When polling is already running, the next scheduled tick picks up the new plan, so planner changes never add requests outside the poll cadence.
  - **Step 6:** `byCategory[c].asOf` is the category's last successful fetch. Its positions are the plausible fixes, without the outlier filter or the dedup that `positions` gets.
  - **Step 6:** `loadPlan` with no followed routes builds the plan from the extras alone and never opens the DB.
  - **Step 6:** `realtime-mock.ts` gained the new snapshot fields and a no-op `setExtraRoutes`. Its `byCategory` carries the mock T816 under the feeder category.
- **Conflict with 15/04 (resolve there):** 15/04's step 2 text plans `setPlannerRoutes(routes)`, `RealtimeFeedPlan.plannerOnly` and building `LiveSnapshot` by grouping `positions`. This task ships `setExtraRoutes('planner', plannerRealtimeRoutes(base, net, now))` instead, and the store passes `{ byCategory: snapshot.byCategory }` directly. `positions` holds only followed routes, so grouping them would lose the planner's buses. A planner-only feed is the one with `intervalMs === PLANNER_INTERVAL_MS`.
- **Workspace sharing (risk for 15/04 and 15/06):** a tail re-plan runs `rangeRaptor` on the network's shared workspace. Do not call `retime` while a `plan()` generator on the same `net` is suspended between slices, because it would clobber `plan`'s labels. Finish or discard the plan first.
- **For 06:**
  - A retimed itinerary stays internally consistent (times monotonic, `CHANGE_SEC` kept), except in the `'missed-connection'` case. There, the shifted legs into the missed ride can end after it leaves, or less than `CHANGE_SEC` before it.
  - `id` changes only when a tail re-plan changes the rides.
  - The fixture case is `Lisa → KLCC` with `modes: ['feeder', 'lrt', 'mrt', 'monorail']` at 08:00 on 2026-10-28. Its fastest itinerary is T816 08:24:44 → walk → MRT KG (headway 360) → walk → LRT KJ (headway 240). A bus at `12000757` heading toward `12000762`, with its fix 1 min before the board, gives `deltaSec` 120, and every downstream time moves by exactly that.
- **Tests:**
  - `retime.test.ts`, 16 tests. The step 7 list, plus:
    - `liveNow`;
    - an access-walk `reachAt` case;
    - alias matching (label, raw GTFS id, wrong route, wrong category);
    - a delay that still makes the transfer;
    - order, tags and no input mutation.
  - `realtimePlan.test.ts`, +3 tests.
  - Mutation checks fail the suite: dropping `CHANGE_SEC` in propagation, `reachAt` ignoring the access walk, no catch margin, no stale-category gate, no next-bus fallback, and the tail ignoring `ctx.modes`.
- **Verification:**
  - `pnpm --filter @bus-tracker/shared test`: 369/369.
  - `pnpm --filter mobile test`: 297/297.
  - `pnpm type-check`: clean.
  - No device or Metro check was run; this is JS-only.
