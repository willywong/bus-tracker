# 12-Transit-Network / 00 — Prototype: fixtures, sizing and on-device timing

**Build impact:** JS-only (Metro reload). Measurements need a **release** build on a real iPhone, but no native code changes.

## Context
- Spec §1 table and §3.5 were sized with a throwaway Python script on 2026-10-23 (weekday 2026-10-28): rail 187 stops / 16 patterns / 2,727 expanded trips; bus-kl 4,068 / 171 / 5,830; feeder 2,117 / 92 / 3,443; ktmb 155 / 88 / 305; ≈385k stop events in total. That script is not in the repo, and nothing has been measured on Hermes.
- The four zips come from `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl|rapid-bus-kl|rapid-bus-mrtfeeder` and `https://api.data.gov.my/gtfs-static/ktmb`. The two bus URLs are already in `BUS_CATEGORY_INFO` (`packages/shared/src/utils/categories.ts:53`). Rail and KTMB are not.
- The parse path that exists today is `parseGtfsZip` (`packages/shared/src/utils/gtfs-parser.ts:232`). It is synchronous: `unzipSync` plus a whole-file `scanCsvColumns`. The chunked path is `scanCsvColumnsSteps` (`gtfs-parser.ts:159`) driven by `runInSlices` / `unzipSteps` (`packages/shared/src/utils/search-routes.ts:116`, `:180`). Frequencies expand with `expandFrequencies` (`packages/shared/src/utils/t816-bundle.ts:203`).
- `docs/design/research/data-capabilities.md:61` and `:126` say KTMB realtime carries only ETS (`ETS301`–`ETS310`). That was decoded from a third-party fixture, not live at Komuter hours. Spec §9 asks for a live re-decode.
- Playbook: **Prototype** (poteto-mode). This task produces numbers and a decision. Nothing in it is production code, and the device harness is deleted in task 06.

## Goal
Capture dated fixture zips for every later test, then measure the real network size and the cost of parsing and compiling on an iPhone. Use the numbers to decide between the on-device build and the `apps/api` prebuilt-blob fallback, and record whether KTMB realtime carries Komuter trains.

## Prerequisites
- None in this phase. You need a physical iPhone (13 or newer) with a release-configuration dev build, plus Xcode for the memory gauge.

## Steps

1. **Capture fixtures** into `packages/shared/src/transit/__fixtures__/2026-10-23/`:
   ```sh
   D=packages/shared/src/transit/__fixtures__/2026-10-23
   mkdir -p $D
   curl -L -o $D/rapid-rail-kl.zip       "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"
   sleep 16; curl -L -o $D/rapid-bus-kl.zip        "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl"
   sleep 16; curl -L -o $D/rapid-bus-mrtfeeder.zip "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder"
   sleep 16; curl -L -o $D/ktmb.zip                "https://api.data.gov.my/gtfs-static/ktmb"
   ```
   - The 16 s sleeps keep the run under 4 requests per minute.
   - If the date has moved on, use the real capture date in the folder name and in every later reference.
   - Add `$D/../README.md` covering the source URLs, the capture date and SHA-256 of each zip, and the licence line "Data: data.gov.my (Prasarana, KTMB), CC BY 4.0. Redistributed unmodified for tests."
   - Expect about 3.8 MB of zips in git. They sit outside `src/**/__tests__/*.test.ts` (the test glob in `packages/shared/package.json`) and outside the tsup entries (`packages/shared/tsup.config.ts`), so they are never bundled.

2. **Confirm the quirks by hand** and note the answers in the fixture README. Later tasks rely on them:
   - Is the rail `shapes.txt` header in lon,lat order with correct values, or are the values swapped under `shape_pt_lat`/`shape_pt_lon` headers? Task 02 handles both, but record which.
   - Is the `geometry` column on `stops.txt`?
   - Do rail `frequencies.txt` headways go above 720 s? The spec gives 180–840 s; count the windows over 720 s.
   - List the KTMB `route_id` / `route_long_name` pairs, plus the `calendar.txt` start and end dates for every feed.

