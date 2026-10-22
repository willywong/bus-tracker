import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { strToU8, zipSync } from "fflate";

import { FEED_IDS } from "@bus-tracker/shared";
import {
  STATIC_MAX_REQUESTS,
  STATIC_WINDOW_MS,
  createStaticLimiter,
  downloadTransitFeeds,
  getRouteBundle,
  prewarmRouteSearch,
  resetGtfsFeedCacheForTests,
  setStaticLimiter,
  TRANSIT_FEED_SPACING_MS,
} from "../gtfsFeed";
import { createTestDb } from "../../db/__tests__/nodeDb";
import { sqliteStaticRequestLog } from "../../db/staticRequestLog";

/** A fake clock whose `sleep` moves time forward and records each wait. */
function fakeClock() {
  const c = {
    t: 0,
    waits: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.waits.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetGtfsFeedCacheForTests());

test("grants 3 at once, the 4th waits until the oldest leaves the 60 s window", async () => {
  const c = fakeClock();
  const limiter = createStaticLimiter(c);
  assert.equal(STATIC_MAX_REQUESTS, 3);
  assert.equal(STATIC_WINDOW_MS, 60_000);
  await limiter.acquire();
  c.t = 10_000;
  await limiter.acquire();
  c.t = 20_000;
  await limiter.acquire();
  assert.deepEqual(c.waits, []);
  c.t = 30_000;
  await limiter.acquire();
  // The first grant (t=0) leaves the window at t=60 000.
  assert.deepEqual(c.waits, [30_000]);
  assert.equal(c.t, 60_000);
});

test("spare: true allows a 4th within the window, but not a 5th", async () => {
  const c = fakeClock();
  const limiter = createStaticLimiter(c);
  for (let i = 0; i < 3; i++) await limiter.acquire();
  await limiter.acquire({ spare: true });
  assert.deepEqual(c.waits, []);
  await limiter.acquire({ spare: true });
  assert.deepEqual(c.waits, [60_000]);
});

test("waiters are served FIFO", async () => {
  const c = fakeClock();
  const limiter = createStaticLimiter({ ...c, max: 1 });
  const order: string[] = [];
  await Promise.all(
    ["a", "b", "c", "d"].map((id) => limiter.acquire().then(() => order.push(`${id}@${c.t}`))),
  );
  assert.deepEqual(order, ["a@0", "b@60000", "c@120000", "d@180000"]);
});

test("an aborted waiter rejects with AbortError and takes no slot", async () => {
  // A real-time sleep the test never waits out: the abort must cut it short.
  let t = 0;
  const limiter = createStaticLimiter({
    now: () => t,
    sleep: () => new Promise<void>(() => {}),
    max: 1,
  });
  await limiter.acquire();
  const ctrl = new AbortController();
  const waiting = limiter.acquire({ signal: ctrl.signal });
  await tick();
  ctrl.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  // Already aborted: rejects straight away.
  await assert.rejects(limiter.acquire({ signal: ctrl.signal }), { name: "AbortError" });
  // Neither took the slot: once the first grant leaves the window, the next
  // caller is granted without waiting again.
  t = STATIC_WINDOW_MS;
  await limiter.acquire();
});

function busZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8("route_id,route_short_name,route_long_name\nR1,300,Kuantan\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nQ1,Terminal,3.8,103.3\nQ2,Town,3.81,103.31\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id\nR1,WK,T1\n"),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,07:30:00,07:30:00,Q1,1\nT1,07:40:00,07:40:00,Q2,2\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,1,1,20260101,20271231\n",
    ),
  });
}

const S3 = "https://openapi-malaysia-transport.s3.ap-southeast-1.amazonaws.com/prasarana";
const isApi = (url: string) => url.startsWith("https://api.data.gov.my/");

/**
 * A virtual clock for several concurrent sleepers: `sleep` parks until the
 * clock reaches its deadline, and `run` lets the work in flight settle, then
 * jumps to the next deadline, until nothing is left waiting.
 */
function virtualClock() {
  const timers: Array<{ at: number; wake: () => void }> = [];
  const c = {
    t: 0,
    now: () => c.t,
    sleep: (ms: number) =>
      new Promise<void>((wake) => {
        timers.push({ at: c.t + Math.max(0, ms), wake });
      }),
    /** Runs `fn` once the clock reaches `at`. */
    at(at: number, fn: () => void) {
      timers.push({ at, wake: fn });
    },
    async run() {
      for (;;) {
        for (let i = 0; i < 20; i++) await tick();
        if (timers.length === 0) return;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift()!;
        c.t = Math.max(c.t, next.at);
        next.wake();
      }
    },
  };
  return c;
}

