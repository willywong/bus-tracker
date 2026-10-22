# Phase 12 — Transit Network (rail + city bus + KTM data layer)

BusBuddy today holds GTFS only for the bus routes a user follows. This phase gives the phone a **whole Klang Valley network** — rail (LRT/MRT/Monorail/BRT), Rapid KL city buses, MRT feeders and KTM Komuter — compiled once per service day into a compact, typed-array `TransitNetwork` that phases 13 (rail screens) and 14 (routing engine) read.

Spec: [`docs/design/transit-and-planner.md`](../../design/transit-and-planner.md) §1 and §3. Read it first; this phase implements it.

## Dependencies

- Phases 00–11 complete (the app as of commit `b4066c7`). Reused: `packages/shared` GTFS parser (`parseGtfsZip`, `scanCsvColumnsSteps`, `expandFrequencies`), `categories.ts` (`namespaceId`), `rail.ts` + `data/rail-stations.ts`, mobile `services/gtfsFeed.ts`, SQLite (`db/schema.ts` v7).
- No new native modules. **JS-only** (Metro reload) for the whole phase.

## Scope decisions (locked)

- **On-device compile, no server.** `compileNetwork` runs in `packages/shared` (pure TS) and is driven by the app. The `apps/api` prebuilt-blob path is a documented fallback only (task 00 decides).
- **Feeds:** `rapid-rail-kl`, `rapid-bus-kl`, `rapid-bus-mrtfeeder`, `ktmb` (Komuter lines inside the Klang Valley bbox only). Penang/Kuantan are excluded from routing.
- **Headway rule:** every rail window, and bus windows with `headway_secs ≤ 720`, stay turn-up-and-go (`freq*` arrays); longer bus headways expand to concrete trips with `expandFrequencies`.
- **Transfer precedence:** curated interchange > same station (180 s) > proximity (250 m). Most specific wins, not smallest.
- **One static-request limiter** in `services/gtfsFeed.ts` for every zip download (refresh, prewarm, on-demand): ≤ 3 per rolling 60 s.
- **One network per service date** (today + tomorrow), stored as one BLOB in SQLite `network_blobs`. Previous blob served until the new one completes.
- **Stop ids:** feeder ids stay raw (compat with settings/SQLite); others namespaced (`kl:`, `rail:`, `ktm:`).
- **Expired feeds are excluded**, never silently mixed in (spec §3.6).
- **Static request budget:** feeds fetched sequentially ≥ 16 s apart (data.gov.my: 4 req/min per family).

## Success criteria

1. `pnpm --filter @bus-tracker/shared test` passes, including new network-compiler tests against fixture zips captured 2026-10-23.
2. Compiling the fixture feeds for 2026-10-28 yields per-feed counts within ±5% of task 00's measured baseline (rail 187 stops / 16 patterns; bus-kl ≈4.07k / ≈171; feeder ≈2.12k / ≈92; KTM = Komuter-in-bbox subset, recorded in task 00), trip-equivalents (concrete trips + departures implied by frequency windows) ≈12k, and every curated interchange id resolves to a real stop.
3. A serialised network round-trips byte-identically and its BLOB is < 6 MB.
4. On an iPhone (13 or newer, release build) the full refresh + compile completes in < 4 s of JS time without a dropped-frame stall > 100 ms (measured in task 00 / re-checked in 06).
5. Airplane mode after one successful build: the network still loads for today.
6. Setting the device date past 2026-12-31 marks rail `expired`, excludes it, and surfaces the state through `useTransitNetwork().health`.

## Skills to invoke

- `poteto-mode` (Feature playbook; task 00 uses the Prototype playbook), `superpowers:test-driven-development` for 01–05, `write-swift` not needed (no native code).

## Task order

0. [00-prototype-network-sizing.md](./00-prototype-network-sizing.md) — capture fixtures, measure parse + compile on device, decode KTMB RT live; decide device vs server build.
1. [01-shared-types-and-modes.md](./01-shared-types-and-modes.md) — optional GTFS fields, `Mode`, `FeedId`, `RailMode` + KTM.
2. [02-rail-and-ktm-normalisation.md](./02-rail-and-ktm-normalisation.md) — BOM, `AGL`/`AG`, unpadded times, lon/lat, title case, Komuter + bbox filter.
3. [03-network-compiler.md](./03-network-compiler.md) — patterns, trips, frequency windows, `stopRoutes`, grid; chunked generator.
4. [04-transfers-and-interchanges.md](./04-transfers-and-interchanges.md) — proximity footpaths, same-station, curated `rail-interchanges.ts`.
5. [05-network-serialisation.md](./05-network-serialisation.md) — binary encode/decode, versioning.
6. [06-mobile-feed-refresh-and-store.md](./06-mobile-feed-refresh-and-store.md) — staggered downloads, `network_blobs` table, `useTransitNetwork` provider.
7. [07-feed-health.md](./07-feed-health.md) — `ok/expiring/expired`, Settings → Data sources rows, CC BY 4.0 credit.

## Hand-off (post phase)

- `useTransitNetwork()` returns `{ network, health, status }` app-wide. Phases 13 and 14 consume it read-only.
- `packages/shared/src/transit/` exists with `network.ts`, `compile.ts`, `transfers.ts`, `serialize.ts` and fixture tests.
- Known limits carried forward: no holidays for rail/bus-kl, unverified interchange times, KTM has no shapes (straight segments between stations).