3. **Port the sizing script** to `packages/shared/scripts/network-sizing.ts`. Run it with `pnpm -C packages/shared exec tsx scripts/network-sizing.ts <dir> <YYYYMMDD>`.
   - For each zip, parse with `parseGtfsZip`, keep trips whose `service_id` is active on the date, and expand them with `expandFrequencies`.
     - Use calendar day-of-week + date range, then `calendar_dates` add/remove, with the same semantics as `getActiveServiceIdsForDate` in `apps/mobile/db/queries.ts:274`.
   - Count four things: stops, patterns (distinct `route_id|direction_id|stop_id sequence`), expanded trips, and stop events.
   - Also count the turn-up-and-go windows (`headway_secs ≤ 720`), and the trips that remain after expanding only the windows over 720 s.
   - Print a table in the same shape as spec §1, plus a row for KTMB filtered to `Seremban Line` and `Port Klang Line` inside lat 2.70–3.45, lon 101.25–101.95.
   - Estimate the Int32 bytes as `4 × (2 × stopEvents_after_rule + patterns' stop slots × 2 + …)` and print it.

4. **On-device harness** (throwaway). Create `apps/mobile/app/dev-network.tsx`:
   - The screen renders `null` unless `__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1'`. The env flag lets the release build measure.
   - Reach it from a temporary `LabeledContent` row in the About section of `apps/mobile/app/settings.tsx:163`, behind the same flag.
   - It fetches the four zips sequentially, ≥ 16 s apart, then runs two passes with a **Run** button:
     - **Sync pass:** time `parseGtfsZip` for each feed, then a spike compile inlined in the screen file. The spike groups trips into patterns, sorts them, and fills `Int32Array`s of the sizes from step 3. Record the wall time for each stage with `performance.now()`.
     - **Sliced pass:** the same work driven as generators (`unzipSteps` + `scanCsvColumnsSteps`, with the spike compile yielding every 2,048 rows) through a `runInSlices` copy with `sliceMs = 8`.
       - Record the total time and the longest single slice.
       - Record the longest frame gap, from a `requestAnimationFrame` loop running alongside.
   - **Peak memory:** read the Xcode debug-navigator memory gauge before and after a run. If `HermesInternal?.getInstrumentedStats` exists, also log `js_heapSize` / `js_allocatedBytes`.
   - Show the results in a monospaced `Text`, and add a Copy button.

5. **KTMB realtime decode.** Add `packages/shared/scripts/decode-ktmb-rt.ts`:
   - It fetches `https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb`, decodes with `decodeFeed` (`packages/shared/src/utils/protobuf.ts:153`), and prints the entity count, each `vehicle.label`, `trip.route_id` and position.
   - Run it at least 3 times between 07:00 and 22:00 MYT on a weekday, ≥ 16 s apart.
   - Record whether any label or position is a Komuter train: non-`ETS` labels, or positions on the Seremban or Port Klang corridors.

6. Run the measurements on an iPhone 13 or newer, in a release build on battery, three runs each, and fill in **Results**.

## Verification
- `ls -la packages/shared/src/transit/__fixtures__/2026-10-23/` shows 4 zips and a README.
- `pnpm -C packages/shared exec tsx scripts/network-sizing.ts packages/shared/src/transit/__fixtures__/2026-10-23 20261028` prints counts within ±5% of spec §1 for the unfiltered feeds.
- `pnpm --filter @bus-tracker/shared test` and `pnpm type-check` still pass. The harness compiles, but the scripts are outside `tsconfig` `include`.
- Manual: the harness numbers are pasted into **Results** with device model and iOS version.

## Results
Measured 2026-10-23 on the **iOS Simulator** (iPhone 17 Pro Max, iOS 27.0, host Apple M5 Pro), not on an iPhone 13. The app was a dev-client build with Metro serving production JS (`--no-dev --minify`, `EXPO_PUBLIC_DEV_TOOLS=1`). The four zips came from a fixture server on the Mac rather than data.gov.my, so download times are not representative. The code is the same in both: `packages/shared/scripts/network-bench.ts`, run by `apps/mobile/app/dev-network.tsx` and by `scripts/run-network-bench.ts` (Node).

