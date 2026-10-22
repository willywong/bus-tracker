import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  forEachCsvRow,
  parseGtfsZip,
  parseGtfsZipSteps,
  scanCsvColumns,
  scanCsvColumnsSteps,
} from "../gtfs-parser.js";

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

test("forEachCsvRow streams rows across BOM, CRLF, blank lines and quotes", () => {
  const rows: string[][] = [];
  let seen: readonly string[] = [];
  forEachCsvRow('﻿a, b\r\n1,2\r\n\r\n"x, y",3\n4,5', (r, headers) => {
    rows.push(r);
    seen = headers;
  });
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(rows, [["1", "2"], ["x, y", "3"], ["4", "5"]]);
});

test("scanCsvColumnsSteps matches scanCsvColumns however the bytes are split", () => {
  const text = '\uFEFFstop_id, stop_name\r\nS1,Caf\u00e9 \u0645\r\n\r\n"S2","x, y"\nS3,\u{1F68C} last';
  const bytes = strToU8(text);
  const expected: string[][] = [];
  scanCsvColumns(text, ["stop_name", "stop_id"], (r, [name, id]) => expected.push([r[name], r[id]]));
  assert.deepEqual(expected, [["Caf\u00e9 \u0645", "S1"], ["x, y", "S2"], ["\u{1F68C} last", "S3"]]);
  for (let cut = 0; cut <= bytes.length; cut++) {
    const rows: string[][] = [];
    const steps = scanCsvColumnsSteps(
      [bytes.subarray(0, cut), bytes.subarray(cut)],
      ["stop_name", "stop_id"],
      (r, [name, id]) => rows.push([r[name], r[id]]),
    );
    for (const _ of steps);
    assert.deepEqual(rows, expected, `split at byte ${cut}`);
  }
});

test("parseGtfsZip with keepRoute keeps only that route's trips, stop_times and shapes", () => {
  const zip = zipSync({
    "routes.txt": strToU8("route_id,route_short_name\nA,A1\nB,B1\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nS1,One,3,101\nS2,Two,3,101\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id,shape_id\nA,WK,A-1,SHA\nB,WK,B-1,SHB\n"),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
        "A-1,S1,1,07:00:00,07:00:00\nB-1,S2,1,08:00:00,08:00:00\n",
    ),
    "shapes.txt": strToU8(
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSHA,3,101,1\nSHB,3,101,1\n",
    ),
    "frequencies.txt": strToU8(
      "trip_id,start_time,end_time,headway_secs\nA-1,07:00:00,09:00:00,900\nB-1,07:00:00,09:00:00,900\n",
    ),
  });
  const p = parseGtfsZip(zip, { keepRoute: (r) => r.route_short_name === "A1" });
  assert.deepEqual(p.routes.map((r) => r.route_id), ["A"]);
  assert.deepEqual(p.trips.map((t) => t.trip_id), ["A-1"]);
  assert.deepEqual(p.stopTimes.map((st) => st.trip_id), ["A-1"]);
  assert.deepEqual(p.shapes.map((s) => s.shape_id), ["SHA"]);
  assert.deepEqual(p.frequencies.map((f) => f.trip_id), ["A-1"]);
  // Stops stay whole; the bundle cut picks the ones it needs.
  assert.equal(p.stops.length, 2);
});

test("parseGtfsZip reads route_type and colours when present", () => {
  const zip = zipSync({
    "routes.txt": strToU8(
      "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n" +
        "KJ,KJL,Kelana Jaya Line,1,D50032,FFFFFF\n" +
        "BRT,BRT,Sunway Line,0,,\n",
    ),
  });
  const p = parseGtfsZip(zip);
  assert.equal(p.routes[0].route_type, 1);
  assert.equal(p.routes[0].route_color, "D50032");
  assert.equal(p.routes[0].route_text_color, "FFFFFF");
  assert.equal(p.routes[1].route_type, 0, "0 is a real route_type (tram/light rail)");
  assert.equal(p.routes[1].route_color, undefined);
  assert.equal(p.routes[1].route_text_color, undefined);
});

test("parseGtfsZip leaves optional route/stop fields undefined when absent", () => {
  const p = parseGtfsZip(makeFixture());
  for (const r of p.routes) {
    assert.equal(r.route_type, undefined);
    assert.equal(r.route_color, undefined);
    assert.equal(r.route_text_color, undefined);
  }
  for (const s of p.stops) {
    assert.equal(s.location_type, undefined);
    assert.equal(s.parent_station, undefined);
  }
});

test("parseGtfsZip reads location_type and parent_station", () => {
  const zip = zipSync({
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n" +
        "PS,Pasar Seni,3.14,101.69,1,\n" +
        "KJ14,Pasar Seni,3.14,101.69,0,PS\n" +
        "X1,Blank,3.14,101.69,,\n",
    ),
  });
  const p = parseGtfsZip(zip);
  assert.equal(p.stops[0].location_type, 1);
  assert.equal(p.stops[0].parent_station, undefined);
  assert.equal(p.stops[1].location_type, 0);
  assert.equal(p.stops[1].parent_station, "PS");
  assert.equal(p.stops[2].location_type, undefined);
  assert.equal(p.stops[2].parent_station, undefined);
});

test("parseGtfsZipSteps yields as it goes and ends with parseGtfsZip's result", () => {
  // Enough stop_times to span several 16 KB zip steps and 64 KB scan steps.
  let stopTimes = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n";
  for (let i = 0; i < 20_000; i++) stopTimes += `T816-1,08:${String(i % 60).padStart(2, "0")}:00,08:00:00,${1000000 + i},${i + 1}\n`;
  const zip = zipSync({
    "routes.txt": strToU8("route_id,route_short_name\nT816,T816\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\n1000328,Hotel,3.1,101.6\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id\nT816,WK,T816-1\n"),
    "stop_times.txt": strToU8(stopTimes),
  });
  const steps = parseGtfsZipSteps(zip);
  let yields = 0;
  let step = steps.next();
  while (!step.done) {
    yields++;
    step = steps.next();
  }
  assert.ok(yields > 5, `${yields} yields`);
  assert.deepEqual(step.value, parseGtfsZip(zip));
  assert.equal(step.value.stopTimes.length, 20_000);
});
