import { count, createTestDb } from "@/db/__tests__/nodeDb";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";

import { FEED_IDS, FEED_INFO, healthNote, runSteps, type FeedId } from "@bus-tracker/shared";
import { loadBlob, saveBlob } from "@/db/networkStore";
import {
  createStaticLimiter,
  downloadTransitFeeds,
  resetGtfsFeedCacheForTests,
  setStaticLimiter,
} from "../gtfsFeed";
import {
  FEED_MAX_AGE_MS,
  loadHealth,
  loadTodayNetwork,
  refreshTransitNetwork,
  serviceDatesFor,
  type NetworkDeps,
} from "../transitNetwork";

const CALENDAR =
  "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
  "WK,1,1,1,1,1,1,1,20260101,20271231\n";

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({ ...files, "calendar.txt": CALENDAR }).map(([k, v]) => [k, strToU8(v)])));
}

function railZip(tag = ""): Uint8Array {
  return zip({
    "routes.txt": `route_id,route_short_name,route_long_name\nKJ,KJ,LRT Kelana Jaya Line${tag}\n`,
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nKJ1,GOMBAK,3.231,101.724\nKJ2,TAMAN MELATI,3.219,101.722\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id\nKJ,WK,KJ_0,0\n",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nKJ_0,KJ1,1,06:00:00,06:00:00\nKJ_0,KJ2,2,06:02:00,06:02:00\n",
    "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nKJ_0,06:00:00,23:00:00,300\n",
  });
}

function busZip(prefix: string): Uint8Array {
  return zip({
    "routes.txt": `route_id,route_short_name,route_long_name\n${prefix}R,${prefix}1,${prefix} line\n`,
    "stops.txt": `stop_id,stop_name,stop_lat,stop_lon\n${prefix}A,Stop A,3.10,101.60\n${prefix}B,Stop B,3.11,101.61\n`,
    "trips.txt": `route_id,service_id,trip_id\n${prefix}R,WK,${prefix}T\n`,
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
      `${prefix}T,${prefix}A,1,07:00:00,07:00:00\n${prefix}T,${prefix}B,2,07:10:00,07:10:00\n`,
  });
}

function ktmZip(): Uint8Array {
  return zip({
    "routes.txt": "route_id,route_short_name,route_long_name\nSB,Seremban Line,Batu Caves - Pulau Sebang\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n19100,KL SENTRAL,3.1343,101.6860\n19000,KUALA LUMPUR,3.1396,101.6936\n",
    "trips.txt": "route_id,service_id,trip_id\nSB,WK,2001\n",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n2001,19100,1,08:00:00,08:00:00\n2001,19000,2,08:04:00,08:05:00\n",
  });
}

const zips: Record<FeedId, Uint8Array> = {
  rail: railZip(),
  "bus-kl": busZip("K"),
  feeder: busZip("F"),
  ktm: ktmZip(),
};

function feedOfUrl(url: string): FeedId | null {
  return FEED_IDS.find((f) => FEED_INFO[f].staticUrl === url) ?? null;
}

/** 2026-10-23 10:00 MYT. */
const START = Date.UTC(2026, 9, 23, 2, 0, 0);
const TODAY = "20261023";
const TOMORROW = "20261024";

let c: { t: number; waits: number[] };
let requests: Array<{ url: string; t: number }>;
let respond: (feed: FeedId, attempt: number) => Response | Promise<Response>;

function deps(db: ReturnType<typeof createTestDb>, over: Partial<NetworkDeps> = {}): NetworkDeps {
  const sleep = async (ms: number) => {
    c.waits.push(ms);
    c.t += ms;
  };
  return {
    db,
    now: () => c.t,
    download: (feeds, d) => downloadTransitFeeds(feeds, { ...d, sleep, now: () => c.t }),
    runSteps,
    ...over,
  };
}

