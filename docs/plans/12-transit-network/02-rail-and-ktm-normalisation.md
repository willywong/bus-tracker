# 12-Transit-Network / 02 — Rail and KTM normalisation (chunked feed reader)

**Build impact:** JS-only (Metro reload)

## Context
Verified feed quirks (2026-10-23), and what the code already does about them:

| Quirk | Current handling | Left to do |
|---|---|---|
| rail `stop_times.txt` UTF-8 BOM | Already stripped: `parseCsvTable` (`packages/shared/src/utils/gtfs-parser.ts:82`), `forEachCsvRow` (`:131`) and `scanCsvColumnsSteps` (`:183`) | Regression test on the real fixture |
| `stop_times.route_id` `AGL` vs `trips.route_id` `AG` | The parser never reads `stop_times.route_id` (columns at `gtfs-parser.ts:297`); the route comes from `trips.txt` | Test that every trip resolves to a route |
| Unpadded times `6:00:00` | `gtfsTimeToSeconds` accepts 1–3 hour digits (`packages/shared/src/utils/gtfs-time.ts:5`) | No test covers it yet (`utils/__tests__/gtfs-time.test.ts` only has padded cases) |
| `shapes.txt` lon before lat | Not handled; `parseGtfsZip` trusts the header names (`gtfs-parser.ts:314`) | Fix (both cases, see task 00 Results) |
| Stop names ALL CAPS, trailing spaces | Trailing spaces trimmed (`field()` at `gtfs-parser.ts:211`, `parseCsv` at `:204`). Title case lives only in the script (`packages/shared/scripts/build-rail-stations.ts:111` `stripSponsor`, `:127` `titleCase`) | Move it to shared code |
| `stops.geometry` = `[object Object]` | Ignored (named columns only) | Test |
| KTMB is national: ETS, intercity, Komuter | Not handled | Keep `Seremban Line` (`KC05_KB18`) and `Port Klang Line` (`KA15_KD19`) inside lat 2.70–3.45, lon 101.25–101.95 |
| KTMB has no `shapes.txt` | n/a | `shapeId` is `''`, and legs draw straight |

- Rail line identity (mode, colour, code) is already resolved in `RAIL_LINES` (`packages/shared/src/data/rail-stations.ts:18`). It is keyed by stop-id prefix (`build-rail-stations.ts:189`–`198`), and the colours are contrast-fixed there (MRT PY text is black).
- Bus-kl ids are namespaced with `namespaceParsedGtfs` (`packages/shared/src/utils/categories.ts:177`). Rail and KTM need the same treatment: their `service_id`s (such as `MonFri`, `weekday`) can collide across feeds.
- The chunked building blocks are module-private in `packages/shared/src/utils/search-routes.ts`: `runInSlices` (`:116`), `unzipSteps` (`:180`), `hasZipEnd` (`:208`) and `drain` (`:220`).

## Goal
`readFeedSteps(zip, feed)` is a generator that turns one raw zip into a `NormalisedFeed`, yielding every few ms. The result has namespaced ids, display names, route metadata (label, mode, colours) and validity dates. KTM is cut to Komuter inside the Klang Valley.

## Prerequisites
- Task 01 (`FeedId`, `FEED_INFO`, `namespaceFeedId`, optional route fields).
- Task 00 fixtures and Results (shape order).

## Steps

1. **Extract the stepping helpers** into `packages/shared/src/utils/steps.ts`, a move with no behaviour change:
   - Export `runSteps<T>(steps: Generator<void, T, void>, sliceMs = 8): Promise<T>`, renamed from `runInSlices`.
   - Export `unzipSteps`, `hasZipEnd`, `drain` and `UNZIP_STEP_BYTES`.
   - `search-routes.ts` imports them from there.
   - Export `runSteps` from `packages/shared/src/utils/index.ts`.
   - The existing `search-routes.test.ts` must pass untouched.

2. **Display names:** create `packages/shared/src/transit/names.ts`.
   - Move `SPONSOR_SUFFIXES`, `UPPERCASE_WORDS`, `SPECIAL_WORDS`, `stripSponsor`, `titleWord`, `titleCase`, `nameKey` and `slug` there from `build-rail-stations.ts:67`–`144`, and make the script import them.
   - Add `displayStopName(feed: FeedId, raw: string): string`:
     - rail and ktm: `titleCase(stripSponsor(raw.trim()))`;
     - bus feeds: `raw.trim()`, unchanged.
   - Regenerating `rail-stations.ts` must produce a byte-identical file. Check with `git diff --exit-code`.

