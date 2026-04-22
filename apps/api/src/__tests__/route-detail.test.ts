import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { createRouteDetailApp } from "../../api/route/[code].js";
import { GtfsBundleService } from "../gtfs-service.js";

function fakeZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "R_T816,T816,Mutiara - Phileo MRT\n" +
        "R_T815,T815,Kota Damansara Feeder\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "R_T816,WK,T816-1,SH816,0\n" +
        "R_T815,WK,T815-1,SH815,0\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "S1,Phileo Damansara MRT,3.1,101.6\n" +
        "S2,Mutiara Damansara,3.11,101.61\n" +
        "S3,Kota Damansara Stop,3.12,101.62\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,S1,1,07:00:00,07:00:00\n" +
        "T816-1,S2,2,07:10:00,07:10:00\n" +
        "T815-1,S3,1,07:00:00,07:00:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        "SH816,3.1,101.6,1\nSH816,3.11,101.61,2\n" +
        "SH815,3.12,101.62,1\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,0,0,20260101,20261231\n",
    ),
  });
}

function makeApp() {
  const svc = new GtfsBundleService(async () => fakeZip(), () => 1_000);
  return createRouteDetailApp(svc);
}

interface BundleResponse {
  routes: Array<{ route_id: string; code: string }>;
  trips: Array<{ route_id: string; trip_id: string }>;
  stopTimes: Array<{ trip_id: string; stop_id: string }>;
  trafficSignals?: Record<string, unknown[]>;
}

test("route-detail: returns single-route bundle for T816", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/route/T816"));
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("cache-control") ?? "",
    /max-age=86400/,
  );
  const body = (await res.json()) as BundleResponse;
  assert.equal(body.routes.length, 1);
  assert.equal(body.routes[0].code, "T816");
  assert.ok(body.trips.every((t) => t.route_id === "R_T816"));
  assert.ok(body.stopTimes.length > 0);
});

test("route-detail: 404 on unknown code", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/route/XYZ"));
  assert.equal(res.status, 404);
});

test("route-detail: case-insensitive code match", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/route/t816"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as BundleResponse;
  assert.equal(body.routes[0].code, "T816");
});

test("route-detail: 400 on empty code", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/route/%20%20"));
  assert.equal(res.status, 400);
});

test("route-detail: 400 on overlong code", async () => {
  const app = makeApp();
  const res = await app.fetch(
    new Request("https://local/api/route/ABCDEFGHIJKLMNOPQ"),
  );
  assert.equal(res.status, 400);
});

test("route-detail: traffic signals only include requested route key", async () => {
  const app = makeApp();
  const res = await app.fetch(new Request("https://local/api/route/T816"));
  const body = (await res.json()) as BundleResponse;
  if (body.trafficSignals) {
    for (const key of Object.keys(body.trafficSignals)) {
      assert.equal(key, "T816", `unexpected signal key ${key}`);
    }
  }
});