/** A new app process: no zips in memory, a fresh limiter on the fake clock. */
function relaunch(): void {
  resetGtfsFeedCacheForTests();
  setStaticLimiter(
    createStaticLimiter({
      now: () => c.t,
      sleep: async (ms) => {
        c.waits.push(ms);
        c.t += ms;
      },
    }),
  );
}

beforeEach(() => {
  c = { t: START, waits: [] };
  relaunch();
  requests = [];
  respond = (feed) => new Response(zips[feed]);
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    requests.push({ url, t: c.t });
    const feed = feedOfUrl(url);
    if (!feed) return new Response("not found", { status: 404 });
    const attempt = requests.filter((r) => r.url === url).length;
    return respond(feed, attempt);
  }) as typeof fetch;
  // The tiny rail feed lacks the curated interchange ids; compile warns about it.
  mock.method(console, "warn", () => {});
});

afterEach(() => mock.restoreAll());

test("serviceDatesFor: the service day starts at 04:00 MYT", () => {
  assert.deepEqual(serviceDatesFor(START), [TODAY, TOMORROW]);
  // 00:30 MYT on the 24th still belongs to the 23rd.
  assert.deepEqual(serviceDatesFor(Date.UTC(2026, 9, 23, 16, 30)), [TODAY, TOMORROW]);
  // 03:59 → still the 23rd; 04:00 → the 24th.
  assert.deepEqual(serviceDatesFor(Date.UTC(2026, 9, 23, 19, 59)), [TODAY, TOMORROW]);
  assert.deepEqual(serviceDatesFor(Date.UTC(2026, 9, 23, 20, 0)), [TOMORROW, "20261025"]);
});

test("downloads feeds one at a time through the limiter", async () => {
  let active = 0;
  let maxActive = 0;
  respond = async (feed) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 0));
    active--;
    return new Response(zips[feed]);
  };
  const db = createTestDb();
  const result = await refreshTransitNetwork(deps(db));
  assert.deepEqual(result.failedFeeds, []);
  assert.equal(result.offline, false);
  assert.equal(maxActive, 1);
  assert.deepEqual(
    requests.map((r) => feedOfUrl(r.url)),
    [...FEED_IDS],
  );
  // 16 s apart; the 4th also waits for the first to leave the 60 s window.
  assert.deepEqual(
    requests.map((r) => r.t - START),
    [0, 16_000, 32_000, 60_000],
  );
  assert.equal(count(db, "feed_meta"), 4);
});

