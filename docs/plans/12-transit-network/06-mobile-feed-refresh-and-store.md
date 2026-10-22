# 12-Transit-Network / 06 — Mobile feed refresh, blob store and `useTransitNetwork`

**Build impact:** JS-only (Metro reload). It uses `expo-sqlite` (already a dependency) and React Native's built-ins; there are no new native modules. If task 00 chose the `apps/api` fallback, replace steps 2–3 with a single blob download into the same table.

## Context
- `apps/mobile/services/gtfsFeed.ts` downloads static zips per `BusCategory` only:
  - `fetchZip` (`:94`) tries the mirrors;
  - `getZip` (`:109`) shares in-flight downloads and keeps zips in memory for `ZIP_IDLE_MS` (`:34`);
  - `STATIC_TTL_MS` is 12 h (`:32`).
- `prewarmRouteSearch` (`:193`) starts every bus category at once. Rail and KTMB are not `BusCategory` values.
- There is no rate limiting or 429 handling on static fetches, and `prewarmRouteSearch` alone sends 4 requests at once.
- The helpers for 429 handling already exist in `packages/shared/src/utils/backoff.ts`: `computeNextPollDelay` (`:27`) and `parseRetryAfterMs` (`:45`).
- SQLite:
  - `SCHEMA_VERSION = 7` (`apps/mobile/db/schema.ts:1`), with DDL in `DDL` (`:3`) and a `meta(key, value)` table (`:100`).
  - Migrations run in `migrate` (`apps/mobile/db/database.ts:27`), `if (current < N)` blocks up to v7 (`:91`).
  - Node tests run against `createTestDb()` (`apps/mobile/db/__tests__/nodeDb.ts`).
- Provider pattern: `StaticGtfsProvider` / `useStaticGtfs` (`apps/mobile/hooks/useStaticGtfs.tsx:46`, `:210`). It is mounted in `apps/mobile/app/_layout.tsx:46`.
- Malaysia dates: `toMalaysiaParts` (`packages/shared/src/utils/gtfs-time.ts:44`).
- The mobile test glob (`apps/mobile/package.json` `test`) covers `components/`, `db/`, `services/` and `widgets/`, but **not `hooks/`**. Put the logic in `services/` and keep the hook thin.

## Goal
On launch and daily:
1. Download the four feeds one at a time, through the shared static-request limiter (≤ 3 requests per rolling 60 s).
2. Compile today's and tomorrow's networks in idle time.
3. Persist them as BLOBs, and serve the previous blob until a new one completes.
4. Expose `useTransitNetwork()` → `{ network, health, status }` app-wide, working offline after one successful build.

## Prerequisites
- Tasks 01–05.
- Task 00 decision = device build.

## Steps

1. **Schema v8.**
   - In `apps/mobile/db/schema.ts`, set `SCHEMA_VERSION = 8` and append to `DDL`:
     ```sql
     CREATE TABLE IF NOT EXISTS network_blobs (
       service_date TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL,
       built_at INTEGER NOT NULL, data BLOB NOT NULL);
     CREATE TABLE IF NOT EXISTS feed_meta (
       feed_id TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, fetched_at INTEGER NOT NULL,
       valid_from TEXT NOT NULL, valid_until TEXT NOT NULL, zip BLOB NOT NULL);
     ```
   - In `database.ts`, add an `if (current < 8)` block with a comment: the tables come from the DDL, there is nothing to backfill, and the route bundle stays valid.
   - The zip is kept in `feed_meta` so tomorrow's network can be rebuilt offline. That is about 3.8 MB, and it avoids adding `expo-file-system`, which would be a native change.

2. **Feed store:** create `apps/mobile/db/networkStore.ts`.
   ```ts
   export interface StoredFeed { feed: FeedId; hash: string; fetchedAt: number; validFrom: string; validUntil: string; zip: Uint8Array }
   export async function loadFeeds(db: Db): Promise<Partial<Record<FeedId, StoredFeed>>>;
   export async function saveFeed(db: Db, f: StoredFeed): Promise<void>;           // INSERT OR REPLACE
   export async function loadBlob(db: Db, serviceDate: string): Promise<{ version: number; builtAt: number; data: Uint8Array } | null>;
   export async function saveBlob(db: Db, serviceDate: string, version: number, builtAt: number, data: Uint8Array): Promise<void>; // INSERT OR REPLACE (atomic swap)
   export async function pruneBlobs(db: Db, keep: readonly string[]): Promise<void>;
   ```
   `saveBlob` only runs after a compile succeeds. Until then the old row stays readable, which keeps the previous blob in service.

