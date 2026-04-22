import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { createRoutesSearchApp } from "../../api/routes/search.js";
import { GtfsBundleService } from "../gtfs-service.js";

function fakeZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "R_T816,T816,Mutiara - Phileo MRT\n" +
        "R_T815,T815,Kota Damansara Feeder\n" +
        "R_PJ01,PJ01,Petaling Jaya Loop 1\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "R_T816,WK,T816-1,SH816,0\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "S1,Phileo Damansara MRT,3.1,101.6\n" +
        "S2,Mutiara Damansara,3.11,101.61\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,S1,1,07:00:00,07:00:00\n" +
        "T816-1,S2,2,07:10:00,07:10:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,0,0,20260101,20261231\n",
    ),
  });
}

function makeApp() {
  const svc = new GtfsBundleService(async () => fakeZip(), () => 1_000);
  return createRoutesSearchApp(svc);
}

test("routes-search: returns 400 when q missing", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/routes/search"));
  assert.equal(res.status, 400);
});

test("routes-search: returns 400 when q empty after trim", async () => {
  const app = makeApp();
  const res = await app.fetch(
    new Request("https://local/api/routes/search?q=%20%20"),
  );
  assert.equal(res.status, 400);
});

test("routes-search: 200 with T816 hit on ?q=T816", async () => {
  const app = makeApp();
  const res = await app.fetch(
    new Request("https://local/api/routes/search?q=T816"),
  );
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("cache-control") ?? "",
    /max-age=300/,
  );
  assert.match(
    res.headers.get("cache-control") ?? "",
    /stale-while-revalidate=86400/,
  );
  const hits = (await res.json()) as Array<{ code: string }>;
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].code, "T816");
});

test("routes-search: 200 with empty array on nonsense query", async () => {
  const app = makeApp();
  const res = await app.fetch(
    new Request("https://local/api/routes/search?q=zzzzzzz"),
  );
  assert.equal(res.status, 200);
  const hits = (await res.json()) as unknown[];
  assert.deepEqual(hits, []);
});

test("routes-search: 503 on cold upstream failure", async () => {
  const svc = new GtfsBundleService(async () => {
    throw new Error("upstream 500");
  });
  const app = createRoutesSearchApp(svc);
  const res = await app.fetch(
    new Request("https://local/api/routes/search?q=T816"),
  );
  assert.equal(res.status, 503);
});
