import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseGtfsZip } from "../gtfs-parser.js";
import { searchRoutes } from "../search-routes.js";

function fixture(): Uint8Array {
  const routeIds = Array.from({ length: 30 }, (_, i) => `R${i}`);
  const routesCsv =
    "route_id,route_short_name,route_long_name\n" +
    "R_T816,T816,Mutiara Damansara - Phileo Damansara MRT\n" +
    "R_T815,T815,Kota Damansara Feeder\n" +
    "R_T786,T786,Subang Jaya\n" +
    "R_PJ01,PJ01,Petaling Jaya Loop 1\n" +
    "R_PJ02,PJ02,Petaling Jaya Loop 2\n" +
    routeIds.map((id, i) => `${id},FX${i},Filler Route ${i}\n`).join("");

  const tripsCsv =
    "route_id,service_id,trip_id,shape_id,direction_id\n" +
    "R_T816,WK,T816-1,SH816,0\n" +
    "R_T815,WK,T815-1,SH815,0\n" +
    "R_T786,WK,T786-1,SH786,0\n";

  const stopsCsv =
    "stop_id,stop_name,stop_lat,stop_lon\n" +
    "S1,Phileo Damansara MRT,3.1,101.6\n" +
    "S2,Mutiara Damansara,3.11,101.61\n" +
    "S3,Kota Damansara,3.12,101.62\n" +
    "S4,Subang Parade,3.05,101.58\n";

  const stopTimesCsv =
    "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
    "T816-1,S1,1,07:00:00,07:00:00\n" +
    "T816-1,S2,2,07:10:00,07:10:00\n" +
    "T815-1,S3,1,07:00:00,07:00:00\n" +
    "T786-1,S4,1,07:00:00,07:00:00\n";

  const calendarCsv =
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
    "WK,1,1,1,1,1,0,0,20260101,20261231\n";

  return zipSync({
    "routes.txt": strToU8(routesCsv),
    "trips.txt": strToU8(tripsCsv),
    "stops.txt": strToU8(stopsCsv),
    "stop_times.txt": strToU8(stopTimesCsv),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n",
    ),
    "calendar.txt": strToU8(calendarCsv),
  });
}

test("searchRoutes: exact code match ranks first", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "T816");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].code, "T816");
});

test("searchRoutes: partial code match returns multiple", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "T8");
  const codes = hits.map((h) => h.code);
  assert.ok(codes.includes("T816"));
  assert.ok(codes.includes("T815"));
});

test("searchRoutes: partial long-name match", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "Mutiara");
  assert.ok(hits.some((h) => h.code === "T816"));
});

test("searchRoutes: stop-name match attaches matchedStops", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "Phileo");
  const t816 = hits.find((h) => h.code === "T816");
  assert.ok(t816, "T816 should match via stop");
  assert.ok(t816.matchedStops && t816.matchedStops.length > 0);
  assert.ok(
    t816.matchedStops.some((s) => s.stop_name.includes("Phileo")),
  );
});

test("searchRoutes: empty query returns empty array", () => {
  const parsed = parseGtfsZip(fixture());
  assert.deepEqual(searchRoutes(parsed, ""), []);
  assert.deepEqual(searchRoutes(parsed, "   "), []);
});

test("searchRoutes: respects limit cap", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "F", 25);
  assert.ok(hits.length <= 25);
  const unbounded = searchRoutes(parsed, "F", 1000);
  assert.ok(unbounded.length > 25);
});