3. **One shared static-request limiter** in `apps/mobile/services/gtfsFeed.ts` (spec §3.6). data.gov.my allows 4 requests per minute for the static family. The app uses at most 3 in any rolling 60 s and keeps the 4th as a spare for one retry after a 429.
   ```ts
   export const STATIC_MAX_REQUESTS = 3;
   export const STATIC_WINDOW_MS = 60_000;
   export interface StaticLimiter { acquire(opts?: { spare?: boolean; signal?: AbortSignal }): Promise<void> }
   export function createStaticLimiter(deps?: { now?: () => number; sleep?: (ms: number) => Promise<void>; max?: number; windowMs?: number }): StaticLimiter;
   export let staticLimiter: StaticLimiter; // module singleton, replaced in tests
   ```
   - **How `acquire` works:**
     - It keeps the start times of granted requests, dropping those older than `windowMs`.
     - If fewer than `max` remain (`max + 1` when `spare` is set), it grants at once and records `now()`.
     - Otherwise it sleeps until the oldest one leaves the window, then checks again.
     - Waiters are served **FIFO** through an internal promise chain, so concurrent callers can't jump the queue.
     - An aborted `signal` rejects with the existing `abortError()` (`gtfsFeed.ts:303`) without taking a slot.
   - **Every** static request to `api.data.gov.my` calls `await staticLimiter.acquire()` immediately before `fetch`:
     - `fetchZip` (`:94`), used by `getZip`, which serves `prewarmRouteSearch` (`:193`), search and on-demand `getRouteBundle` (`:244`);
     - the new `downloadTransitFeeds` below.
     The S3 mirror in `BUS_CATEGORY_INFO['rapid-bus-kuantan'].staticUrls` (`packages/shared/src/utils/categories.ts:86`) is a different host and does not take a slot.
   - Effect on prewarm: it starts four bus categories at once, so the 4th now waits for a slot. Search already handles feeds arriving late through `onPartial` (`:206`).
   - Reset `staticLimiter` in `resetGtfsFeedCacheForTests` (`:309`).

   **Feed downloads**, in the same file:
   ```ts
   export interface FeedDownload { feed: FeedId; bytes: Uint8Array; etag: string | null }
   export async function downloadTransitFeeds(feeds: readonly FeedId[], deps?: { sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: AbortSignal }): Promise<{ ok: FeedDownload[]; failed: FeedId[] }>;
   ```
   - Fetch one feed at a time. The pacing comes from the limiter; there is no fixed stagger.
   - `bus-kl` and `feeder` go through `getZip(FEED_INFO[feed].category!)` (`:109`). A zip already in memory is reused and takes no slot.
   - `rail` and `ktm` fetch `FEED_INFO[feed].staticUrl`.
   - **On HTTP 429:**
     - Wait `computeNextPollDelay({ baseMs: STATIC_WINDOW_MS / STATIC_MAX_REQUESTS, consecutiveFailures, status: 429, retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after'), now()) ?? undefined, maxMs: 120_000 })`.
     - Then retry once through `staticLimiter.acquire({ spare: true })`.
     - A second 429 marks the feed `failed`. Any other failure also marks the feed `failed`, and the loop continues.

4. **Orchestration (pure, testable):** create `apps/mobile/services/transitNetwork.ts`.
   ```ts
   export interface NetworkDeps { db: Db; now: () => number; download: typeof downloadTransitFeeds; runSteps: typeof runSteps }
   export const FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
   export async function loadTodayNetwork(deps: NetworkDeps): Promise<TransitNetwork | null>;      // blob → decodeNetwork; NetworkFormatError → null
   export async function refreshTransitNetwork(deps: NetworkDeps): Promise<{ rebuilt: string[]; failedFeeds: FeedId[] }>;
   export function serviceDatesFor(nowMs: number): [today: string, tomorrow: string]; // service date = MYT date of (nowMs − 4 h), via toMalaysiaParts; test 00:30 MYT → yesterday
   ```
   `refreshTransitNetwork` does the following:
   1. Load the stored feeds. Download every feed whose `fetchedAt` is missing or older than 24 h.
   2. For each download, compute `hash = etag ?? fnv1a32Hex(bytes)`. Add `fnv1a32Hex` to `packages/shared/src/transit/hash.ts` with a test.
      - If the hash is unchanged, only bump `fetched_at`.
      - Otherwise run `readFeedSteps` (task 02) through `runSteps` to get `validFrom`/`validUntil`, then `saveFeed`.
   3. For each of today and tomorrow, rebuild when any of these hold:
      - the blob is missing;
      - `version !== NETWORK_FORMAT_VERSION`;
      - any feed's hash differs from the blob's `meta.feeds[f].hash`.
      To rebuild, read the feeds with `runSteps(readFeedSteps(...), 8)` and compile with `runSteps(compileNetwork(feeds, date), 8)`. `included` comes from task 07; until then it is `true`. Then `encodeNetwork` and `saveBlob`.
   4. `pruneBlobs(db, [today, tomorrow])`.
   - A compile throwing leaves the existing blob untouched. Log it and report it in `failedFeeds`, or as `status: 'error'` when nothing loads.
   - Run feeds and dates strictly one at a time, never in parallel, so slices do not pile up. This is the same reasoning as `enqueueBuild` at `gtfsFeed.ts:135`.

