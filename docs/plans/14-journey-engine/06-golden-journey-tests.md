# 14-Journey-Engine / 06 — Golden journeys and property tests

**Build impact:** JS-only (shared package; no app rebuild)

## Context
- README success criteria 1–3 and 5 are checked here:
  - 1: golden journeys against the 2026-10-23 fixtures;
  - 2: internal consistency over many queries;
  - 3: timing;
  - 5: stable ids.
  Criterion 4 (retime) is covered by task 05's tests and re-run on a captured live snapshot below.
- Fixtures: `packages/shared/src/transit/__fixtures__/2026-10-23/` (12/00 step 1), loaded through `fixtureNetwork()` (task 00). Service date `20261028`, a Wednesday inside every calendar (feeder `26100201`: 2026-10-22 to 2026-11-13; KTMB Komuter: 2026-08-18 to 2026-11-06; rail: to 2026-12-31).
- Ids verified against the feeds downloaded on 2026-10-23:
  - **Hotel Lisa De Inn** is feeder stop `12000759` (stop_code `PJ210`), at `3.118231, 101.63065`. T816 is a loop: `12000750` MRT Phileo Damansara Pintu A → … → `12000757` → `12000762` → `12000759` (seq 9) → … → `12000750` (seq 16).
  - **KLCC** is `KJ10` (`rail:KJ10`); station slug `klcc` (`packages/shared/src/data/rail-stations.ts:86`).
  - **KL Sentral:** station `kl-sentral` = `KJ15` + `MR1` (`rail-stations.ts:84`), plus KTM `19100`. **Bukit Bintang:** station `bukit-bintang` = `KG18A` + `MR6` (`:41`).
  - **Subang Jaya:** LRT `KJ28` (`:146`) and KTM `53700` (Port Klang Line).
  - **PJ Section 14:** Rapid KL stop `1000484` "PJ278 DIGITAL MALL SEKSYEN 14" at `3.110474, 101.636336`. It is served by PJ01, PJ02, T787 and 780; none of them reaches KL Sentral directly.
- Route labels follow 12/02 step 6: rail uses the line prefix (`KJ`, `KG`, `MR`), KTM uses `KTM Seremban` / `KTM Port Klang`, and buses use `routeCodeOf` (`T816`, `PJ02`, `780`).
- Spec §1 keeps Google Routes as a development benchmark only. No key is committed.

## Goal
Freeze end-to-end expectations for the five golden queries, and prove the planner's invariants on 200 seeded random queries, so later changes to the compiler, engine or ranking cannot silently degrade results.

## Prerequisites
- Tasks 00–05.

## Steps

1. **Outline helper** in `packages/shared/src/transit/__tests__/helpers/outline.ts`:
   ```ts
   export function outline(it: Itinerary): string;                  // legs → 'walk' | ride label, joined by '>'
   export function outlineMatches(pattern: string, actual: string): boolean; // same length; '*' = any one ride label
   ```
   Example: `'T816>walk>KG>walk>KJ'`. A bus stop and a rail stop are never the same stop, so a bus → rail change always has a walk leg between the rides. A snapped `stop`/`station` end has no walk at that end.

