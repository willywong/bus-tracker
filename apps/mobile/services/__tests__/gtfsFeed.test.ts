import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  GTFS_STATIC_URL,
  RouteNotFoundError,
  getRouteBundle,
  resetGtfsFeedCacheForTests,
  searchFeedRoutes,
  setSearchIndexStore,
  setStaticFetch,
  setStaticLimiter,
  type SearchIndexStore,
} from "../gtfsFeed";

const CALENDAR =
  "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
  "WK,1,1,1,1,1,0,0,20260101,20271231\n";

function feederZip(): Uint8Array {
  return zipSync({
    // Feeder style: code in route_long_name, short name blank.
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "30000025,,T816\n" +
        "30000026,,T789\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "S1,Hotel Lisa De Inn,3.1005,101.6234\n" +
        "S2,MRT Phileo Damansara Pintu A,3.1010,101.6240\n" +
        "S3,Other Stop,3.2,101.7\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "30000025,WK,T816-1,SH1,0\n" +
        "30000026,WK,T789-1,SH2,0\n",
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
    "calendar.txt": strToU8(CALENDAR),
  });
}

function klZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,agency_id,route_short_name,route_long_name\n" +
        "U4000,rapidkl,400,Damai Perdana ~ Hab Pasar Seni\n" +
        "U3030,rapidkl,303,Taman Mulia Jaya ~ Lebuh Ampang\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "K1,Damai Perdana,3.05,101.75\n" +
        "K2,Hab Pasar Seni,3.14,101.69\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "U4000,WK,wk_U4000_0,SHK,0\n" +
        // Withheld from stop_times.txt upstream (the ~2% data.gov.my drops).
        "U4000,WK,wk_U4000_gone,SHK,0\n" +
        "U3030,WK,wk_U3030_0,SHK,0\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "wk_U4000_0,06:00:00,06:00:00,K1,1\n" +
        "wk_U4000_0,06:40:00,06:40:00,K2,2\n" +
        "wk_U3030_0,07:00:00,07:00:00,K2,1\n",
    ),
    "frequencies.txt": strToU8(
      "trip_id,start_time,end_time,headway_secs,exact_times\n" +
        "wk_U4000_0,06:00:00,07:00:00,1800,0\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        "SHK,3.05,101.75,1\n" +
        "SHK,3.14,101.69,2\n",
    ),
    "calendar.txt": strToU8(CALENDAR),
  });
}

function penangZip(): Uint8Array {
  return zipSync({
    // Reuses the feeder's route and stop ids, and Rapid KL's code 303.
    "routes.txt": strToU8(
      "route_id,agency_id,route_short_name,route_long_name\n" +
        "30000025,rapidpg,303,303\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" + "S1,Komtar,5.41,100.33\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "30000025,WK,PG-1,SHP,0\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "PG-1,09:00:00,09:00:00,S1,1\n",
    ),
    "calendar.txt": strToU8(CALENDAR),
  });
}

function kuantanZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,agency_id,route_short_name,route_long_name\n" +
        "K3000,rapidktn,300,Terminal Makmur ~ Kuantan\n",
    ),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\n" + "Q1,Terminal Makmur,3.8,103.3\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id\n" + "K3000,WK,KT-1\n"),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "KT-1,07:30:00,07:30:00,Q1,1\n",
    ),
    "calendar.txt": strToU8(CALENDAR),
  });
}

const S3 = "https://openapi-malaysia-transport.s3.ap-southeast-1.amazonaws.com/prasarana";

let calls: string[] = [];

function serve(url: string): Response {
  const u = String(url);
  if (u.endsWith("category=rapid-bus-mrtfeeder")) return new Response(feederZip());
  if (u.endsWith("category=rapid-bus-kl")) return new Response(klZip());
  if (u.endsWith("category=rapid-bus-penang")) return new Response(penangZip());
  // Mirrors data.gov.my today: the Kuantan API 404s, the S3 object exists.
  if (u === `${S3}/gtfs_rapid_bus_kuantan.zip`) return new Response(kuantanZip());
  return new Response("not found", { status: 404 });
}

