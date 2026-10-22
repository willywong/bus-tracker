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