test("429 with Retry-After waits that long, then succeeds", async () => {
  respond = (feed, attempt) =>
    attempt === 1
      ? new Response("slow down", { status: 429, headers: { "retry-after": "30" } })
      : new Response(zips[feed]);
  const { ok, failed } = await downloadTransitFeeds(["rail"], {
    now: () => c.t,
    sleep: async (ms) => {
      c.waits.push(ms);
      c.t += ms;
    },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(ok.map((d) => d.feed), ["rail"]);
  assert.deepEqual(c.waits, [30_000]);
  assert.equal(requests.length, 2);
});

test("a second 429 marks the feed failed and the rest carry on", async () => {
  respond = (feed) =>
    feed === "rail"
      ? new Response("slow down", { status: 429 })
      : new Response(zips[feed]);
  const { ok, failed } = await downloadTransitFeeds(["rail", "ktm"], {
    now: () => c.t,
    sleep: async (ms) => {
      c.waits.push(ms);
      c.t += ms;
    },
  });
  assert.deepEqual(failed, ["rail"]);
  assert.deepEqual(ok.map((d) => d.feed), ["ktm"]);
  // No Retry-After: one base interval (60 s / 3); ktm then keeps 16 s
  // after rail's retry.
  assert.deepEqual(c.waits, [20_000, 16_000]);
  assert.equal(requests.filter((r) => feedOfUrl(r.url) === "rail").length, 2);
});

test("builds today and tomorrow, and prunes older blobs", async () => {
  const db = createTestDb();
  await saveBlob(db, "20261020", 1, 1, new Uint8Array([1, 2, 3]));
  const result = await refreshTransitNetwork(deps(db));
  assert.deepEqual(result.rebuilt, [TODAY, TOMORROW]);
  assert.deepEqual(result.failedDates, []);
  const dates = (db.raw.prepare("SELECT service_date FROM network_blobs ORDER BY service_date;").all() as Array<{
    service_date: string;
  }>).map((r) => r.service_date);
  assert.deepEqual(dates, [TODAY, TOMORROW]);

  const net = await loadTodayNetwork(deps(db));
  assert.ok(net);
  assert.equal(net.meta.serviceDate, TODAY);
  assert.equal(net.stops.count, 8);
  for (const f of FEED_IDS) {
    assert.equal(net.meta.feeds[f].included, true);
    assert.match(net.meta.feeds[f].hash, /^[0-9a-f]{8}$/);
  }
});

test("unchanged hash skips re-reading the feed", async () => {
  const db = createTestDb();
  await refreshTransitNetwork(deps(db));
  // A day later on the same service date (the feeds' ages are pushed back
  // instead, so no new date needs building).
  db.raw.exec(`UPDATE feed_meta SET fetched_at = fetched_at - ${FEED_MAX_AGE_MS};`);
  relaunch();
  const before = await loadBlob(db, TODAY);
  requests = [];
  // Sliced work other than hashing (which returns the hex string): reads, compiles.
  let heavy = 0;
  const result = await refreshTransitNetwork(
    deps(db, {
      runSteps: async (gen, ms) => {
        const out = await runSteps(gen, ms);
        if (typeof out !== "string") heavy++;
        return out;
      },
    }),
  );
  assert.equal(requests.length, 4);
  assert.equal(heavy, 0);
  assert.deepEqual(result.rebuilt, []);
  const rows = db.raw.prepare("SELECT fetched_at FROM feed_meta;").all() as Array<{ fetched_at: number }>;
  assert.ok(rows.every((r) => Number(r.fetched_at) >= START));
  assert.equal((await loadBlob(db, TODAY))?.builtAt, before?.builtAt);
});

test("a changed feed rebuilds both dates", async () => {
  const db = createTestDb();
  await refreshTransitNetwork(deps(db));
  db.raw.exec(`UPDATE feed_meta SET fetched_at = fetched_at - ${FEED_MAX_AGE_MS};`);
  relaunch();
  zips.rail = railZip(" (new)");
  try {
    const result = await refreshTransitNetwork(deps(db));
    assert.deepEqual(result.rebuilt, [TODAY, TOMORROW]);
    assert.ok(await loadTodayNetwork(deps(db)));
  } finally {
    zips.rail = railZip();
  }
});

test("keeps the previous blob when compile throws", async () => {
  const db = createTestDb();
  await refreshTransitNetwork(deps(db));
  const before = await loadBlob(db, TODAY);
  db.raw.exec(`UPDATE feed_meta SET fetched_at = fetched_at - ${FEED_MAX_AGE_MS};`);
  relaunch();
  zips.rail = railZip(" (new)");
  try {
    const result = await refreshTransitNetwork(
      deps(db, {
        runSteps: async (gen, ms) => {
          const out = await runSteps(gen, ms);
          if (out && typeof out === "object" && "patterns" in out) throw new Error("compile blew up");
          return out;
        },
      }),
    );
    assert.deepEqual(result.rebuilt, []);
    assert.deepEqual(result.failedDates, [TODAY, TOMORROW]);
    const after = await loadBlob(db, TODAY);
    assert.equal(after?.builtAt, before?.builtAt);
    assert.deepEqual(Array.from(after?.data ?? []), Array.from(before?.data ?? []));
    assert.ok(await loadTodayNetwork(deps(db)));
  } finally {
    zips.rail = railZip();
  }
});

test("offline: downloads fail but the saved blob still loads", async () => {
  const db = createTestDb();
  await refreshTransitNetwork(deps(db));
  db.raw.exec(`UPDATE feed_meta SET fetched_at = fetched_at - ${FEED_MAX_AGE_MS};`);
  relaunch();
  globalThis.fetch = (async () => {
    throw new TypeError("Network request failed");
  }) as typeof fetch;
  const result = await refreshTransitNetwork(deps(db));
  assert.equal(result.offline, true);
  assert.deepEqual(result.failedFeeds, [...FEED_IDS]);
  assert.deepEqual(result.rebuilt, []);
  const net = await loadTodayNetwork(deps(db));
  assert.equal(net?.meta.serviceDate, TODAY);

  // First launch with no network at all: nothing to load, nothing built.
  const fresh = createTestDb();
  const none = await refreshTransitNetwork(deps(fresh));
  assert.equal(none.offline, true);
  assert.equal(await loadTodayNetwork(deps(fresh)), null);
});

test("corrupt blob (NetworkFormatError) triggers a rebuild", async () => {
  const db = createTestDb();
  await refreshTransitNetwork(deps(db));
  const good = await loadBlob(db, TODAY);
  assert.ok(good);
  await saveBlob(db, TODAY, good.version, good.builtAt, good.data.subarray(0, 64));
  assert.equal(await loadTodayNetwork(deps(db)), null);
  requests = [];
  const result = await refreshTransitNetwork(deps(db));
  assert.equal(requests.length, 0);
  assert.deepEqual(result.rebuilt, [TODAY]);
  assert.ok(await loadTodayNetwork(deps(db)));
});

/** The synthetic rail feed with its timetable ending 20261231. */
function expiringRailZip(): Uint8Array {
  return zipSync({
    ...unzipSync(railZip()),
    "calendar.txt": strToU8(CALENDAR.replace("20271231", "20261231")),
  });
}

/** 2027-01-02 10:00 MYT: two days past that rail timetable's end. */
const AFTER_RAIL_END = Date.UTC(2027, 0, 2, 2, 0, 0);

test("an expired feed is compiled out (meta.feeds.rail.included === false, no rail: stops)", async () => {
  c.t = AFTER_RAIL_END;
  relaunch();
  zips.rail = expiringRailZip();
  try {
    const db = createTestDb();
    const result = await refreshTransitNetwork(deps(db));
    assert.deepEqual(result.failedFeeds, []);
    assert.deepEqual(result.rebuilt, ["20270102", "20270103"]);

    const net = await loadTodayNetwork(deps(db));
    assert.ok(net);
    assert.equal(net.meta.feeds.rail.included, false);
    assert.equal(net.meta.feeds.rail.validUntil, "20261231");
    for (const f of FEED_IDS.filter((f) => f !== "rail")) assert.equal(net.meta.feeds[f].included, true);
    assert.equal(net.stops.id.filter((id) => id.startsWith("rail:")).length, 0);
    assert.ok(net.stops.id.some((id) => id.startsWith("ktm:")));

    const health = await loadHealth(deps(db));
    assert.equal(health.rail?.state, "expired");
    assert.equal(health.rail?.included, false);
    assert.equal(health.ktm?.state, "ok");
    assert.equal(healthNote(health), "Rail timetable from data.gov.my has expired. Showing bus-only routes.");
    // Same answer from the network already in memory.
    assert.deepEqual(await loadHealth(deps(db), net.meta), health);
  } finally {
    zips.rail = railZip();
  }
});

test("loadHealth: dates alone without a blob, and absent feeds stay absent", async () => {
  const db = createTestDb();
  assert.deepEqual(await loadHealth(deps(db)), {});
  c.t = AFTER_RAIL_END;
  relaunch();
  zips.rail = expiringRailZip();
  try {
    await refreshTransitNetwork(deps(db));
    db.raw.exec("DELETE FROM network_blobs;");
    const health = await loadHealth(deps(db));
    assert.equal(health.rail?.state, "expired");
    assert.equal(health["bus-kl"]?.state, "ok");
    // 20270102 → 20271231.
    assert.equal(health["bus-kl"]?.daysLeft, 363);
  } finally {
    zips.rail = railZip();
  }
});