| Measure | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Device / iOS / build config | Sim 17 Pro Max / 27.0 / prod JS | same | same |
| Download, 4 zips (s, incl. stagger) | n/a (local fixture server, < 0.1 s) | – | – |
| Sync parse, all feeds (ms), from the `sliceMs` 12 session | 1,618 | 1,572 | 1,562 |
| Sync spike compile (ms) | 241 | 239 | 234 |
| Sliced total parse + compile, `sliceMs` 8 (ms, wall / busy) | 3,586 / 2,143 | 3,769 / 2,180 | 3,712 / 2,165 |
| Sliced total parse + compile, `sliceMs` 12 (ms, wall / busy) | **2,199 / 1,892** | **2,203 / 1,910** | **2,217 / 1,916** |
| Longest slice (ms), 8 / 12 | 20.8 / 22.8 | 21.5 / 21.6 | 27.9 / 26.1 |
| Longest frame gap during compile (ms), 8 / 12 | 20.9 / 22.8 | 21.5 / 21.6 | 28.0 / 26.2 |
| Peak memory delta (MB) | not measured (no Xcode gauge on the Simulator run); Hermes heap after run 88–101 MB, whole app | | |
| Network typed arrays, measured (MB) | 2.62 | 2.62 | 2.62 |

- Spike network built: 6,527 stops, 297 patterns, 9,064 trips, 310,651 stop events, 211 frequency windows. KTMB is Komuter routes only, with no bbox filter.
- **Per-stage costs** (sliced pass, 12 ms):
  - bus-kl ≈ 0.72 s and feeder ≈ 1.17 s are about 85% of the time. That is the `stop_times.txt` scan.
  - Rail and KTMB take ≈ 25 ms each. The compile takes ≈ 0.27 s.
- **Where the 8 ms wall time goes:** about 40% is idle. Each `setTimeout(0)` waits for the next JS frame tick, so an 8 ms slice costs a whole 16.7 ms frame. Raising `sliceMs` to 12 was the one obvious fix: it cut the wall time 40% with no worse frame gap.
- **Dev JS** (`__DEV__` on), for reference: sync ≈ 1.8 s; sliced, 8 ms: 3.3–4.0 s wall / 2.1–2.2 s busy, gap ≤ 36 ms.
- **Node baseline** (M5 Pro): sync 270 ms, sliced 261–279 ms. Hermes is about 7–8× slower than V8 on this work.
- **Sizing for 20261028:**
  - Stops: 6,495
  - Patterns: 370
  - Expanded trips: 13,344
  - Stop events: 428,560 expanded / 313,170 after the rule
  - Turn-up-and-go windows: 211
  - Rail windows > 720 s: 1 (`PYL_MonFri_1`, 840 s)
  - See the fixture README for the per-feed table.
- KTMB filtered to Komuter + bbox: stops 49 / patterns 18 / trips 90.
- **Estimated network Int32 bytes** (plan 12/05, the compiled and encoded network): 3.51 MB blob, of which 2.92 MB is typed arrays; 1.43 MB gzipped. From `pnpm -C packages/shared exec tsx scripts/network-blob-size.ts packages/shared/src/transit/__fixtures__/2026-10-23 20261028`:
  ```
  network 20261028: 6421 stops, 238 routes, 308 patterns, 310491 stop events
  section  kind      bytes
  META     json      0.3 KB
  STNS     json     46.0 KB
  SID      str      89.7 KB
  SNAM     str     174.4 KB
  SLAT     f32      25.1 KB
  SLON     f32      25.1 KB
  SFED     u8        6.3 KB
  SSTN     i32      25.1 KB
  RID      str       3.0 KB
  RLAB     str       2.1 KB
  RLNG     str       6.8 KB
  RMOD     u8        0.2 KB
  RCOL     str       2.8 KB
  RTXC     str       2.8 KB
  RFED     u8        0.2 KB
  RSHP     str       3.5 KB
  PRTE     i32       1.2 KB
  PHED     str       9.2 KB
  PSST     i32       1.2 KB
  PSLN     i32       1.2 KB
  PSTP     i32      40.1 KB
  PTST     i32       1.2 KB
  PTLN     i32       1.2 KB
  PTMS     i32       1.2 KB
  PARR     i32    1212.9 KB
  PDEP     i32    1212.9 KB
  PKEY     str     267.1 KB
  PFST     i32       1.2 KB
  PFLN     i32       1.2 KB
  FSTA     i32       0.8 KB
  FEND     i32       0.8 KB
  FHWY     i32       0.8 KB
  PROF     i32      40.1 KB
  XSTA     i32      25.1 KB
  XLEN     i32      25.1 KB
  XPAT     i32      40.1 KB
  XPOS     i32      40.1 KB
  TSTA     i32      25.1 KB
  TLEN     i32      25.1 KB
  TTO      i32      66.6 KB
  TSEC     i32      66.6 KB
  TKND     u8       16.6 KB
  GCEL     json      0.0 KB
  GLAT     i32       8.3 KB
  GLON     i32       8.3 KB
  GSTA     i32       8.3 KB
  GLEN     i32       8.3 KB
  GSTP     i32      25.1 KB
  typed arrays     2988.3 KB
  total            3596.9 KB  (3.51 MB)
  gzip             1461.9 KB  (1.43 MB)
  encode 4.3 ms, decode 0.7 ms (Node, median of 5)
  ```
