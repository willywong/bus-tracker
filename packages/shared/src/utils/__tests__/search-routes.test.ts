import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { namespaceParsedGtfs } from "../categories.js";
import { parseGtfsZip } from "../gtfs-parser.js";
import {
  buildRouteSearchIndex,
  buildRouteSearchIndexFromZip,
  deserializeRouteSearchIndex,
  searchRouteIndexes,
  searchRoutes,
  serializeRouteSearchIndex,
} from "../search-routes.js";

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
    "R_T786,WK,T786-1,SH786,0\n" +
    "R_PJ01,WK,PJ01-1,SH_PJ01,0\n";

  const stopsCsv =
    "stop_id,stop_name,stop_lat,stop_lon\n" +
    "S1,Phileo Damansara MRT,3.1,101.6\n" +
    "S2,Mutiara Damansara,3.11,101.61\n" +
    "S3,Kota Damansara,3.12,101.62\n" +
    "S4,Subang Parade,3.05,101.58\n" +
    "S5,MRT Sungai Buloh,3.2,101.5\n" +
    "S6,Kepong Baru,3.21,101.51\n" +
    "S7,Bandar Sri Damansara,3.22,101.52\n";

  const stopTimesCsv =
    "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
    "T816-1,S1,1,07:00:00,07:00:00\n" +
    "T816-1,S2,2,07:10:00,07:10:00\n" +
    "T815-1,S3,1,07:00:00,07:00:00\n" +
    "T786-1,S4,1,07:00:00,07:00:00\n" +
    // PJ01: a loop that starts and ends at MRT Sungai Buloh
    "PJ01-1,S5,1,07:00:00,07:00:00\n" +
    "PJ01-1,S6,2,07:05:00,07:05:00\n" +
    "PJ01-1,S7,3,07:10:00,07:10:00\n" +
    "PJ01-1,S5,4,07:20:00,07:20:00\n";

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

test("searchRoutes: hits include origin and destination stop names", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "T816");
  const t816 = hits.find((h) => h.code === "T816");
  assert.ok(t816);
  assert.equal(t816.origin, "Phileo Damansara MRT");
  assert.equal(t816.destination, "Mutiara Damansara");
});

test("searchRoutes: circular route exposes midpoint distinct from endpoints", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "PJ01");
  const pj01 = hits.find((h) => h.code === "PJ01");
  assert.ok(pj01, "PJ01 should match by code");
  assert.equal(pj01.origin, "MRT Sungai Buloh");
  assert.equal(pj01.destination, "MRT Sungai Buloh");
  // Stops are [S5, S6, S7, S5] so floor(4/2) = index 2 → S7
  assert.equal(pj01.midpoint, "Bandar Sri Damansara");
});

test("searchRoutes: non-circular route omits midpoint when too short", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "T816");
  const t816 = hits.find((h) => h.code === "T816");
  assert.ok(t816);
  // T816 trip has only 2 stops, so midpoint is omitted (needs >= 3).
  assert.equal(t816.midpoint, undefined);
});

test("searchRoutes: respects limit cap", () => {
  const parsed = parseGtfsZip(fixture());
  const hits = searchRoutes(parsed, "F", 25);
  assert.ok(hits.length <= 25);
  const unbounded = searchRoutes(parsed, "F", 1000);
  assert.ok(unbounded.length > 25);
});

test("the index built from the zip matches the one built from a parsed feed", async () => {
  const zip = fixture();
  assert.deepEqual(await buildRouteSearchIndexFromZip(zip), buildRouteSearchIndex(parseGtfsZip(zip)));
});

test("the zip index picks the first trip in trips.txt order, wherever its stop_times are", async () => {
  // Trip A-2 comes first in trips.txt but last in stop_times, with its rows
  // split up; A-1 (seen first) must give way to it.
  const zip = zipSync({
    "routes.txt": strToU8("route_id,route_short_name\nA,A1\n"),
    "stops.txt": strToU8("stop_id,stop_name\nS1,One\nS2,Two\nS3,Three\nS4,Four\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id\nA,WK,A-2\nA,WK,A-1\n"),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence\n" +
        "A-1,S1,1\nA-1,S2,2\nA-2,S4,3\nA-1,S3,3\nA-2,S3,1\nA-2,S2,2\n",
    ),
  });
  const fromZip = await buildRouteSearchIndexFromZip(zip);
  assert.deepEqual(fromZip, buildRouteSearchIndex(parseGtfsZip(zip)));
  assert.equal(fromZip.routes[0].origin, "Three");
  assert.equal(fromZip.routes[0].destination, "Four");
});

test("building from a zip lets timers run while it works", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    await buildRouteSearchIndexFromZip(fixture(), undefined, { sliceMs: 0 });
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks > 0);
});

test("building from bytes that aren't a zip fails", async () => {
  await assert.rejects(buildRouteSearchIndexFromZip(strToU8("<html>502 Bad Gateway</html>")));
  await assert.rejects(buildRouteSearchIndexFromZip(fixture().subarray(0, 200)));
});

test("a namespaced feed's zip index carries namespaced ids", async () => {
  const zip = fixture();
  const fromZip = await buildRouteSearchIndexFromZip(zip, "rapid-bus-kl");
  const parsed = buildRouteSearchIndex(namespaceParsedGtfs(parseGtfsZip(zip), "rapid-bus-kl"), "rapid-bus-kl");
  assert.deepEqual(fromZip, parsed);
  assert.ok(fromZip.routes.every((r) => r.route_id.startsWith("kl:")));
});

test("a search index survives a JSON round trip and a version change drops it", async () => {
  const index = await buildRouteSearchIndexFromZip(fixture(), "rapid-bus-kl");
  const back = deserializeRouteSearchIndex(JSON.parse(JSON.stringify(serializeRouteSearchIndex(index))));
  assert.deepEqual(back, index);
  assert.deepEqual(searchRouteIndexes([back!], "Kepong"), searchRouteIndexes([index], "Kepong"));
  assert.equal(deserializeRouteSearchIndex({ ...serializeRouteSearchIndex(index), v: 0 }), null);
  assert.equal(deserializeRouteSearchIndex(null), null);
});