/** Every rolling window from a request holds at most `STATIC_MAX_REQUESTS`. */
function assertWithinLimit(times: readonly number[]) {
  for (const start of times) {
    const inWindow = times.filter((t) => t >= start && t < start + STATIC_WINDOW_MS).length;
    assert.ok(inWindow <= STATIC_MAX_REQUESTS, `${inWindow} requests in the 60 s from ${start}: ${times}`);
  }
}

test("refresh + route-search prewarm racing at launch: ≤ 3 per rolling 60 s, refresh requests ≥ 16 s apart", async () => {
  const c = virtualClock();
  setStaticLimiter(createStaticLimiter(c));
  const requests: Array<{ at: number; url: string }> = [];
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    if (isApi(url)) requests.push({ at: c.t, url });
    if (url.includes("rapid-bus-kuantan")) return new Response("not found", { status: 404 });
    return new Response(busZip());
  }) as typeof fetch;

  // As at launch: the add-route screen's prewarm and the network refresh
  // start in the same tick.
  prewarmRouteSearch();
  const refresh = downloadTransitFeeds(FEED_IDS, { now: c.now, sleep: c.sleep });
  await c.run();
  const { ok, failed } = await refresh;

  assert.deepEqual(failed, []);
  assert.deepEqual(ok.map((d) => d.feed), [...FEED_IDS]);
  // 4 prewarm (feeder, kl, penang, kuantan) + rail + ktm; the network's two
  // bus feeds share prewarm's downloads.
  assert.equal(requests.length, 6);
  assertWithinLimit(requests.map((r) => r.at));
  const refreshOnly = requests.filter((r) => /rapid-rail-kl|ktmb/.test(r.url)).map((r) => r.at);
  assert.equal(refreshOnly.length, 2);
  assert.ok(refreshOnly[1] - refreshOnly[0] >= TRANSIT_FEED_SPACING_MS, `rail→ktm ${refreshOnly}`);
});

test("refresh alone sends its requests ≥ 16 s apart", async () => {
  const c = virtualClock();
  setStaticLimiter(createStaticLimiter(c));
  const times: number[] = [];
  globalThis.fetch = (async (input: string) => {
    if (isApi(String(input))) times.push(c.t);
    return new Response(busZip());
  }) as typeof fetch;
  const refresh = downloadTransitFeeds(FEED_IDS, { now: c.now, sleep: c.sleep });
  await c.run();
  assert.deepEqual((await refresh).failed, []);
  // rail, bus-kl, feeder at 0/16/32 s; ktm waits for rail's slot to free up.
  assert.deepEqual(times, [0, 16_000, 32_000, 60_000]);
  assertWithinLimit(times);
});

test("two JS runtimes sharing the SQLite request log stay within 3 per rolling 60 s", async () => {
  // The Simulator log behind this: a dev reload left the first runtime (A)
  // running. A sent rail/feeder/bus-kl at 19:28:56.72 and held ktm for its
  // own window; B started at 19:29:50 with a fresh in-memory limiter and
  // sent rail/bus-kl/feeder at once, then A's ktm went at 19:29:56.73: four
  // in 6.5 s. With the grants in SQLite, B sees A's.
  const run = async (shared: boolean) => {
    const c = virtualClock();
    const db = createTestDb();
    const log = shared ? sqliteStaticRequestLog(async () => db) : null;
    const a = createStaticLimiter({ ...c, log: () => log });
    const b = createStaticLimiter({ ...c, log: () => log });
    const sent: number[] = [];
    const send = (limiter: typeof a, n: number) =>
      (async () => {
        for (let i = 0; i < n; i++) {
          await limiter.acquire();
          sent.push(c.t);
        }
      })();
    const done = [send(a, 4)];
    c.at(53_530, () => done.push(send(b, 4)));
    await c.run();
    await Promise.all(done);
    return sent;
  };
  // Separate in-memory limiters reproduce the burst.
  const apart = await run(false);
  assert.deepEqual(apart, [0, 0, 0, 53_530, 53_530, 53_530, 60_000, 113_530]);
  // Sharing the log, every window holds at most 3.
  const sharedTimes = await run(true);
  assert.equal(sharedTimes.length, 8);
  assertWithinLimit(sharedTimes);
});

test("the S3 mirror does not take a slot", async () => {
  const c = fakeClock();
  setStaticLimiter(createStaticLimiter({ ...c, max: 1 }));
  const calls: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (url === `${S3}/gtfs_rapid_bus_kuantan.zip`) return new Response(busZip());
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const bundle = await getRouteBundle("300 Kuantan");
  assert.equal(bundle.routes[0]?.code, "300 Kuantan");
  assert.deepEqual(calls, [
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kuantan",
    `${S3}/gtfs_rapid_bus_kuantan.zip`,
  ]);
  // The API request took the only slot; the mirror didn't wait for another.
  assert.deepEqual(c.waits, []);
});
