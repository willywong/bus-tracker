import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { RAIL_STATIONS } from "../../data/rail-stations.js";
import { gtfsTimeToSeconds } from "../../utils/gtfs-time.js";
import { fixShapePoint, readFeed, readFeedSteps, type NormalisedFeed } from "../feeds.js";
import { UPPERCASE_WORDS } from "../names.js";
import type { FeedId } from "../network.js";

const FIXTURES = new URL("../__fixtures__/2026-10-23/", import.meta.url);
const ZIP: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};
const fixture = (feed: FeedId) => new Uint8Array(readFileSync(new URL(ZIP[feed], FIXTURES)));

// Each fixture is read once (bus-kl and feeder take a few hundred ms).
const cache = new Map<FeedId, NormalisedFeed>();
function feedOf(feed: FeedId): NormalisedFeed {
  let f = cache.get(feed);
  if (!f) cache.set(feed, (f = readFeed(fixture(feed), feed)));
  return f;
}

// Klang Valley bbox (spec §3.1).
const inKlangValley = (lat: number, lon: number) =>
  lat >= 2.7 && lat <= 3.45 && lon >= 101.25 && lon <= 101.95;

test("rail stop_times BOM does not hide trip_id", () => {
  const { parsed } = feedOf("rail");
  assert.ok(parsed.trips.length > 0);
  const timed = new Set(parsed.stopTimes.map((st) => st.trip_id));
  for (const t of parsed.trips) assert.ok(timed.has(t.trip_id), `${t.trip_id} has stop_times`);
  assert.ok(parsed.stopTimes.every((st) => st.trip_id.startsWith("rail:") && st.trip_id.length > 5));
});

test("rail trips resolve to routes.txt despite AGL/AG in stop_times", () => {
  const { parsed, routeMeta } = feedOf("rail");
  const routeIds = new Set(parsed.routes.map((r) => String(r.route_id)));
  for (const t of parsed.trips) assert.ok(routeIds.has(t.route_id), `${t.trip_id} → ${t.route_id}`);
  assert.ok(routeIds.has("rail:AG"));
  const ag = routeMeta.get("rail:AG");
  assert.equal(ag?.label, "AG");
  assert.equal(ag?.mode, "lrt");
  assert.equal(ag?.color, "#E57200");
  assert.equal(routeMeta.get("rail:PH")?.label, "SP", "Sri Petaling's route_id is PH, its stops SP*");
  assert.equal(routeMeta.get("rail:PYL")?.textColor, "#000000", "contrast-fixed in RAIL_LINES");
  assert.equal(routeMeta.get("rail:MR")?.mode, "monorail");
  assert.equal(routeMeta.get("rail:BRT")?.mode, "brt");
  assert.equal(routeMeta.get("rail:KGL")?.mode, "mrt");
  assert.equal(routeMeta.size, parsed.routes.length);
});

test("rail times like 6:00:00 parse", () => {
  const { parsed } = feedOf("rail");
  assert.ok(parsed.stopTimes.some((st) => st.arrival_time === "6:00:00"));
  for (const st of parsed.stopTimes) {
    assert.notEqual(gtfsTimeToSeconds(st.arrival_time), null, st.arrival_time);
    assert.notEqual(gtfsTimeToSeconds(st.departure_time), null, st.departure_time);
  }
  assert.ok(parsed.frequencies.length > 0);
  for (const f of parsed.frequencies) assert.notEqual(gtfsTimeToSeconds(f.start_time), null);
});

test("rail stop names are title case without trailing spaces", () => {
  const { stopNames, parsed } = feedOf("rail");
  const station = RAIL_STATIONS.find((s) => s.stopIds.includes("KJ15"));
  assert.equal(stopNames.get("rail:KJ15"), "KL Sentral");
  assert.equal(stopNames.get("rail:KJ15"), station?.name);
  assert.equal(stopNames.size, parsed.stops.length);
  for (const name of stopNames.values()) {
    assert.equal(name, name.trim());
    const acronyms = name.split(/[ -]/).every((w) => UPPERCASE_WORDS.has(w) || /^[A-Z]*\d+$/.test(w));
    assert.ok(name !== name.toUpperCase() || acronyms, `${name} is not ALL CAPS`);
  }
});

