import {
  FEED_IDS,
  NETWORK_FORMAT_VERSION,
  NetworkFormatError,
  activeServiceIds,
  compileNetwork,
  decodeNetworkSteps,
  encodeNetworkSteps,
  feedHealth,
  fnv1a32HexSteps,
  readFeedSteps,
  readNetworkMeta,
  toMalaysiaParts,
  type CompileFeeds,
  type FeedId,
  type NetworkHealth,
  type NormalisedFeed,
  type TransitNetwork,
  type runSteps,
} from "@bus-tracker/shared";
import type { Db } from "@/db/database";
import {
  loadBlob,
  loadFeedInfo,
  loadFeeds,
  pruneBlobs,
  saveBlob,
  saveFeed,
  touchFeed,
  type StoredFeed,
} from "@/db/networkStore";
import { refreshRailShapes } from "./railShapes";
import type { downloadTransitFeeds } from "./gtfsFeed";

/**
 * The whole-Klang-Valley transit network (spec §3): the four feeds are
 * downloaded at most daily, and today's and tomorrow's networks are compiled
 * on the device and kept as blobs in SQLite. Everything runs strictly one
 * thing at a time, in slices, so the UI keeps its frames.
 */

export interface NetworkDeps {
  db: Db;
  now: () => number;
  download: typeof downloadTransitFeeds;
  runSteps: typeof runSteps;
  /** Progress lines; silent when omitted. */
  log?: (msg: string) => void;
}

export interface RefreshResult {
  /** Service dates whose blob was rebuilt. */
  rebuilt: string[];
  /** Feeds that failed to download or read; their previous copy (if any) was used. */
  failedFeeds: FeedId[];
  /** Service dates whose build threw; their previous blob (if any) stays. */
  failedDates: string[];
  /** Downloads were due and every one of them failed. */
  offline: boolean;
}

/** A feed is downloaded again once its copy is this old. */
export const FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Slice length for reading and compiling. Task 00 measured 12 ms against
 * 8 ms: 40% less wall time with no worse frame gap.
 */
export const NETWORK_SLICE_MS = 12;
/**
 * Compile work units between yields. The compiler's default (2,048) is sized
 * from Node; Hermes runs it ~5× slower than JIT-less Node, which made 15–40 ms
 * steps. A quarter of that keeps every step well inside a slice.
 */
const COMPILE_YIELD_EVERY = 512;
/** The service day turns over at 04:00 MYT, so a 00:30 train is still "today". */
const SERVICE_DAY_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's and tomorrow's service dates ('YYYYMMDD'): the MYT date of `nowMs − 4 h`, and the day after. */
export function serviceDatesFor(nowMs: number): [today: string, tomorrow: string] {
  const base = nowMs - SERVICE_DAY_OFFSET_MS;
  return [toMalaysiaParts(new Date(base)).ymd, toMalaysiaParts(new Date(base + DAY_MS)).ymd];
}

/**
 * Today's stored network, or null when there is none (or it can't be read).
 * Decoded in slices: without `TextDecoder`, Hermes decodes the strings in JS.
 */
export async function loadTodayNetwork(deps: NetworkDeps): Promise<TransitNetwork | null> {
  return loadStoredNetwork(deps, serviceDatesFor(deps.now())[0]);
}

/**
 * Service date `date`'s stored network ("YYYYMMDD"), or null. The planner
 * reads tomorrow's for a "Depart at…" past 04:00 tomorrow (15/04).
 */
export async function loadStoredNetwork(
  deps: Pick<NetworkDeps, "db" | "runSteps">,
  date: string,
): Promise<TransitNetwork | null> {
  const blob = await loadBlob(deps.db, date);
  if (!blob || blob.version !== NETWORK_FORMAT_VERSION) return null;
  try {
    return await deps.runSteps(decodeNetworkSteps(blob.data), NETWORK_SLICE_MS);
  } catch (err) {
    if (err instanceof NetworkFormatError) return null;
    throw err;
  }
}

/**
 * Every downloaded feed's health on today's service date, from `feed_meta`
 * and today's blob meta; no zip is read or decoded. Whether a feed runs
 * anything today comes from the blob's `meta.feeds[f].included` when that
 * blob was built from the stored copy, else from the dates alone. Cheap
 * enough to call whenever the app comes back to the foreground. `loaded` is
 * the network already in memory; when it is today's, the blob isn't read.
 */
