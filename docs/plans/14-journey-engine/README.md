# Phase 14 — Journey Engine (RAPTOR on the phone)

A pure-TypeScript, frequency-aware **range RAPTOR** planner in `packages/shared/src/transit/` that turns (from, to, depart time) into up to five ranked door-to-door itineraries across walking, feeder/city buses, LRT/MRT/Monorail/BRT and KTM Komuter — then **re-times bus legs with live GTFS-R positions**.

Spec: [`docs/design/transit-and-planner.md`](../../design/transit-and-planner.md) §4. Engine API and data shapes there are binding.

## Dependencies

- Phase 12 (`TransitNetwork`, transfers, fixtures).
- Existing shared utils: `computeEta`, `resolveRouteAlias`, `haversineMeters`, `toMalaysiaParts`, `gtfsTimeToSeconds`.
- No UI, no native code. Everything here runs under `node --test` (tsx) and in Hermes.

## Scope decisions (locked)

- **Algorithm:** RAPTOR, max 4 rides, range query 40 min in 2-min steps (rRAPTOR label reuse). No McRAPTOR in v1; diversity comes from Pareto (depart, arrive, rides) + post-ranking.
- **Frequency boarding:** `board = max(t, fStart) + headway/2` while `≤ fEnd`; downstream via template `runOffset`.
- **Walking:** straight line × 1.25 at `walkMetersPerMin` (default 80 m/min; no settings field exists — `walkMinutes` is the walk to your stop); access/egress ≤ 1,000 m, ≤ 25 stops each side; walk-only option < 2 km. Real walking paths only for display (phase 15).
- **Realtime:** plan on timetable, then `retime()` the first bus leg within 60 min via `computeEta`; re-plan the tail if a transfer breaks. Rail is never "live".
- **Arrive-by:** out of scope for v1 (reverse RAPTOR is a follow-up).
- **Fares:** out of scope (not in feeds).
- **Runs on the JS thread, yielding between rounds** (generator). Escalation if over budget: smaller window → worklet runtime → `apps/api` fallback.

## Success criteria

1. Golden journeys (task 06) pass against 2026-10-23 fixtures: Hotel Lisa De Inn → KLCC; PJ Section 14 → KL Sentral; Subang Jaya → Bukit Bintang; 300 m walk-only; rail-expired fallback returns bus/KTM-only itineraries with `excludedFeeds` containing `'rail'`.
2. Every returned itinerary is internally consistent: times monotonic, transfers ≥ min transfer time, walk legs ≤ limits (property test).
3. `plan()` p95 < 400 ms JS time on iPhone 13 release build for the golden queries (task 00 harness), < 60 ms in Node.
4. `retime()` with a fixture vehicle snapshot marks the first bus leg `live`, shifts downstream times, and re-plans when a transfer is missed.
5. Itinerary `id` is stable across `retime()` calls (same legs → same id).

## Skills to invoke

- `poteto-mode` (task 00 = Prototype playbook), `superpowers:test-driven-development` (01–06).

## Task order

0. [00-prototype-raptor-benchmark.md](./00-prototype-raptor-benchmark.md) — minimal RAPTOR on fixtures in Node + an on-device timing harness; decide JS-thread vs worklet.
1. [01-raptor-core.md](./01-raptor-core.md) — rounds, route marking, pluggable boarding (timetable + frequency), footpaths.
2. [02-range-query-and-ranking.md](./02-range-query-and-ranking.md) — rRAPTOR window, Pareto, score, top-5 + tags.
3. [03-access-egress-walk.md](./03-access-egress-walk.md) — nearest stops via grid, walk-only option, mode filters.
4. [04-itinerary-reconstruction.md](./04-itinerary-reconstruction.md) — journey pointers → `Itinerary`/`Leg`, stable ids, warnings.
5. [05-live-retiming.md](./05-live-retiming.md) — `retime()` with `LiveSnapshot`, tail re-plan, realtime subscription plan.
6. [06-golden-journey-tests.md](./06-golden-journey-tests.md) — fixtures, goldens, property tests, Google Routes spot-check notes.

## Hand-off (post phase)

- `plan()` and `retime()` exported from `@bus-tracker/shared`. Phase 15 calls them through a `usePlanner` hook; it never reaches into engine internals.
- Benchmark numbers recorded in task 00's Results section.