test("rail stops ignore the geometry column", () => {
  const { parsed } = feedOf("rail");
  assert.ok(parsed.stops.length >= 180);
  for (const s of parsed.stops) {
    assert.ok(s.stop_lat >= 2.7 && s.stop_lat <= 3.45, `${s.stop_id} lat ${s.stop_lat}`);
    assert.ok(s.stop_lon > 101 && s.stop_lon < 102, `${s.stop_id} lon ${s.stop_lon}`);
  }
});

test("fixShapePoint swaps lon,lat and leaves good points alone", () => {
  const good = { shape_id: "s", shape_pt_lat: 3.15, shape_pt_lon: 101.76, shape_pt_sequence: 1 };
  assert.deepEqual(fixShapePoint(good), good);
  assert.deepEqual(
    fixShapePoint({ shape_id: "s", shape_pt_lat: 101.76, shape_pt_lon: 3.15, shape_pt_sequence: 2 }),
    { shape_id: "s", shape_pt_lat: 3.15, shape_pt_lon: 101.76, shape_pt_sequence: 2 },
  );
});

test("rail shapes land inside the Klang Valley bbox", () => {
  assert.equal(feedOf("rail").parsed.shapes.length, 0, "shapes skipped unless asked");
  const { parsed } = readFeed(fixture("rail"), "rail", { shapes: true });
  assert.ok(parsed.shapes.length > 1000);
  for (const p of parsed.shapes) {
    assert.ok(p.shape_id.startsWith("rail:"));
    assert.ok(inKlangValley(p.shape_pt_lat, p.shape_pt_lon), `${p.shape_id}#${p.shape_pt_sequence}`);
  }
});

test("ktm keeps only Seremban and Port Klang lines inside the bbox", () => {
  const { parsed, routeMeta, stopNames } = feedOf("ktm");
  assert.deepEqual(parsed.routes.map((r) => r.route_id).sort(), ["ktm:KA15_KD19", "ktm:KC05_KB18"]);
  assert.ok(!parsed.trips.some((t) => t.route_id === "ktm:ETS"));
  assert.ok(parsed.trips.every((t) => routeMeta.has(t.route_id)));
  const seremban = routeMeta.get("ktm:KC05_KB18");
  assert.deepEqual(seremban, {
    label: "KTM Seremban",
    longName: "KTM Komuter Seremban Line",
    mode: "ktm",
    color: "#3C5A9F",
    textColor: "#FFFFFF",
  });
  assert.equal(routeMeta.get("ktm:KA15_KD19")?.label, "KTM Port Klang");
  assert.equal(routeMeta.get("ktm:KA15_KD19")?.color, "#DC2420");

  assert.ok(parsed.stops.length > 30 && parsed.stops.length < 80, `${parsed.stops.length} stops`);
  for (const s of parsed.stops) assert.ok(inKlangValley(s.stop_lat, s.stop_lon), s.stop_id);
  const stopIds = new Set(parsed.stops.map((s) => s.stop_id));
  const counts = new Map<string, number>();
  for (const st of parsed.stopTimes) {
    assert.ok(stopIds.has(st.stop_id), st.stop_id);
    counts.set(st.trip_id, (counts.get(st.trip_id) ?? 0) + 1);
  }
  for (const t of parsed.trips) assert.ok((counts.get(t.trip_id) ?? 0) >= 2, t.trip_id);
  // Every kept stop is used, and the names are display case.
  assert.equal(new Set(parsed.stopTimes.map((st) => st.stop_id)).size, parsed.stops.length);
  assert.equal(stopNames.get("ktm:19100"), "KL Sentral");
});