2. **Goldens** in `packages/shared/src/transit/__tests__/goldens.ts`:
   ```ts
   export interface Golden {
     name: string;
     exclude?: readonly FeedId[];                 // passed to fixtureNetwork
     query: PlanQuery;                            // walkMetersPerMin: 80
     expect: {
       outlines: string[];                        // at least one itinerary matches one of these
       arrive: string | null;                     // 'HH:MM' MYT of the matching itinerary, ±5 min; null until recorded
       first?: string;                            // outline required at index 0
       excludedFeeds?: FeedId[];                  // PlanResult.excludedFeeds must equal this (default [])
       allowedModes?: Mode[];                     // every ride leg's mode must be in this list
       minItineraries?: number;
     };
   }
   const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);   // 2026-10-28 08:00 MYT
   ```
   | # | name | from | to | expect |
   |---|---|---|---|---|
   | 1 | Hotel Lisa De Inn → KLCC | `stop` `12000759` (3.118231, 101.63065) | `station` `klcc` (3.158935, 101.713287) | `outlines: ['T816>walk>KG>walk>KJ']` (T816 to bus stop `12000750`, walk to `rail:KG12` Phileo Damansara, KG to Pasar Seni or Muzium Negara, change, KJ to KLCC) |
   | 2 | PJ Section 14 → KL Sentral | `place` "Digital Mall, Seksyen 14" (3.110474, 101.636336) | `station` `kl-sentral` (3.133636, 101.687034) | `outlines: ['walk>KJ', 'walk>*>walk>KJ', 'walk>*>walk>KG>walk', 'walk>*>walk']` |
   | 3 | Subang Jaya → Bukit Bintang | `place` "SS15, Subang Jaya" (3.0830, 101.5890) | `station` `bukit-bintang` (3.146262, 101.711224) | `outlines: ['walk>KTM Port Klang>walk>MR', 'walk>KJ>walk>MR', 'walk>KJ>walk>KG']` |
   | 4 | 300 m walk-only | `place` (3.118231, 101.63065) | `place` (3.120929, 101.63065) | `first: 'walk'`, and index 0 is tagged `fastest` |
   | 5 | Rail expired fallback | as #1, `exclude: ['rail']` | as #1 | `excludedFeeds: ['rail']`, `allowedModes: ['bus','feeder','ktm']` (bus/KTM only), `minItineraries: 1` |
   - All five depart at `AT_0800`.
   - #3: spec §4.4 describes it as "KTM → LRT → Monorail". On this network a KTM ride to KL Sentral changes straight to the Monorail, so the list accepts every reasonable outline rather than encoding that description (reported upward).

3. **Golden test** `packages/shared/src/transit/__tests__/journeys.test.ts`:
   - For each golden, call `planSync(fixtureNetwork({ exclude }), query)` → `{ itineraries, excludedFeeds }`. Assert:
     - `excludedFeeds` deep-equals `expect.excludedFeeds ?? []`;
     - 1–5 itineraries (at least `minItineraries`);
     - one matches `expect.outlines` (and its `arriveAt` is within ±5 min of `expect.arrive` when that is set);
     - `first` and `allowedModes` when given;
     - no itinerary warning outside `ItineraryWarning` (feed expiry never appears in `warnings`).
   - `ids are stable across retime`: `retime(its, { byCategory: {} }, net, { to, walkMetersPerMin: 80 })` keeps every `id`.
   - **Recording:** with `GOLDEN_REPORT=1`, print one line per itinerary (`name | outline | depart HH:MM | arrive HH:MM | rides | walk m | tags | warnings`, plus `excludedFeeds` per golden), formatted with `secondsToClockHHMM` (`packages/shared/src/utils/gtfs-time.ts:25`).
     - Review it against the Google Maps check in step 6, then paste the `arrive` values into `goldens.ts`.
     - Never write files from a test.

4. **Live snapshot check** (README criterion 4 on real data):
   - Capture one feeder vehicle-position protobuf on a weekday between 07:00 and 09:00 MYT into `__fixtures__/2026-10-23/rt-feeder-0800.pb`: `curl -L -o … "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder"` (`vehiclePositionsUrl`, `packages/shared/src/utils/categories.ts:101`). Record the capture time in the fixture README.
   - In `journeys.test.ts`: `decodeFeed` (`packages/shared/src/utils/protobuf.ts:153`) → `entitiesToPositions(feed, new Map(), capturedAt, aliases)` (`packages/shared/src/utils/realtime.ts:74`), where `aliases` come from `plannerRealtimeRoutes`. Then run `retime(its, { byCategory: { 'rapid-bus-mrtfeeder': { asOf: capturedAt, positions } } }, net, ctx)` on golden #1 planned at the capture time.
   - Assert that it does not throw, that ids are unchanged unless a re-plan happened, and that any `live` leg satisfies `from.time ≥ reach + 60 s`.