5. **Provider:** create `apps/mobile/hooks/useTransitNetwork.tsx`, modelled on `useStaticGtfs.tsx`.
   ```ts
   export type TransitNetworkStatus = 'loading' | 'ready' | 'refreshing' | 'offline' | 'error';
   export interface TransitNetworkState { network: TransitNetwork | null; health: NetworkHealth | null; status: TransitNetworkStatus }
   export function TransitNetworkProvider({ children }: { children: ReactNode }): ReturnType<typeof createElement>;
   export function useTransitNetwork(): TransitNetworkState;
   ```
   - **On mount:**
     1. Call `loadTodayNetwork` and set `ready` if it returns a network.
     2. Schedule `refreshTransitNetwork` in idle time:
        - use `requestIdleCallback` where the RN runtime defines it;
        - otherwise use `InteractionManager.runAfterInteractions`. Check RN 0.88's typings; `InteractionManager` may be marked deprecated.
     3. When the refresh is done, reload today's blob and swap the state in.
   - **Status:** `refreshing` while a refresh runs and a network is shown; `offline` when the downloads fail but a blob is loaded.
   - **AppState `active`:** if the service date (`serviceDatesFor`, switching at 04:00 MYT) changed since the last load, switch to the new day's blob (already built as "tomorrow") and kick off a refresh. Use the same `AppState.addEventListener` pattern as `apps/mobile/hooks/useScheduledDepartures.ts:65`.
   - `health` stays `null` until task 07.
   - Mount `<TransitNetworkProvider>` inside `<StaticGtfsProvider>` in `apps/mobile/app/_layout.tsx:46`. It does not depend on favourites.

6. **Remove the task 00 harness:** delete `apps/mobile/app/dev-network.tsx` and its Settings row. First re-run its measurement once against the real `compileNetwork` (success criterion 4) and add a "06 re-check" row to task 00 Results.