3. **Types** in `packages/shared/src/transit/feeds.ts`:
   ```ts
   export interface RouteMeta { label: string; longName: string; mode: Mode; color: string; textColor: string }
   export interface NormalisedFeed {
     feed: FeedId;
     parsed: ParsedGtfs;                 // ids namespaced; stops filtered (ktm); shapes empty unless asked
     routeMeta: Map<string, RouteMeta>;  // by namespaced route_id
     stopNames: Map<string, string>;     // namespaced stop_id → display name
     validFrom: string; validUntil: string; // 'YYYYMMDD': min start_date / max(end_date, added calendar_dates)
   }
   export interface ReadFeedOptions { shapes?: boolean }
   export function readFeedSteps(zip: Uint8Array, feed: FeedId, opts?: ReadFeedOptions): Generator<void, NormalisedFeed, void>;
   export function readFeed(zip: Uint8Array, feed: FeedId, opts?: ReadFeedOptions): NormalisedFeed; // drains the generator; for tests & scripts
   ```
   - `readFeedSteps` inflates only the files it needs:
     - `routes`, `stops`, `trips`, `stop_times`, `calendar`, `calendar_dates` and `frequencies`;
     - `shapes` only when `opts.shapes` is set.
   - It inflates them via `unzipSteps` and scans each with `scanCsvColumnsSteps`. It builds the same row objects as `parseGtfsZip`, so `expandFrequencies` and the other existing helpers accept them.
   - Drop trips that have no stop_times. data.gov.my withholds about 2% of bus-kl trips; see `filterToRoutes` at `packages/shared/src/utils/t816-bundle.ts:80`.

4. **Namespacing:**
   - bus-kl: call `namespaceParsedGtfs(parsed, 'rapid-bus-kl')`.
   - rail and ktm: add `namespaceParsedFeed(parsed, feed)` in `feeds.ts`. It mirrors `categories.ts:177`–`209`, using `namespaceFeedId`.
   - feeder: unchanged (raw ids).

5. **Shapes:** add `fixShapePoint(p: GtfsShapePoint): GtfsShapePoint`. It swaps lat and lon when `Math.abs(p.shape_pt_lat) > 90`. Klang Valley longitudes are about 101, so they can never be a latitude.
   - Apply it to every point when `opts.shapes` is set.
   - Phase 13 stores rail shapes with it.

6. **Route metadata** (`routeMeta`):
   - **rail:**
     - Find the stop-id prefix used by most of the route's stops. Use the same rule as `build-rail-stations.ts:189`–`198`, on raw ids before namespacing.
     - Find the `RAIL_LINES` entry whose `code` ends with that prefix (`BRT` matches `code === 'BRT'`).
     - Take `mode` from `RAIL_MODE_TO_MODE[line.mode]`, take `color` / `textColor` from that entry, set `label` to the prefix (`'KJ'`) and `longName` to `line.name`.
     - If no entry matches, throw `Error('rail route <id>: unknown line prefix <p>')`.
   - **ktm:**
     - Keep a route only if `route_long_name.trim()` is `Seremban Line` or `Port Klang Line`.
     - Set `mode: 'ktm'`, `label` to `'KTM Seremban'` / `'KTM Port Klang'` and `longName` to `'KTM Komuter ' + route_long_name`.
     - Take `color` from `#${route_color}`, falling back to `#3C5A9F`. Take `textColor` from `#${route_text_color}`, falling back to `#FFFFFF`.
   - **bus-kl / feeder:** `mode: 'bus'` / `'feeder'`, and `label = routeCodeOf(route)` (`categories.ts:110`).
     - `longName = route_long_name ?? label`, `color = '#000000'` and `textColor = '#FFFFFF'`, because buses stay ink (spec §2).

7. **KTM cut:**
   - Drop the trips of routes that are not kept.
   - Then drop `stop_times` whose stop lies outside the bbox. Seremban Line runs on to Pulau Sebang and Tampin, outside it.
   - Keep a trip only if ≥ 2 in-bbox stop_times remain.
   - Finally, keep only the stops still referenced.
   - Assert the kept rows of each trip are **contiguous** in `stop_sequence`, so a trip cannot leave the bbox and come back. Throw if they are not; this flags a feed change.