/** Fresh caches. Request pacing has its own tests (staticLimiter.test.ts), so nothing waits here. */
function reset(): void {
  resetGtfsFeedCacheForTests();
  setStaticLimiter({ acquire: async () => {} });
  setStaticFetch((url) => fetch(url));
}

beforeEach(() => {
  reset();
  calls = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return serve(url);
  }) as typeof fetch;
});

test("downloads the official data.gov.my feeds, not a BusBuddy server", async () => {
  await searchFeedRoutes("T816");
  assert.match(GTFS_STATIC_URL, /^https:\/\/api\.data\.gov\.my\/gtfs-static\/prasarana\?category=rapid-bus-mrtfeeder$/);
  assert.deepEqual(calls.slice(0, 4).sort(), [
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl",
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kuantan",
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder",
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang",
  ]);
  assert.ok(calls.every((u) => u.startsWith("https://api.data.gov.my/") || u.startsWith(S3)));
});

test("searches by route code and by stop name", async () => {
  const byCode = await searchFeedRoutes("t816");
  assert.equal(byCode[0]?.code, "T816");
  assert.equal(byCode[0]?.network, "MRT Feeder");
  const byStop = await searchFeedRoutes("Phileo");
  assert.ok(byStop.some((h) => h.code === "T816"));
});

test("search covers every bus network and keeps clashing codes apart", async () => {
  const hits = await searchFeedRoutes("303");
  assert.deepEqual(
    hits.map((h) => [h.code, h.category]),
    [
      ["303", "rapid-bus-kl"],
      ["303 Penang", "rapid-bus-penang"],
    ],
  );
  // 400 names Pasar Seni in its long name; 303 only stops there.
  const kl = await searchFeedRoutes("pasar seni");
  assert.deepEqual(kl.map((h) => h.code), ["400", "303"]);
  const kuantan = await searchFeedRoutes("300 kuantan");
  assert.equal(kuantan[0]?.code, "300 Kuantan");
});

test("one network failing doesn't break search", async () => {
  globalThis.fetch = (async (url: string) =>
    String(url).includes("rapid-bus-penang") ? new Response("down", { status: 503 }) : serve(url)) as typeof fetch;
  const hits = await searchFeedRoutes("400");
  assert.equal(hits[0]?.code, "400");
});

test("concurrent callers share one download per feed", async () => {
  await Promise.all([searchFeedRoutes("T816"), getRouteBundle("T816"), searchFeedRoutes("T789")]);
  const feederCalls = calls.filter((u) => u.endsWith("rapid-bus-mrtfeeder"));
  assert.equal(feederCalls.length, 1);
});

test("feeder bundle keeps raw ids and carries traffic signals", async () => {
  const bundle = await getRouteBundle("t816");
  assert.equal(bundle.category, "rapid-bus-mrtfeeder");
  assert.deepEqual(bundle.routes.map((r) => [r.route_id, r.code]), [["30000025", "T816"]]);
  assert.deepEqual(bundle.trips.map((t) => t.trip_id), ["T816-1"]);
  assert.ok((bundle.trafficSignals?.T816?.length ?? 0) > 0);
  // Only the feeder feed is needed for a feeder route.
  assert.deepEqual(calls, [GTFS_STATIC_URL]);
});

test("Rapid KL bundle: namespaced ids, expanded headways, withheld trips dropped", async () => {
  const bundle = await getRouteBundle("400");
  assert.equal(bundle.category, "rapid-bus-kl");
  assert.deepEqual(bundle.routes.map((r) => [r.route_id, r.code]), [["kl:U4000", "400"]]);
  assert.deepEqual(
    bundle.trips.map((t) => t.trip_id),
    ["kl:wk_U4000_0@06:00", "kl:wk_U4000_0@06:30", "kl:wk_U4000_0@07:00"],
  );
  assert.ok(bundle.trips.every((t) => t.service_id === "kl:WK"));
  const lastStop = bundle.stopTimes.filter((st) => st.trip_id === "kl:wk_U4000_0@07:00");
  assert.deepEqual(lastStop.map((st) => [st.stop_id, st.departure_time]), [
    ["kl:K1", "07:00:00"],
    ["kl:K2", "07:40:00"],
  ]);
  assert.deepEqual(bundle.trafficSignals, {});
});

