import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  GTFS_STATIC_URL,
  RouteNotFoundError,
  getRouteBundle,
  resetGtfsFeedCacheForTests,
  searchFeedRoutes,
} from "../gtfsFeed";

function feedZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "R1,T816,Kelana Jaya - Damansara Utama\n" +
        "R2,T789,Other Feeder\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "S1,Hotel Lisa De Inn,3.1005,101.6234\n" +
        "S2,MRT Phileo Damansara Pintu A,3.1010,101.6240\n" +
        "S3,Other Stop,3.2,101.7\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "R1,WK,T816-1,SH1,0\n" +
        "R2,WK,T789-1,SH2,0\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,S1,1,07:00:00,07:00:00\n" +
        "T816-1,S2,2,07:10:00,07:10:00\n" +
        "T789-1,S3,1,08:00:00,08:00:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        "SH1,3.1005,101.6234,1\n" +
        "SH1,3.1010,101.6240,2\n" +
        "SH2,3.2,101.7,1\n" +
        "SH2,3.21,101.71,2\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,0,0,20260101,20271231\n",
    ),
  });
}

let calls: string[] = [];

beforeEach(() => {
  resetGtfsFeedCacheForTests();
  calls = [];
  const bytes = feedZip();
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
});

test("downloads the official data.gov.my feed, not a BusBuddy server", async () => {
  await searchFeedRoutes("T816");
  assert.deepEqual(calls, [GTFS_STATIC_URL]);
  assert.match(GTFS_STATIC_URL, /^https:\/\/api\.data\.gov\.my\/gtfs-static\/prasarana\?category=rapid-bus-mrtfeeder$/);
});

test("searches by route code and by stop name", async () => {
  const byCode = await searchFeedRoutes("t816");
  assert.equal(byCode[0]?.code, "T816");
  const byStop = await searchFeedRoutes("Phileo");
  assert.ok(byStop.some((h) => h.code === "T816"));
});

test("concurrent callers share one download", async () => {
  await Promise.all([searchFeedRoutes("T816"), getRouteBundle("T816"), searchFeedRoutes("T789")]);
  assert.equal(calls.length, 1);
});

test("route bundle carries the route's data plus its traffic signals", async () => {
  const bundle = await getRouteBundle("t816");
  assert.deepEqual(bundle.routes.map((r) => r.code), ["T816"]);
  assert.deepEqual(bundle.trips.map((t) => t.trip_id), ["T816-1"]);
  assert.ok(Array.isArray(bundle.trafficSignals?.T816));
  assert.ok((bundle.trafficSignals?.T816?.length ?? 0) > 0);
});

test("unknown route → RouteNotFoundError", async () => {
  await assert.rejects(getRouteBundle("NOPE"), RouteNotFoundError);
});

test("HTTP failure surfaces as an error and isn't cached", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  await assert.rejects(searchFeedRoutes("T816"), /GTFS static 503/);
  const bytes = feedZip();
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
  const hits = await searchFeedRoutes("T816");
  assert.equal(hits[0]?.code, "T816");
});

test("an aborted caller stops waiting without breaking the shared download", async () => {
  const ctrl = new AbortController();
  const aborted = searchFeedRoutes("T816", ctrl.signal);
  ctrl.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  const hits = await searchFeedRoutes("T816");
  assert.equal(hits[0]?.code, "T816");
});