5. **Property test** `packages/shared/src/transit/__tests__/properties.test.ts`:
   - Seeded RNG `mulberry32(20261028)`, inline in the test. 200 queries:
     - 100 origin/destination pairs uniform in the bbox (lat 2.70–3.45, lon 101.25–101.95, spec §3.1);
     - 100 drawn from random network stops, jittered by up to ±0.003° (stops get coverage; the bbox gets empty and edge cases);
     - `departAt` uniform over 06:00–21:00 on 2026-10-28, whole minutes;
     - `walkMetersPerMin` drawn from `[60, 80, 100]`;
     - `kind: 'place'` for both ends.
   - Run `planSync(net, q)`. Assert `excludedFeeds` is `[]` on the full fixture network, then for every entry of `itineraries`, check:
     1. `legs.length ≥ 1`, `rides ≤ 4`, ≤ 5 itineraries, ids unique within a result, and `tags ⊆ {fastest, fewer-changes, less-walking}` with `fastest` only on index 0.
     2. **Monotonic times:** `from.time ≤ to.time`; `via` non-decreasing and inside the leg; `legs[i].to.time ≤ legs[i+1].from.time`; `departAt ≥ query.departAt`; `arriveAt > departAt`.
     3. **Continuity:** consecutive legs meet at the same `stop` (or the same coordinates for place points).
     4. **Transfers:** between two ride legs, `next.from.time ≥ prev.to.time + Σ(walk seconds between) · 1000`. With no walk between them, it also needs `+ CHANGE_SEC · 1000` and the same `stop`.
     5. **Walk limits:** a first or last walk leg has `meters ≤ 1000 × 1.25 + 1` (or `≤ 2000` for walk-only); a walk-only itinerary exists only if its `meters < 2000`; there are never two walk legs in a row.
     6. **Fastest:** index 0 has the minimum `arriveAt` in the result.
   - On failure, print the query JSON and the offending itinerary.
   - Log p50 and p95 `planSync` ms over the 200 queries. This is information only; the README criterion 3 gate is the bench script.

6. **Manual Google Maps check** (development only; no API key in the repo). Plan each golden in the Google Maps app (Transit, depart Wed 28 Oct 08:00) and fill in:

   | # | BusBuddy outline / arrive | Google Maps outline / arrive | Δ arrive | Note |
   |---|---|---|---:|---|
   | 1 | | | | |
   | 2 | | | | |
   | 3 | | | | |
   | 4 | | | | |
   | 5 | | n/a (rail excluded) | | |

   A Δ over 10 min, or a mode missing on our side, gets a note and an issue. It is not a test failure.

7. **Cleanup:** delete the task 00 harness `apps/mobile/app/dev-planner.tsx` and its Settings row. Keep `scripts/bench-raptor.ts`.

## Verification
- `pnpm --filter @bus-tracker/shared test`: goldens, live snapshot and properties all pass.
- `GOLDEN_REPORT=1 pnpm --filter @bus-tracker/shared test` prints the review table.
- `pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts`: Node p95 < 60 ms per golden query (README criterion 3).
- `pnpm type-check` and `pnpm --filter mobile test`.
- Manual: task 00's Release-build numbers still hold after 01–05. Re-run the harness once before deleting it; p95 < 400 ms.

## Handoff to next step ([../15-journey-planner-ui/README.md](../15-journey-planner-ui/README.md))
- `plan` / `planSync` (returning `PlanResult`), `retime` (with required `ctx`), the spec §4.4 types, `LiveSnapshot` and `plannerRealtimeRoutes` are frozen behind goldens and property tests. Phase 15's `usePlanner` calls only these.
- The task 00 Results fix the window and where `plan()` runs (JS thread or worklet). 15/04 adopts it.
- Open items carried forward: arrive-by (reverse RAPTOR), interchange times still `verified: false`, holiday calendars for rail and bus-kl. Feed-expiry banners come from `PlanResult.excludedFeeds`, and the "Scheduled" fallback from `snapshot.plannerSkipped` (05).
