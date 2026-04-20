import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { createRefreshGtfsApp } from "../../api/cron/refresh-gtfs.js";
import { GtfsBundleService } from "../gtfs-service.js";

function fakeZip(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n30000025,,T816\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n30000025,WK,T816-1,SH1,0\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\nS1,Hotel Lisa De Inn,3.1005,101.6234\nS2,PJ210,3.101,101.624\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT816-1,S1,1,07:00:00,07:00:00\nT816-1,S2,2,07:10:00,07:10:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH1,3.1005,101.6234,1\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n",
    ),
  });
}

test("refresh-gtfs runs the pipeline and returns counts (no secret configured)", async () => {
  const svc = new GtfsBundleService(async () => fakeZip(), () => 42);
  const app = createRefreshGtfsApp(svc, undefined);

  const res = await app.fetch(
    new Request("https://local/api/cron/refresh-gtfs"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    refreshedAt: number;
    stops: number;
    trips: number;
    routes: number;
  };
  assert.equal(body.ok, true);
  assert.equal(body.refreshedAt, 42);
  assert.equal(body.routes, 1);
  assert.equal(body.stops, 2);
  assert.equal(body.trips, 1);
});

test("refresh-gtfs rejects unauthenticated requests when secret is set", async () => {
  const svc = new GtfsBundleService(async () => fakeZip());
  const app = createRefreshGtfsApp(svc, "s3cr3t");

  const missing = await app.fetch(
    new Request("https://local/api/cron/refresh-gtfs"),
  );
  assert.equal(missing.status, 401);

  const wrong = await app.fetch(
    new Request("https://local/api/cron/refresh-gtfs", {
      headers: { authorization: "Bearer wrong" },
    }),
  );
  assert.equal(wrong.status, 401);

  const ok = await app.fetch(
    new Request("https://local/api/cron/refresh-gtfs", {
      headers: { authorization: "Bearer s3cr3t" },
    }),
  );
  assert.equal(ok.status, 200);
});

test("refresh-gtfs reports 502 when upstream fetch fails", async () => {
  const svc = new GtfsBundleService(async () => {
    throw new Error("network down");
  });
  const app = createRefreshGtfsApp(svc, undefined);

  const res = await app.fetch(
    new Request("https://local/api/cron/refresh-gtfs"),
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /network down/);
});