7. **Tests:**
   - `apps/mobile/db/__tests__/networkStore.test.ts`, with `createTestDb()`:
     - `migrates a v7 database to v8 and creates network_blobs/feed_meta`: set `meta.schemaVersion = 7`, run `migrate`, check `PRAGMA table_info`.
     - `saveBlob replaces atomically and loadBlob returns identical bytes`.
     - `pruneBlobs keeps only the given dates`.
   - `apps/mobile/services/__tests__/transitNetwork.test.ts`. Use a fake `fetch` as in `services/__tests__/gtfsFeed.test.ts:147`, a fake `sleep` that records waits, and small synthetic zips from `fflate`:
     - `downloads feeds one at a time through the limiter`;
     - `429 with Retry-After waits that long, then succeeds`;
     - `unchanged hash skips re-reading the feed`;
     - `builds today and tomorrow, and prunes older blobs`;
     - `keeps the previous blob when compile throws`;
     - `offline: downloads fail but the saved blob still loads` (success criterion 5);
     - `corrupt blob (NetworkFormatError) triggers a rebuild`.
   - `apps/mobile/services/__tests__/staticLimiter.test.ts`. Use `createStaticLimiter` with a fake clock and a fake `sleep` that advances it:
     - `grants 3 at once, the 4th waits until the oldest leaves the 60 s window`;
     - `spare: true allows a 4th within the window, but not a 5th`;
     - `waiters are served FIFO`;
     - `an aborted waiter rejects with AbortError and takes no slot`;
     - `prewarm + network refresh never exceed 3 api.data.gov.my requests per rolling 60 s`. Install the singleton with the fake clock, stub `fetch` and record the request times, then call `prewarmRouteSearch()` and `downloadTransitFeeds(FEED_IDS)` together;
     - `the S3 mirror does not take a slot`.
   - `fnv1a32Hex` known vectors go in `packages/shared/src/transit/__tests__/hash.test.ts`.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm --filter mobile test`.
- `pnpm type-check`.
- Manual (iPhone, release build):
  1. On a fresh install, launch and wait about 1–2 min: 4 network downloads, plus any search prewarm, at ≤ 3 per minute. The log shows two blobs built. `useTransitNetwork().status` is `ready`.
  2. Kill the app, turn on airplane mode, and relaunch: the network loads from the blob and the status is `offline`.
  3. While a refresh runs, scroll the trip sheet. There are no visible hitches; the re-measured longest frame gap is under 100 ms.
  4. Search for a route right after launch: it still works, and the log never shows more than 3 `api.data.gov.my` static requests in any 60 s, plus at most one 429 retry.

## Handoff to next step ([07-feed-health.md](./07-feed-health.md))
- `useTransitNetwork()` returns `{ network, health: null, status }`. The network persists in `network_blobs` for today and tomorrow, and the feed zips plus validity live in `feed_meta`.
- `refreshTransitNetwork` takes injected `now`, so task 07 can test health with a fake clock.
- The dev harness is gone.

## Implementation notes
- **Step 6 was deferred.** `apps/mobile/app/dev-network.tsx`, its Settings row and its `_layout.tsx` entry are still in place, and the "06 re-check" run has not been done. Other phase lanes were editing `_layout.tsx` and `settings.tsx` at the same time. The root agent re-checks on the iOS Simulator and removes every temporary dev screen at the end of the phase. Until then, the handoff line "The dev harness is gone" does not hold.
- **Slices are 12 ms, not 8.** Task 00 carried `sliceMs` = 12 forward for the network build, and `NETWORK_SLICE_MS = 12` in `services/transitNetwork.ts` is used for every `readFeedSteps` and `compileNetwork` run.
- **`InteractionManager` is gone in RN 0.88**, so there is no `Libraries/Interaction`. The provider uses `requestIdleCallback`, which RN 0.88 defines, with a 5 s timeout. A `setTimeout` fallback covers runtimes without it.
- **`staticLimiter` is swapped with `setStaticLimiter()`.** An ES module `let` can't be reassigned by importers. `resetGtfsFeedCacheForTests()` installs a fresh real limiter. `gtfsFeed.test.ts` and `bootstrap.test.ts` then install a no-wait limiter, because several of their tests make 4 or more static requests and would otherwise wait 60 s in real time. Pacing is covered by `staticLimiter.test.ts`.
- **429s surface as `StaticHttpError`** (`status`, raw `retryAfter`). `fetchZip` now throws it, with the same `GTFS static <status>` message as before. That lets `downloadTransitFeeds` see a 429 from the bus feeds that go through `getZip`. The retry passes `spare: true` down through `getZip` → `fetchZip` → `staticLimiter.acquire`. `computeNextPollDelay` uses `consecutiveFailures: 1`, since there is only one retry.
- **Additions to the specified API:**
  - `touchFeed(db, feed, fetchedAt)` in `db/networkStore.ts` handles the "hash unchanged, only bump `fetched_at`" case.
  - `refreshTransitNetwork` returns `{ rebuilt, failedFeeds, failedDates, offline }`. A compile that throws is reported in `failedDates`, not `failedFeeds`, because it isn't a feed. `offline` is true when downloads were due and every one failed; the provider maps that to `status: 'offline'` when a blob loaded. The `'error'` status covers "nothing loads".
  - `NetworkDeps.log?` is an optional progress logger. The provider passes `[transit-network] …` console lines; tests leave it silent.
- **A feed read during the download step is reused for the compile**, so a changed feed is parsed once per refresh rather than once per date. Feeds that need no download are read from their stored zip only when a date needs rebuilding.
- **A rebuild is decided per date** by the blob being missing, `version !== NETWORK_FORMAT_VERSION`, failing to decode (`NetworkFormatError`), or any `meta.feeds[f].hash` differing from `feed_meta`. A stored zip that no longer reads is left out of that build and reported in `failedFeeds`.
- **`health` is typed `null`** until task 07 adds `NetworkHealth`. Every feed compiles with `included: true` until then, so expired-feed exclusion (success criterion 6) is still task 07's job.
- **Dev only: `EXPO_PUBLIC_GTFS_STATIC_BASE`** (read only when `__DEV__`) sends data.gov.my static requests to another origin with the same path and query, e.g. a local server for the fixture zips. Those requests still take limiter slots. Dev builds also log every static request as `[gtfs] static GET <UTC time> <url>`, so the ≤ 3 per 60 s pacing can be read from the log.
- **Node run on the 2026-10-23 fixtures for 20261028.** These are informational and not part of the tests:
  - reads: rail 6 ms, bus-kl 80 ms, feeder 112 ms, KTM 3 ms;
  - each date compiles in about 80 ms;
  - the blob is 3.51 MB, with 6,421 stops and 308 patterns, which matches tasks 03–05.
- **Fix after the first Simulator run (slices of 55–156 ms, some up to 416 ms).** Every heavy stage now runs through `runSteps` at 12 ms:
  - **Downloads use `expo/fetch`.** React Native's `Response.arrayBuffer()` reads the body as base64 (`FileReader.readAsDataURL`) and decodes it with `toByteArray` in JS, all in one task. For a 2 MB zip that meant a 2.7 MB string plus its garbage. `services/staticFetch.ts` installs `expo/fetch` through `setStaticFetch()`; its `arrayBuffer()` is native, from `ExpoFetchModule.swift`, which is already in the Expo 58 pod. The change is JS-only. The import lives in `_layout.tsx`. Tests keep using the global `fetch`.
  - **Hashing is sliced.** `fnv1a32HexSteps` yields every 64 KB. Hashing 2 MB takes 32–42 ms in one go on JIT-less Node, and Hermes is slower still.
  - **readFeedSteps' tail yields.** It now yields after the route meta, the stop names and the validity. Namespacing runs as `namespaceParsedFeedSteps`, which yields every 8,192 rows. bus-kl now uses it too: its prefix equals its bus category's, so the result matches `namespaceParsedGtfs`.
  - **Compile uses `yieldEvery: 512`** instead of the 2,048 default. On device, compile runs about 5× slower than on JIT-less Node.
  - **Encode and decode are stepped.** `encodeNetworkSteps` and `decodeNetworkSteps` yield between sections. Hermes has `TextEncoder` but no `TextDecoder`, so fflate decodes strings in JS. String sections are therefore decoded in runs of about 32 KB, aligned on the stored string offsets. `readNetworkMeta` parses only the META section, so `rebuildReason` no longer decodes whole blobs.
- **Nothing is read twice.** A changed feed is parsed once and reused by both dates' compiles. The feeder read is heavy by design: 14 MB of stop_times becomes about 300k row objects, as task 00's harness also built. Measured on JIT-less Node without `TextDecoder`, the read takes 1.3 s busy, close to the Simulator's 1.1 s.
- **Slice timing is now exact.** Before, a gap over 0.25 ms between steps marked a new slice. If the runtime resumed a `setTimeout(0)` faster than that, back-to-back slices merged into one reported "slice". Now a microtask queued during a slice marks where it ends. Dev builds also log `longest frame gap` on the `refresh done` line, from a `requestAnimationFrame` loop, the same measure task 00 used.
- **Device-proxy run on the 2026-10-23 fixtures**, JIT-less Node without `TextDecoder`, two refreshes:
  - every stage's longest slice is 12–20 ms;
  - the longest event-loop gap is 32 ms, which includes node:sqlite's synchronous blob writes; expo-sqlite's async API does not block the JS thread.
- **Fix after the second Simulator run.** That run reported 4 static GETs in 6.5 s, a feeder read with a 117 ms slice, and a 902 ms frame gap.
  - **The 4 GETs came from two JS runtimes, each with its own limiter.** Metro logged two `refresh start` runs, 54 s apart, and both later logged `refresh done`. The first runtime survived a dev reload.
    - Runtime A sent rail, feeder and bus-kl at 19:28:56.72. Its own limiter held ktm until 19:29:56.73, exactly 60 s later.
    - Runtime B started with an empty in-memory limiter. It sent rail, bus-kl and feeder at 19:29:50, and its ktm went at 19:30:50.26.
    - Each limiter was correct alone. The same gap appears whenever the app relaunches within a minute.
  - **Limiter grants now persist** in a SQLite `static_requests` table (`db/staticRequestLog.ts`, installed by `services/staticFetch.ts`).
    - A single `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < limit` statement claims a slot atomically across connections. A failed claim waits for the oldest recorded request to leave the window.
    - If the log can't be read, the limiter falls back to its in-memory grants with a warning.
    - The table is created by the v8 DDL (`IF NOT EXISTS`), so a database already at v8 gains it on its next open.
  - **The ≥ 16 s spacing was missing and now exists.** `downloadTransitFeeds` keeps each of its own requests at least `TRANSIT_FEED_SPACING_MS` = 16 s after the previous response. Measuring from the response is conservative, since the limiter may hold a request first.
    - A bus feed served from search's cached or in-flight zip sends no request and does not wait.
    - With an empty window, a refresh sends rail, bus-kl, feeder and ktm at 0, 16, 32 and 60 s.
  - **The feeder's long slice was an old-generation GC pause.** It was not an unsliced step. A JSI host on the pod's own `hermesvm.framework` (Static Hermes 260318099.0.4, Release, Hades concurrent) reproduced it when reading the fixtures in refresh order with bus-kl's result still live: the longest feeder slice was 105 ms, and one 97 ms step spent 90 ms in GC. Adding 400k live objects to stand in for the app heap pushed it to 160 ms.
    - The cause was every stop_times row holding its own copies of its trip id, stop id and two times; Hermes has no substring sharing. Namespacing then built a fresh prefixed string per row.
    - `readFeedSteps` now interns stop_times strings, and `namespaceParsedFeedSteps` renames each distinct id once.
    - In that host, the feeder's longest slice is now 19.7 ms, or 24.8 ms with the 400k extra live objects. Total GC time fell from 126 ms to 20 ms and the heap from 84 MB to 55 MB.
    - The row shape is unchanged, so `compile.ts` is untouched. Measurement scripts were temporary and not added to the repo.
  - **The 902 ms frame gap was runtime A's.** Its refresh ran from 19:28:56 to 19:29:59 and spanned runtime B's start-up. Runtime B's own refresh measured 201 ms, which equals its feeder slice.
    - The frame-gap watch now starts after `refresh start`, so waiting for the database is no longer counted.
    - Dev builds log every gap over 100 ms as it happens (`frame gap N ms at +T ms`). Each gap then lands between the stage lines it fell in.
  - **The pod's Hermes does define `TextDecoder`.** That corrects the bullet above. The stepped string decode is kept, since it costs nothing.
- **Fix after the third Simulator run.** A cold launch showed gaps of 895, 813, 563 and 807 ms in the first 3.3 s after `refresh start`, before any network read.
  - **They came from start-up work this task didn't add: the static-GTFS bootstrap of the saved favourites.**
    - `useStaticGtfs` → `bootstrapStaticGtfs` → `getRouteBundle` parsed a whole feed zip per route in one synchronous `parseGtfsZip` call: `unzipSync` of every file including shapes, `strFromU8` of a 14 MB stop_times.txt, then a scan.
    - On the pod's Hermes, that was 738 ms for the feeder and 495 ms for bus-kl.
    - The run's order fits:
      - the feeder GET went out at refresh start beside rail;
      - two feeder gaps followed, one per favourite;
      - then the bus-kl GET, once a route wasn't found in the feeder;
      - then two bus-kl gaps.
    - The favourites survive a reinstall in SecureStore, so a clean install still bootstraps them.
  - **`parseGtfsZip` now drains a new `parseGtfsZipSteps` generator.** It inflates only the GTFS files, 16 KB of zip per step, and scans stops, trips, stop_times and shapes 64 KB per step.
    - Output is identical (JSON-equal) to the committed parser on all four fixture zips, with and without `keepRoute`.
    - `getRouteBundle` runs it through `runSteps` at 12 ms, stopping at the next step on abort. Measured in the Hermes host with 400k extra live objects, the longest slice is 17–21 ms.
    - The refresh did not need to be deferred: the start-up work no longer blocks frames.
  - **TEMPORARY dev markers.** `services/devStages.ts` logs `[transit-network] stage <name> +T ms` on the frame-gap clock, which starts at refresh start. The markers cover:
    - each download's response and body;
    - each search-index step: zip ready, built, serialized, saved;
    - each route bundle step: from, parsed, cut;
    - each refresh stage: stored feeds loaded, downloads done, hashed, read, saved, compiled, encoded, saved.

    Remove them with the dev harnesses at the end of the phase.
