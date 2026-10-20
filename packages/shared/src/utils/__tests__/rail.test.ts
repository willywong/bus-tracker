import assert from "node:assert/strict";
import test from "node:test";
import { RAIL_LINES, RAIL_STATIONS } from "../../data/rail-stations.js";
import {
  formatWalkingDistance,
  nearbyRailStations,
  walkingMinutes,
  type RailLine,
  type RailStation,
} from "../rail.js";

const LINE: RailLine = {
  code: "MRT KG",
  mode: "MRT",
  name: "MRT Kajang Line",
  color: "#047940",
  textColor: "#FFFFFF",
};
const ORIGIN = { lat: 3.1, lng: 101.6 };
// ~111.2 m per 0.001° of latitude.
const fixture = (id: string, dLat: number): RailStation => ({
  id,
  name: id,
  lat: ORIGIN.lat + dLat,
  lng: ORIGIN.lng,
  stopIds: [id],
  lines: [LINE],
});
const STATIONS = [
  fixture("far", 0.005), // ~556 m
  fixture("near", 0.001), // ~111 m
  fixture("mid", -0.002), // ~222 m
  fixture("edge", 0.0035), // ~389 m
];

const byName = (name: string) => RAIL_STATIONS.filter((s) => s.name === name);

test("nearbyRailStations: sorted nearest first with distances", () => {
  const hits = nearbyRailStations(ORIGIN, { stations: STATIONS, limit: 10 });
  assert.deepEqual(
    hits.map((h) => h.station.id),
    ["near", "mid", "edge"],
  );
  assert.ok(Math.abs(hits[0].distanceMeters - 111.2) < 1);
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].distanceMeters <= hits[i].distanceMeters);
  }
});

test("nearbyRailStations: radius cutoff (default 400 m, custom)", () => {
  const def = nearbyRailStations(ORIGIN, { stations: STATIONS, limit: 10 });
  assert.ok(!def.some((h) => h.station.id === "far"));
  assert.ok(def.some((h) => h.station.id === "edge"));

  const tight = nearbyRailStations(ORIGIN, {
    stations: STATIONS,
    radiusMeters: 200,
    limit: 10,
  });
  assert.deepEqual(tight.map((h) => h.station.id), ["near"]);

  const wide = nearbyRailStations(ORIGIN, {
    stations: STATIONS,
    radiusMeters: 1000,
    limit: 10,
  });
  assert.equal(wide.length, 4);
});

test("nearbyRailStations: limit (default 3, custom, zero)", () => {
  const wide = { stations: STATIONS, radiusMeters: 1000 };
  assert.equal(nearbyRailStations(ORIGIN, wide).length, 3);
  assert.deepEqual(
    nearbyRailStations(ORIGIN, { ...wide, limit: 1 }).map((h) => h.station.id),
    ["near"],
  );
  assert.deepEqual(nearbyRailStations(ORIGIN, { ...wide, limit: 0 }), []);
});

test("nearbyRailStations: nothing nearby and bad input return []", () => {
  assert.deepEqual(nearbyRailStations({ lat: 0, lng: 0 }), []);
  assert.deepEqual(nearbyRailStations({ lat: NaN, lng: 101.6 }), []);
});

test("RAIL_STATIONS: interchanges are merged into one station with every line", () => {
  const codes = (name: string) => {
    const matches = byName(name);
    assert.equal(matches.length, 1, `${name} should be a single station`);
    return matches[0].lines.map((l) => l.code).sort();
  };
  assert.deepEqual(codes("Masjid Jamek"), ["LRT AG", "LRT KJ", "LRT SP"]);
  assert.deepEqual(codes("Titiwangsa"), [
    "LRT AG",
    "LRT SP",
    "MRT PY",
    "Monorail MR",
  ]);
  assert.deepEqual(codes("Pasar Seni"), ["LRT KJ", "MRT KG"]);
  assert.deepEqual(codes("Ampang Park"), ["LRT KJ", "MRT PY"]);
  // Sponsor suffix ("KL SENTRAL - REDONE") stripped before matching.
  assert.deepEqual(codes("KL Sentral"), ["LRT KJ", "Monorail MR"]);
  // "USJ 7" (LRT) and "USJ7" (BRT) are the same station.
  assert.deepEqual(codes("USJ 7"), ["BRT", "LRT KJ"]);
  // Different names stay separate even when close.
  assert.equal(byName("Glenmarie").length, 1);
  assert.equal(byName("Glenmarie 2").length, 1);
});

test("RAIL_STATIONS: ids and names unique, lines well-formed", () => {
  assert.equal(new Set(RAIL_STATIONS.map((s) => s.id)).size, RAIL_STATIONS.length);
  assert.equal(
    new Set(RAIL_STATIONS.map((s) => s.name)).size,
    RAIL_STATIONS.length,
  );
  assert.equal(RAIL_LINES.length, 8);
  for (const s of RAIL_STATIONS) {
    assert.ok(s.lines.length > 0, s.name);
    assert.ok(s.lat > 2.5 && s.lat < 3.6 && s.lng > 101.2 && s.lng < 102, s.name);
  }
  for (const l of RAIL_LINES) {
    assert.match(l.color, /^#[0-9A-F]{6}$/);
    assert.match(l.textColor, /^#[0-9A-F]{6}$/);
  }
});

test("feeder stop 'MRT PHILEO DAMANSARA PINTU A' finds Phileo Damansara MRT", () => {
  // rapid-bus-mrtfeeder stop_id 12000750 / stop_code PJ823.
  const hits = nearbyRailStations({ lat: 3.128419, lng: 101.642747 });
  assert.ok(hits.length >= 1);
  const [first] = hits;
  assert.equal(first.station.name, "Phileo Damansara");
  assert.deepEqual(first.station.lines.map((l) => l.code), ["MRT KG"]);
  assert.equal(first.station.lines[0].name, "MRT Kajang Line");
  assert.ok(first.distanceMeters > 100 && first.distanceMeters < 250);
  assert.equal(formatWalkingDistance(first.distanceMeters), "160 m");
});

test("formatWalkingDistance", () => {
  assert.equal(formatWalkingDistance(0), "0 m");
  assert.equal(formatWalkingDistance(123), "120 m");
  assert.equal(formatWalkingDistance(996), "1.0 km");
  assert.equal(formatWalkingDistance(1234), "1.2 km");
  assert.equal(formatWalkingDistance(12_345), "12 km");
  assert.equal(formatWalkingDistance(-5), "0 m");
  assert.equal(formatWalkingDistance(NaN), "0 m");
});

test("walkingMinutes: ~80 m/min, rounded up", () => {
  assert.equal(walkingMinutes(0), 0);
  assert.equal(walkingMinutes(1), 1);
  assert.equal(walkingMinutes(80), 1);
  assert.equal(walkingMinutes(81), 2);
  assert.equal(walkingMinutes(400), 5);
  assert.equal(walkingMinutes(NaN), 0);
});
