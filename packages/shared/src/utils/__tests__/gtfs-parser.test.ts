import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseGtfsZip } from "../gtfs-parser.js";

function makeFixture(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name\n" +
        "T816,T816,Kelana Jaya - Damansara Utama\n" +
        "T786,T786,Other Feeder\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "1000328,Hotel Lisa De Inn,3.1005,101.6234\n" +
        '1001234,"PJ210 Bangunan Sin Chew Daily, Opp",3.1010,101.6240\n',
    ),
    "trips.txt": strToU8(
      "route_id,service_id,trip_id,shape_id,direction_id\n" +
        "T816,WK,T816-1,SH1,0\n" +
        "T816,WK,T816-2,SH1,1\n",
    ),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "T816-1,1000328,1,07:00:00,07:00:00\n" +
        "T816-1,1001234,2,07:10:00,07:10:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
        "SH1,3.1005,101.6234,1\n" +
        "SH1,3.1010,101.6240,2\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "WK,1,1,1,1,1,0,0,20260101,20261231\n",
    ),
  });
}

test("parseGtfsZip returns typed rows for each GTFS file", () => {
  const p = parseGtfsZip(makeFixture());

  assert.equal(p.routes.length, 2);
  assert.equal(p.routes[0].route_id, "T816");
  assert.equal(p.routes[0].route_long_name, "Kelana Jaya - Damansara Utama");

  assert.equal(p.stops.length, 2);
  assert.equal(p.stops[0].stop_name, "Hotel Lisa De Inn");
  assert.equal(p.stops[0].stop_lat, 3.1005);
  assert.equal(
    p.stops[1].stop_name,
    "PJ210 Bangunan Sin Chew Daily, Opp",
    "quoted field with embedded comma must be preserved",
  );

  assert.equal(p.trips.length, 2);
  assert.equal(p.trips[0].direction_id, 0);
  assert.equal(p.trips[1].direction_id, 1);

  assert.equal(p.stopTimes.length, 2);
  assert.equal(p.stopTimes[0].stop_sequence, 1);

  assert.equal(p.shapes.length, 2);
  assert.equal(p.shapes[1].shape_pt_sequence, 2);

  assert.equal(p.calendar.length, 1);
  assert.equal(p.calendar[0].monday, true);
  assert.equal(p.calendar[0].saturday, false);
  assert.equal(p.calendar[0].start_date, "20260101");
});

test("parseGtfsZip tolerates missing optional files", () => {
  const zip = zipSync({
    "routes.txt": strToU8("route_id,route_short_name\nT816,T816\n"),
  });
  const p = parseGtfsZip(zip);
  assert.equal(p.routes.length, 1);
  assert.equal(p.stops.length, 0);
  assert.equal(p.shapes.length, 0);
  assert.equal(p.calendar.length, 0);
});