- Rail shapes: `[x] header lon,lat with correct values` / `[ ] values swapped`.
- **KTMB realtime** at 02:03 MYT on 2026-10-23: 1 entity (ETS219, stationary near Ipoh). Komuter present: **pending**.
  - That run was overnight, so it says nothing about Komuter.
  - Re-run `decode-ktmb-rt.ts` between 07:00 and 22:00 MYT on a weekday and record it here.
- **Decision:** `[x] device build` (provisional) / `[ ] apps/api prebuilt-blob fallback`.
  - Reason: with `sliceMs` 12 the sliced build takes 2.2 s on the Simulator, and the longest frame gap is ≤ 26 ms, a quarter of the 100 ms limit.
  - An iPhone 13 (A15) is roughly 2× slower single-threaded than an M5 Pro. That puts it near 4–4.5 s wall and ~50 ms gaps: over the 4 s line on time, well under it on jank.
  - The build runs once per service date in the background and is cached in `network_blobs`, so smoothness matters more than the total.
  - **Confirm on a physical iPhone 13 in a release build before task 06.** If the sliced total there is over 5 s, switch to the fallback. Task 06 is the only task that changes.
  - Carry forward: `sliceMs` = 12 for the network build. The scan of bus `stop_times.txt` is the hot path for task 03 to keep lean.
- **Re-timed with the shipped code (2026-10-23, 15/08).**
  - Setup: a Release build on the iPhone 17 Pro Max Simulator, nothing else running.
  - Method: `network_blobs` was cleared before each launch, so `refreshTransitNetwork` reads the four stored feeds and compiles both service dates (today and tomorrow).
  - Result: `refresh done in` 2145, 2163 and 2173 ms over three runs. That is about 1.1 s per date, inside the 4 s rule.
  - The physical iPhone 13 check is still open.

**Decision rule:**
- If the sliced total is **> 4 s**, or the longest frame gap is **> 100 ms**, after one obvious fix (bigger `SCAN_STEP_BYTES`, fewer string allocations), adopt the fallback:
  - `apps/api` gets a cron next to `api/cron/refresh-gtfs.ts`, scheduled in `apps/api/vercel.json`.
  - The cron downloads the four zips and runs the same `compileNetwork` + `encodeNetwork` from `@bus-tracker/shared` for today and tomorrow (MYT).
  - It serves the blob gzipped (about 1.5 MB) with an `ETag`. The app downloads one file instead of four and stores it in the same `network_blobs` table.
  - Tasks 01–05 are unchanged. Task 06 swaps the download-and-compile step for a blob download.
- Otherwise build on the device.

## Handoff to next step ([01-shared-types-and-modes.md](./01-shared-types-and-modes.md))
- The fixtures at `packages/shared/src/transit/__fixtures__/2026-10-23/` are the test input for tasks 02–05.
- The device-vs-server decision is recorded above. If the fallback is chosen, task 06 changes. Tasks 01–05 do not.
- Quirk answers (shape order, rail windows over 720 s, KTMB route ids) are in the fixture README.