export async function loadHealth(
  deps: NetworkDeps,
  loaded?: TransitNetwork["meta"] | null,
): Promise<NetworkHealth> {
  const [today] = serviceDatesFor(deps.now());
  const stored = await loadFeedInfo(deps.db);
  let built: TransitNetwork["meta"]["feeds"] | null = null;
  if (loaded?.serviceDate === today) {
    built = loaded.feeds;
  } else {
    const blob = await loadBlob(deps.db, today);
    if (blob && blob.version === NETWORK_FORMAT_VERSION) {
      try {
        built = readNetworkMeta(blob.data).feeds;
      } catch (err) {
        if (!(err instanceof NetworkFormatError)) throw err;
      }
    }
  }
  const health: NetworkHealth = {};
  for (const f of FEED_IDS) {
    const s = stored[f];
    if (!s) continue;
    const m = built?.[f];
    const hasActiveServicesToday = m && m.hash === s.hash ? m.included : today <= s.validUntil;
    health[f] = feedHealth(
      { feed: f, validFrom: s.validFrom, validUntil: s.validUntil, hasActiveServicesToday },
      today,
    );
  }
  return health;
}

/**
 * Downloads the feeds that are due, then rebuilds today's and tomorrow's
 * networks if a blob is missing, unreadable or built from other feed
 * versions. A blob is only replaced by a finished build.
 */
export async function refreshTransitNetwork(deps: NetworkDeps): Promise<RefreshResult> {
  const { db, now } = deps;
  const log = deps.log ?? (() => {});
  const startedAt = now();
  const dates = serviceDatesFor(startedAt);
  const stored = await loadFeeds(db);
  // Feeds read in this run, kept for the compile.
  const read = new Map<FeedId, NormalisedFeed>();
  const failedFeeds: FeedId[] = [];
  const fail = (f: FeedId) => {
    if (!failedFeeds.includes(f)) failedFeeds.push(f);
  };

  const due = FEED_IDS.filter((f) => {
    const s = stored[f];
    return !s || startedAt - s.fetchedAt >= FEED_MAX_AGE_MS;
  });
  let offline = false;
  if (due.length > 0) {
    log(`downloading ${due.join(", ")}`);
    const { ok, failed } = await deps.download(due, { now });
    failed.forEach(fail);
    offline = ok.length === 0;
    for (const d of ok) {
      // One timing for hashing and reading: both run in slices.
      const timing = sliceTiming();
      const hash = d.etag ?? (await deps.runSteps(timed(fnv1a32HexSteps(d.bytes), timing), NETWORK_SLICE_MS));
      const prev = stored[d.feed];
      const fetchedAt = now();
      const size = `${Math.round(d.bytes.byteLength / 1024)} KB`;
      if (prev && prev.hash === hash) {
        await touchFeed(db, d.feed, fetchedAt);
        stored[d.feed] = { ...prev, fetchedAt };
        log(`${d.feed}: ${size}, unchanged, hashed ${timingSummary(timing)}`);
        continue;
      }
      try {
        const data = await deps.runSteps(timed(readFeedSteps(d.bytes, d.feed, { shapes: d.feed === "rail" }), timing), NETWORK_SLICE_MS);
        const feed: StoredFeed = {
          feed: d.feed,
          hash,
          fetchedAt,
          validFrom: data.validFrom,
          validUntil: data.validUntil,
          zip: d.bytes,
        };
        await saveFeed(db, feed);
        stored[d.feed] = feed;
        read.set(d.feed, data);
        log(
          `${d.feed}: ${size}, new (${hash}), valid ${data.validFrom}–${data.validUntil}, ` +
            `read ${timingSummary(timing)}`,
        );
      } catch (err) {
        log(`${d.feed}: download unreadable, keeping the previous copy (${errorMessage(err)})`);
        fail(d.feed);
      }
    }
  }

  const rebuilt: string[] = [];
  const failedDates: string[] = [];
  const available = FEED_IDS.filter((f) => stored[f]);
  for (const date of dates) {
    const reason = await rebuildReason(db, date, stored);
    if (!reason) continue;
    if (available.length === 0) {
      log(`${date}: no feeds downloaded yet, nothing to build`);
      continue;
    }
    try {
      const timing = sliceTiming();
      const feeds: CompileFeeds = {};
      for (const f of available) {
        const s = stored[f]!;
        let data = read.get(f);
        if (!data) {
          try {
            data = await deps.runSteps(timed(readFeedSteps(s.zip, f, { shapes: f === "rail" }), timing), NETWORK_SLICE_MS);
            read.set(f, data);
          } catch (err) {
            log(`${f}: stored zip unreadable, building without it (${errorMessage(err)})`);
            fail(f);
            continue;
          }
        }
        // Feed health on this service date (spec §3.6): an expired feed is
        // compiled out, and `meta.feeds[f].included` records it.
        const { included } = feedHealth(
          {
            feed: f,
            validFrom: s.validFrom,
            validUntil: s.validUntil,
            hasActiveServicesToday: activeServiceIds(data.parsed.calendar, data.parsed.calendarDates, date).size > 0,
          },
          date,
        );
        if (!included) log(`${date}: ${f} expired (valid to ${s.validUntil}), left out`);
        feeds[f] = {
          data,
          meta: { fetchedAt: s.fetchedAt, hash: s.hash, validUntil: s.validUntil, included },
        };
      }
      const net = await deps.runSteps(
        timed(compileNetwork(feeds, date, { builtAt: now(), yieldEvery: COMPILE_YIELD_EVERY }), timing),
        NETWORK_SLICE_MS,
      );
      const bytes = await deps.runSteps(timed(encodeNetworkSteps(net), timing), NETWORK_SLICE_MS);
      await saveBlob(db, date, NETWORK_FORMAT_VERSION, net.meta.builtAt, bytes);
      rebuilt.push(date);
      log(
        `${date}: built (${reason}) in ${timingSummary(timing)}, ` +
          `${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB, ${net.stops.count} stops, ${net.patterns.count} patterns`,
      );
    } catch (err) {
      failedDates.push(date);
      log(`${date}: build failed, keeping the previous blob (${errorMessage(err)})`);
    }
  }

  // Rail line geometry for the map (plan 13/02), from the stored rail feed.
  try {
    await refreshRailShapes(deps, stored.rail, read.get("rail"), NETWORK_SLICE_MS);
  } catch (err) {
    log(`rail shapes: not updated, keeping the previous ones (${errorMessage(err)})`);
  }
  await pruneBlobs(db, dates);
  return { rebuilt, failedFeeds, failedDates, offline };
}