test("a bare key still finds a Rapid KL route when the feeder feed is down", async () => {
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return String(url).endsWith("rapid-bus-mrtfeeder") ? new Response("down", { status: 503 }) : serve(url);
  }) as typeof fetch;
  const bundle = await getRouteBundle("400");
  assert.equal(bundle.category, "rapid-bus-kl");
  await assert.rejects(getRouteBundle("T816"), /GTFS static 503/);
});

test("a category hint skips the feeds the route isn't in", async () => {
  await getRouteBundle("400", undefined, "rapid-bus-kl");
  assert.deepEqual(calls, ["https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl"]);
});

test("Penang route keys don't collide with Rapid KL or feeder ids", async () => {
  const bundle = await getRouteBundle("303 Penang");
  assert.equal(bundle.category, "rapid-bus-penang");
  assert.deepEqual(bundle.routes.map((r) => [r.route_id, r.code]), [["pg:30000025", "303 Penang"]]);
  assert.deepEqual(bundle.stops.map((s) => s.stop_id), ["pg:S1"]);
  assert.ok(calls.every((u) => u.includes("rapid-bus-penang")));
});

test("Kuantan falls back to the S3 mirror when the API 404s", async () => {
  const bundle = await getRouteBundle("300 Kuantan");
  assert.deepEqual(bundle.routes.map((r) => r.route_id), ["kt:K3000"]);
  assert.deepEqual(calls, [
    "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kuantan",
    `${S3}/gtfs_rapid_bus_kuantan.zip`,
  ]);
});

test("unknown route → RouteNotFoundError", async () => {
  await assert.rejects(getRouteBundle("NOPE"), RouteNotFoundError);
});

test("HTTP failure surfaces as an error and isn't cached", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  await assert.rejects(searchFeedRoutes("T816"), /GTFS static 503/);
  globalThis.fetch = (async (url: string) => serve(url)) as typeof fetch;
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

/** An in-memory stand-in for the SQLite index store. */
function memoryStore() {
  const rows = new Map<string, { fetchedAt: number; data: unknown }>();
  const store: SearchIndexStore = {
    load: async (c) => rows.get(c) ?? null,
    save: async (c, fetchedAt, data) => {
      rows.set(c, { fetchedAt, data: JSON.parse(JSON.stringify(data)) });
    },
  };
  return { store, rows };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("saved indexes answer a search with no download at all", async () => {
  const { store, rows } = memoryStore();
  setSearchIndexStore(store);
  await searchFeedRoutes("T816");
  await settle();
  assert.equal(rows.size, 4);

  // A relaunch: memory gone, the saved indexes remain.
  reset();
  setSearchIndexStore(store);
  calls = [];
  const hits = await searchFeedRoutes("Phileo");
  assert.ok(hits.some((h) => h.code === "T816"));
  assert.deepEqual(calls, []);
});

test("a stale saved index answers at once and is rebuilt behind", async () => {
  const { store, rows } = memoryStore();
  setSearchIndexStore(store);
  await searchFeedRoutes("400");
  await settle();
  const old = Date.now() - 13 * 60 * 60 * 1000;
  for (const [c, row] of rows) rows.set(c, { ...row, fetchedAt: old });

  reset();
  setSearchIndexStore(store);
  calls = [];
  const hits = await searchFeedRoutes("400");
  assert.equal(hits[0]?.code, "400");
  await settle();
  assert.equal(calls.filter((u) => u.endsWith("rapid-bus-kl")).length, 1);
  assert.ok((rows.get("rapid-bus-kl")?.fetchedAt ?? 0) > old);
});

test("partial results arrive before the last feed is in", async () => {
  const partials: string[][] = [];
  const hits = await searchFeedRoutes("400", undefined, (p) => partials.push(p.map((h) => h.code)));
  assert.ok(partials.length >= 1 && partials.length <= 3);
  assert.equal(hits[0]?.code, "400");
});

test("static zips go through the injected static fetch", async () => {
  const seen: string[] = [];
  setStaticFetch(async (url) => {
    seen.push(url);
    return serve(url);
  });
  await getRouteBundle("T816");
  assert.deepEqual(seen, ["https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder"]);
});
