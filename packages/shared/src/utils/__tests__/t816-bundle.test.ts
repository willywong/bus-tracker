import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseGtfsZip } from "../gtfs-parser.js";
import { filterToT816 } from "../t816-bundle.js";

function realisticFixture(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "30000025,,T816\n" +
        "30000098,,T786\n" +
        "30000030,,PJ01\n" +
        "30000031,,PJ02\n" +
        "30000143,,T117\n",
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "30000025,WK,T816-1,SH816,0\n" +
        "30000025,WK,T816-2,SH816,0\n" +
        "30000098,WK,T786-1,SH786,0\n" +
        "30000143,WK,T117-1,SH117,0\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "S1,Hotel Lisa De Inn,3.1005,101.6234\n" +
        "S2,PJ210 Bangunan Sin Chew Daily,3.101,101.624\n" +
        "S3,Random T117 stop,3.2,101.7\n" +
        "S4,T816 extra,3.11,101.63\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,S1,1,07:00:00,07:00:00\n" +
        "T816-1,S2,2,07:10:00,07:10:00\n" +
        "T816-1,S4,3,07:15:00,07:15:00\n" +
        "T816-2,S2,1,08:00:00,08:00:00\n" +
        "T786-1,S1,1,07:05:00,07:05:00\n" +
        "T117-1,S3,1,07:00:00,07:00:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        shapeRows("SH816", 60) +
        shapeRows("SH786", 40) +
        shapeRows("SH117", 30),
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,0,0,20260101,20261231\n" +
        "WE,0,0,0,0,0,1,1,20260101,20261231\n",
    ),
  });
}

function shapeRows(shapeId: string, n: number): string {
  let out = "";
  for (let i = 1; i <= n; i++) {
    out += `${shapeId},${(3.1 + i * 0.0001).toFixed(4)},${(101.62 + i * 0.0001).toFixed(4)},${i}\n`;
  }
  return out;
}

test("filterToT816 reduces full GTFS to T816 + alt routes only", () => {
  const parsed = parseGtfsZip(realisticFixture());
  const bundle = filterToT816(parsed);

  assert.equal(bundle.routes.length, 4, "T816, T786, PJ01, PJ02");
  assert.deepEqual(
    bundle.routes.map((r) => r.code).sort(),
    ["PJ01", "PJ02", "T786", "T816"],
  );

  const t816 = bundle.routes.find((r) => r.code === "T816");
  assert.equal(t816?.route_id, "30000025");

  assert.ok(bundle.stops.length >= 2, "at least Hotel Lisa De Inn + PJ210");
  const stopNames = bundle.stops.map((s) => s.stop_name);
  assert.ok(stopNames.includes("Hotel Lisa De Inn"));
  assert.ok(stopNames.some((n) => n.startsWith("PJ210")));
  assert.ok(
    !stopNames.includes("Random T117 stop"),
    "stops for unrelated routes must be excluded",
  );

  assert.ok(bundle.shapes["SH816"], "T816 shape present");
  assert.ok(bundle.shapes["SH816"].length > 50, "polyline > 50 points");
  assert.ok(!bundle.shapes["SH117"], "T117 shape filtered out");

  assert.ok(bundle.shapes["SH816"].every((p, i, arr) => i === 0 || p.seq >= arr[i - 1].seq));

  assert.equal(bundle.calendar.length, 1, "only WK service referenced");
  assert.equal(bundle.calendar[0].service_id, "WK");

  assert.ok(bundle.stopTimes.every((st) => !st.trip_id.startsWith("T117")));
  assert.equal(typeof bundle.generatedAt, "number");
});

test("filterToT816 is tolerant when a code is missing", () => {
  const parsed = parseGtfsZip(realisticFixture());
  const bundle = filterToT816(parsed, ["T816", "T999"]);
  assert.equal(bundle.routes.length, 1);
  assert.equal(bundle.routes[0].code, "T816");
});