/** Why `date`'s blob needs building, or null when it is current. */
async function rebuildReason(
  db: Db,
  date: string,
  stored: Partial<Record<FeedId, StoredFeed>>,
): Promise<string | null> {
  const blob = await loadBlob(db, date);
  if (!blob) return "missing";
  if (blob.version !== NETWORK_FORMAT_VERSION) return `format ${blob.version}`;
  // Only the meta is read here; the full decode happens when the blob is used.
  let meta: TransitNetwork["meta"];
  try {
    meta = readNetworkMeta(blob.data);
  } catch (err) {
    if (err instanceof NetworkFormatError) return "unreadable";
    throw err;
  }
  const changed = FEED_IDS.filter((f) => (stored[f]?.hash ?? "") !== (meta.feeds[f]?.hash ?? ""));
  return changed.length > 0 ? `new ${changed.join(", ")}` : null;
}

interface SliceTiming {
  startedAt: number;
  busyMs: number;
  longestSliceMs: number;
  sliceStart: number;
  /** Set by a microtask once the runner pauses, i.e. the current slice ended. */
  paused: boolean;
  armed: boolean;
}

const clock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function sliceTiming(): SliceTiming {
  const t = clock();
  return { startedAt: t, busyMs: 0, longestSliceMs: 0, sliceStart: t, paused: true, armed: false };
}

function timingSummary(t: SliceTiming): string {
  const wall = Math.round(clock() - t.startedAt);
  return `${wall} ms wall / ${Math.round(t.busyMs)} ms busy, longest slice ${Math.round(t.longestSliceMs)} ms`;
}

/**
 * Passes `steps` through while timing it: busy time, and the longest slice,
 * the longest run of steps between two pauses of the runner (the longest the
 * UI waited). Microtasks only run once the runner gives up the thread, so a
 * microtask queued during a slice marks exactly where that slice ended.
 */
function* timed<T>(steps: Generator<void, T, void>, timing: SliceTiming): Generator<void, T, void> {
  for (;;) {
    const start = clock();
    if (timing.paused) {
      timing.paused = false;
      timing.sliceStart = start;
    }
    const step = steps.next();
    const end = clock();
    timing.busyMs += end - start;
    timing.longestSliceMs = Math.max(timing.longestSliceMs, end - timing.sliceStart);
    if (step.done) return step.value;
    if (!timing.armed) {
      timing.armed = true;
      void Promise.resolve().then(() => {
        timing.armed = false;
        timing.paused = true;
      });
    }
    yield;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