8. **Validity:**
   - `validFrom` = min `calendar.start_date`.
   - `validUntil` = max of `calendar.end_date` and of every `calendar_dates` row with `exception_type = 1`.
   - Rail on 2026-10-23: the `MonFri`/`MonThu`/`Fri`/`Sat`/`Sun`/`SatSun` services end 20261231, and the old `weekday`/`weekend` ended 20260331, so `validUntil` = `20261231`.
   - KTMB: `20261106`. bus-kl: `20270331`.

9. **Tests**, in `packages/shared/src/transit/__tests__/feeds.test.ts` against the fixtures at `__fixtures__/2026-10-23/`:
   - `rail stop_times BOM does not hide trip_id`: every rail trip has stop_times.
   - `rail trips resolve to routes.txt despite AGL/AG in stop_times`.
   - `rail times like 6:00:00 parse`. Also add `gtfsTimeToSeconds parses unpadded hours` to `utils/__tests__/gtfs-time.test.ts`: `"6:00:00"` → 21600.
   - `rail stop names are title case without trailing spaces`: e.g. `rail:KJ15` → `KL Sentral`, matching the name in `RAIL_STATIONS`.
   - `rail stops ignore the geometry column`: every lat in 2.7–3.45.
   - `fixShapePoint swaps lon,lat and leaves good points alone`, plus `rail shapes land inside the Klang Valley bbox` with `{ shapes: true }`.
   - `ktm keeps only Seremban and Port Klang lines inside the bbox`: route ids `ktm:KC05_KB18` and `ktm:KA15_KD19`; no stop outside the bbox; no ETS route.
   - `validUntil per feed` with the values from step 8.
   - `ids are namespaced per feed and feeder stays raw`.
   - `readFeedSteps yields`: draining the bus-kl fixture yields more than 50 times.
   - Plus a synthetic-zip case for the KTM contiguity throw.

## Verification
- `pnpm --filter @bus-tracker/shared test`: the new tests, the existing `search-routes.test.ts` and `gtfs-parser.test.ts` all pass.
- `pnpm type-check`.
- `pnpm -C packages/shared exec tsx scripts/build-rail-stations.ts packages/shared/src/transit/__fixtures__/2026-10-23/rapid-rail-kl.zip 2026-10-19 && git diff --stat packages/shared/src/data/rail-stations.ts`: the only allowed diff is real feed changes in the header and data. The names logic must not change. If the data did change, revert the file, because regenerating it is out of scope.

## Handoff to next step ([03-network-compiler.md](./03-network-compiler.md))
- `readFeedSteps(zip, feed)` and `readFeed` return a `NormalisedFeed`:
  - namespaced ids;
  - display names;
  - `routeMeta` with mode, label and colours;
  - `validFrom` / `validUntil`.
- KTM is already cut to Komuter in the bbox.
- `runSteps`, `unzipSteps` and `drain` are exported from `packages/shared/src/utils/steps.ts`.
- `titleCase` and friends live in `packages/shared/src/transit/names.ts`; the rail-stations script imports them.

## Implementation notes
- **KTM line match uses `route_short_name`, not `route_long_name`.** The KTMB fixture has `Seremban Line` / `Port Klang Line` in `route_short_name`. Its `route_long_name` is `KTM Batu Caves - Pulau Sebang/Tampin`. So `longName` = `'KTM Komuter ' + route_short_name`, e.g. `KTM Komuter Seremban Line`.
- **`validFrom` / `validUntil` count only services that kept trips use** (spec §3.1: "across active services"). Otherwise ETS/intercity rows could mask an expired Komuter calendar. The fixture values are unchanged: rail 20190101–20261231, KTM 20261106, bus-kl 20270331.
- **Rail shapes are not swapped in the fixture.** The header is `lon,lat`, but each value sits under its own header. `fixShapePoint` is therefore a defensive no-op on these fixtures, and a synthetic test covers the swap.
- **Rail line lookup is `code === prefix || code.endsWith(' ' + prefix)`.** This is "ends with" on whole words, so a one-letter prefix cannot match the wrong line.
- **Timed trips are collected during the `stop_times` scan, not in a second pass.** This keeps the longest synchronous step at about 6 ms on Node for the feeder. `namespaceParsedGtfs` now also namespaces the new `parent_station` field.
- **Regenerating `rail-stations.ts` from the 2026-10-23 fixture is byte-identical to the pre-move script's output.** It differs from the committed file only in the header and the line constants: the feed dropped the mode prefix from the line names, and SA is now `#FF00FF`. The file was reverted, as instructed.