test("ktm cut throws when a trip leaves the bbox and comes back", () => {
  const zip = zipSync({
    "routes.txt": strToU8(
      "route_id,route_type,route_short_name,route_long_name,route_color,route_text_color\n" +
        "KC05_KB18,0,Seremban Line,KTM Batu Caves - Pulau Sebang/Tampin,,\n",
    ),
    "stops.txt": strToU8(
      "stop_id,stop_name,stop_lat,stop_lon\n" +
        "A,IN ONE,3.10,101.70\nB,OUT,2.50,101.90\nC,IN TWO,3.00,101.70\n",
    ),
    "trips.txt": strToU8("route_id,service_id,trip_id,direction_id\nKC05_KB18,wk,T1,0\n"),
    "stop_times.txt": strToU8(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
        "T1,06:00:00,06:00:00,A,1\nT1,06:30:00,06:30:00,B,2\nT1,07:00:00,07:00:00,C,3\n",
    ),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
        "wk,1,1,1,1,1,0,0,20260818,20261106\n",
    ),
  });
  assert.throws(() => readFeed(zip, "ktm"), /contiguous/);
});

test("validUntil per feed", () => {
  assert.equal(feedOf("rail").validUntil, "20261231");
  assert.equal(feedOf("rail").validFrom, "20190101");
  assert.equal(feedOf("ktm").validUntil, "20261106");
  assert.equal(feedOf("bus-kl").validUntil, "20270331");
});

test("ids are namespaced per feed and feeder stays raw", () => {
  for (const [feed, prefix] of [["rail", "rail:"], ["ktm", "ktm:"], ["bus-kl", "kl:"]] as const) {
    const { parsed, routeMeta, stopNames } = feedOf(feed);
    assert.ok(parsed.stops.every((s) => s.stop_id.startsWith(prefix)), `${feed} stops`);
    assert.ok(parsed.routes.every((r) => String(r.route_id).startsWith(prefix)), `${feed} routes`);
    assert.ok(parsed.trips.every((t) => t.trip_id.startsWith(prefix) && t.service_id.startsWith(prefix)));
    assert.ok(parsed.stopTimes.every((st) => st.stop_id.startsWith(prefix)));
    assert.ok(parsed.calendar.every((c) => c.service_id.startsWith(prefix)));
    assert.ok(parsed.frequencies.every((f) => f.trip_id.startsWith(prefix)));
    assert.ok([...routeMeta.keys()].every((id) => id.startsWith(prefix)));
    assert.ok([...stopNames.keys()].every((id) => id.startsWith(prefix)));
  }
  const feeder = feedOf("feeder");
  assert.ok(feeder.parsed.stops.length > 1000);
  assert.ok(feeder.parsed.stops.every((s) => !s.stop_id.includes(":")), "feeder stop ids raw");
  assert.ok(feeder.parsed.trips.every((t) => !t.trip_id.includes(":")));
  const t816 = [...feeder.routeMeta.values()].find((m) => m.label === "T816");
  assert.deepEqual(t816 && { mode: t816.mode, color: t816.color, textColor: t816.textColor }, {
    mode: "feeder",
    color: "#000000",
    textColor: "#FFFFFF",
  });
  const kl = [...feedOf("bus-kl").routeMeta.values()][0];
  assert.equal(kl.mode, "bus");
  assert.equal(kl.color, "#000000");
});

test("trips without stop_times are dropped", () => {
  for (const feed of ["bus-kl", "feeder"] as const) {
    const { parsed } = feedOf(feed);
    const timed = new Set(parsed.stopTimes.map((st) => st.trip_id));
    assert.ok(parsed.trips.every((t) => timed.has(t.trip_id)), feed);
    const kept = new Set(parsed.trips.map((t) => t.trip_id));
    assert.ok(parsed.frequencies.every((f) => kept.has(f.trip_id)), feed);
  }
});

test("readFeedSteps yields", () => {
  const steps = readFeedSteps(fixture("bus-kl"), "bus-kl");
  let yields = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) {
      assert.equal(step.value.feed, "bus-kl");
      break;
    }
    yields++;
  }
  assert.ok(yields > 50, `${yields} yields`);
});
