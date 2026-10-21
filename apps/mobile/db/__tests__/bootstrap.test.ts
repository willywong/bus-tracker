import { count, createTestDb } from "./nodeDb";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { strToU8, zipSync } from "fflate";

import { resetGtfsFeedCacheForTests } from "@/services/gtfsFeed";
import { bootstrapStaticGtfs, pruneRoute, resetBootstrapCacheForTests } from "../bootstrap";
import { migrate } from "../database";
import { getRoutePolyline, getStopsByIds } from "../queries";
import { META_KEYS } from "../schema";

const CALENDAR =
  "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
  "WK,1,1,1,1,1,0,0,20260101,20271231\n";

// T789's shape id. Tests set it to SH1 so the two feeder routes share a polyline.
let t789Shape = "SH2";

function feederZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8("route_id,route_short_name,route_long_name\n30000025,,T816\n30000026,,T789\n"),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\nS1,Hotel Lisa,3.10,101.62\nS2,MRT Phileo,3.11,101.63\nS3,Other,3.2,101.7\n",
    ),
    "trips.txt": strToU8(
      `route_id,service_id,trip_id,shape_id,direction_id\n30000025,WK,T816-1,SH1,0\n30000026,WK,T789-1,${t789Shape},0\n`,
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,S1,1,07:00:00,07:00:00\nT816-1,S2,2,07:10:00,07:10:00\n" +
        "T789-1,S2,1,08:00:00,08:00:00\nT789-1,S3,2,08:10:00,08:10:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        "SH1,3.10,101.62,1\nSH1,3.11,101.63,2\nSH2,3.11,101.63,1\nSH2,3.2,101.7,2\n",
    ),
    "calendar.txt": strToU8(CALENDAR),
  });
}

function klZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8("route_id,agency_id,route_short_name,route_long_name\nU4000,rapidkl,400,Damai ~ Pasar Seni\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nK1,Damai,3.05,101.75\nK2,Pasar Seni,3.14,101.69\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id,shape_id,direction_id\nU4000,WK,wk_U4000_0,SHK,0\n"),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "wk_U4000_0,06:00:00,06:00:00,K1,1\nwk_U4000_0,06:40:00,06:40:00,K2,2\n",
    ),
    "shapes.txt": strToU8("shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSHK,3.05,101.75,1\nSHK,3.14,101.69,2\n"),
    "calendar.txt": strToU8(CALENDAR),
  });
}

function penangZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8("route_id,agency_id,route_short_name,route_long_name\nP303,rapidpg,303,303\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nP1,Komtar,5.41,100.33\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id,shape_id,direction_id\nP303,WK,PG-1,,0\n"),
    "stop_times.txt": strToU8("trip_id,arrival_time,departure_time,stop_id,stop_sequence\nPG-1,09:00:00,09:00:00,P1,1\n"),
    "calendar.txt": strToU8(CALENDAR),
  });
}

let downloads: string[] = [];

beforeEach(() => {
  resetGtfsFeedCacheForTests();
  resetBootstrapCacheForTests();
  downloads = [];
  t789Shape = "SH2";
  globalThis.fetch = (async (url: string) => {
    const category = new URL(String(url)).searchParams.get("category") ?? String(url);
    downloads.push(category);
    if (category === "rapid-bus-mrtfeeder") return new Response(feederZip());
    if (category === "rapid-bus-kl") return new Response(klZip());
    if (category === "rapid-bus-penang") return new Response(penangZip());
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

test("a startup over several networks downloads each static zip once", async () => {
  const db = createTestDb();
  const result = await bootstrapStaticGtfs({ routes: ["T816", "303 Penang", "T789", "400"], db });
  assert.deepEqual(result.failed, []);
  assert.deepEqual([...result.refreshed].sort(), ["303 Penang", "400", "T789", "T816"]);
  assert.deepEqual([...downloads].sort(), ["rapid-bus-kl", "rapid-bus-mrtfeeder", "rapid-bus-penang"]);
  assert.equal(count(db, "routes"), 4);
});

function stopIds(db: ReturnType<typeof createTestDb>): string[] {
  return (db.raw.prepare("SELECT stop_id FROM stops ORDER BY stop_id;").all() as { stop_id: string }[]).map(
    (r) => r.stop_id,
  );
}

test("removing a route drops the stops no other route calls at", async () => {
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816", "T789"], db });
  assert.deepEqual(stopIds(db), ["S1", "S2", "S3"]);

  // S2 is shared with T816, so it stays.
  await pruneRoute(db, "T789");
  assert.deepEqual(stopIds(db), ["S1", "S2"]);

  await pruneRoute(db, "T816");
  assert.deepEqual(stopIds(db), []);
  assert.equal(count(db, "stop_times"), 0);
});

test("refreshing a route keeps its stops and the ones it shares", async () => {
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816", "T789"], db });
  await bootstrapStaticGtfs({ routes: ["T816"], db, force: true });
  assert.deepEqual(stopIds(db), ["S1", "S2", "S3"]);
});

test("getStopsByIds reads only the stops asked for", async () => {
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816", "T789"], db });
  const rows = await getStopsByIds(db, ["S3", "S1", "S1", "nope"]);
  assert.deepEqual(rows.map((r) => r.stop_id).sort(), ["S1", "S3"]);
  assert.deepEqual(await getStopsByIds(db, []), []);
});

function shapeIds(db: ReturnType<typeof createTestDb>): string[] {
  return (
    db.raw.prepare("SELECT DISTINCT shape_id FROM shape_points ORDER BY shape_id;").all() as { shape_id: string }[]
  ).map((r) => r.shape_id);
}

test("removing a route keeps a shape another route still draws", async () => {
  t789Shape = "SH1";
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816", "T789"], db });
  assert.deepEqual(shapeIds(db), ["SH1"]);

  await pruneRoute(db, "T816");
  assert.deepEqual(shapeIds(db), ["SH1"]);
  assert.equal((await getRoutePolyline(db, "30000026")).length, 2);

  await pruneRoute(db, "T789");
  assert.equal(count(db, "shape_points"), 0);
});

test("removing a route drops the shapes only it draws", async () => {
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816", "T789"], db });
  assert.deepEqual(shapeIds(db), ["SH1", "SH2"]);

  await pruneRoute(db, "T789");
  assert.deepEqual(shapeIds(db), ["SH1"]);
});

test("the v7 migration drops stops no stop_times row uses and keeps the cached bundle", async () => {
  const db = createTestDb();
  await bootstrapStaticGtfs({ routes: ["T816"], db });
  db.raw.exec("INSERT INTO stops(stop_id, stop_name, stop_lat, stop_lon) VALUES ('OLD', 'Left behind', 3, 101);");
  db.raw.exec(`INSERT OR REPLACE INTO meta(key, value) VALUES ('${META_KEYS.schemaVersion}', '6');`);
  const fetchedAt = db.raw.prepare("SELECT value FROM meta WHERE key = ?;").get(META_KEYS.fetchedAt);
  assert.ok(fetchedAt);

  await migrate(db);
  assert.deepEqual(stopIds(db), ["S1", "S2"]);
  assert.deepEqual(db.raw.prepare("SELECT value FROM meta WHERE key = ?;").get(META_KEYS.fetchedAt), fetchedAt);
});
