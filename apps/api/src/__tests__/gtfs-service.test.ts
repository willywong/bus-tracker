import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { GtfsBundleService } from "../gtfs-service.js";

function fakeZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n30000025,,T816\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n30000025,WK,T816-1,SH816,0\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\nS1,Hotel Lisa De Inn,3.1005,101.6234\nS2,PJ210,3.101,101.624\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT816-1,S1,1,07:00:00,07:00:00\nT816-1,S2,2,07:10:00,07:10:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH816,3.1005,101.6234,1\nSH816,3.1010,101.6240,2\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n",
    ),
  });
}

test("GtfsBundleService caches within TTL and refetches after", async () => {
  let calls = 0;
  let nowMs = 1_000;
  const svc = new GtfsBundleService(
    async () => {
      calls++;
      return fakeZip();
    },
    () => nowMs,
  );

  const first = await svc.getBundle();
  assert.equal(first.cached, false);
  assert.equal(calls, 1);
  assert.equal(first.bundle.routes[0].code, "T816");

  nowMs += 60 * 60 * 1000; // +1h
  const second = await svc.getBundle();
  assert.equal(second.cached, true);
  assert.equal(calls, 1);

  nowMs += 25 * 60 * 60 * 1000; // total > 24h since fetch
  const third = await svc.getBundle();
  assert.equal(third.cached, false);
  assert.equal(calls, 2);
});

test("GtfsBundleService serves stale cache when upstream fails", async () => {
  let nowMs = 1_000;
  let shouldFail = false;
  const svc = new GtfsBundleService(
    async () => {
      if (shouldFail) throw new Error("upstream 503");
      return fakeZip();
    },
    () => nowMs,
  );

  await svc.getBundle();
  nowMs += 25 * 60 * 60 * 1000;
  shouldFail = true;
  const stale = await svc.getBundle();
  assert.equal(stale.cached, true);
  assert.equal(stale.bundle.routes[0].code, "T816");
});

test("GtfsBundleService throws when no cache and upstream fails", async () => {
  const svc = new GtfsBundleService(async () => {
    throw new Error("cold boom");
  });
  await assert.rejects(svc.getBundle(), /cold boom/);
});

test("gtfs-static endpoint returns 200 with cache headers on miss then hit", async () => {
  const { createGtfsStaticApp } = await import("../../api/gtfs-static.js");
  const svc = new GtfsBundleService(async () => fakeZip(), () => 1_000);
  const app = createGtfsStaticApp(svc);

  const res1 = await app.fetch(
    new Request("https://local/api/gtfs-static"),
  );
  assert.equal(res1.status, 200);
  assert.match(res1.headers.get("cache-control") ?? "", /max-age=86400/);
  assert.match(
    res1.headers.get("cache-control") ?? "",
    /stale-while-revalidate=86400/,
  );
  assert.equal(res1.headers.get("x-cache"), "MISS");
  const body = (await res1.json()) as {
    stops: unknown[];
    routes: unknown[];
  };
  assert.ok(body.stops.length >= 2);
  assert.ok(body.routes.length >= 1);

  const res2 = await app.fetch(
    new Request("https://local/api/gtfs-static"),
  );
  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "HIT");
});

test("gtfs-static endpoint returns 503 on cold upstream failure", async () => {
  const { createGtfsStaticApp } = await import("../../api/gtfs-static.js");
  const svc = new GtfsBundleService(async () => {
    throw new Error("upstream 500");
  });
  const app = createGtfsStaticApp(svc);

  const res = await app.fetch(
    new Request("https://local/api/gtfs-static"),
  );
  assert.equal(res.status, 503);
});
