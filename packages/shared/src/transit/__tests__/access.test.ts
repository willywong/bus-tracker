import assert from "node:assert/strict";
import test from "node:test";

import { accessStops, egressStops, type AccessOptions } from "../access.js";
import { stationIndexById, stationMembers, stopIndexById } from "../lookup.js";
import { excludedFeeds, patternMask } from "../modes.js";
import { stopsNear } from "../compile.js";
import { MODES, type TransitNetwork } from "../network.js";
import type { Place } from "../plan.js";
import type { StopTime } from "../raptor.js";
import { rangeRaptor } from "../range.js";
import { accessWalkSeconds, DETOUR, sameSpot, walkedMeters, walkOnlyCandidate, WALK_ONLY_MAX_METERS } from "../walk.js";
import { haversineMeters } from "../../utils/outlier.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";
import { tinyNetwork } from "./helpers/tiny-network.js";

const T0 = 8 * 3600;
/** Metres per degree of latitude (haversine's 6,371 km sphere). */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

const place = (lat: number, lng: number, extra: Partial<Place> = {}): Place => ({ kind: "place", name: "p", lat, lng, ...extra });
const PASAR_SENI = place(3.142366, 101.695437);
const LISA = place(3.118231, 101.63065);
const opts = (net: TransitNetwork, o: Partial<AccessOptions> = {}): AccessOptions => ({ walkMetersPerMin: 80, allowed: patternMask(net), ...o });
const ids = (net: TransitNetwork, st: { stop: number }[]) => st.map((x) => net.stops.id[x.stop]);
const straight = (net: TransitNetwork, p: Place, stop: number) => haversineMeters(p, { lat: net.stops.lat[stop], lng: net.stops.lon[stop] });

test("walk maths: walked metres are haversine × 1.25, seconds round up at the pace", () => {
  assert.equal(accessWalkSeconds(800, 80), Math.ceil(800 / (80 / 60)));
  assert.equal(accessWalkSeconds(800, 60), 800);
  assert.equal(accessWalkSeconds(0, 80), 0);
  for (const bad of [0, -5, NaN, Infinity]) assert.equal(accessWalkSeconds(800, bad), accessWalkSeconds(800, 80), `pace ${bad}`);
  const b = place(3.120929, 101.63065);
  assert.equal(DETOUR, 1.25);
  assert.equal(walkedMeters(LISA, b), haversineMeters(LISA, b) * 1.25);
});

test("grid access returns ≤ 25 stops within 1000 m, nearest first", () => {
  const net = fixtureNetwork();
  const out = accessStops(net, PASAR_SENI, opts(net));
  assert.ok(out.length > 5 && out.length <= 25, `${out.length} stops`);
  assert.equal(new Set(out.map((x) => x.stop)).size, out.length);
  for (const [i, x] of out.entries()) {
    const d = straight(net, PASAR_SENI, x.stop);
    assert.ok(d <= 1000, `${net.stops.id[x.stop]} at ${d} m`);
    assert.equal(x.meters, Math.round(d * DETOUR));
    assert.equal(x.seconds, accessWalkSeconds(x.meters, 80));
    if (i > 0) assert.ok(x.meters >= out[i - 1].meters, "nearest first");
  }
  // Pasar Seni's own platforms are a few metres away.
  assert.ok(ids(net, out).includes("rail:KJ14"));
  assert.deepEqual(accessStops(net, PASAR_SENI, opts(net, { maxStops: 3 })).length, 3);
  for (const x of accessStops(net, PASAR_SENI, opts(net, { maxWalkMeters: 200 }))) assert.ok(straight(net, PASAR_SENI, x.stop) <= 200);
});

test("grid egress returns ≤ 25 stops within 1000 m, nearest first", () => {
  const net = fixtureNetwork();
  const out = egressStops(net, PASAR_SENI, opts(net));
  assert.ok(out.length > 5 && out.length <= 25, `${out.length} stops`);
  for (const [i, x] of out.entries()) {
    assert.ok(straight(net, PASAR_SENI, x.stop) <= 1000);
    if (i > 0) assert.ok(x.meters >= out[i - 1].meters, "nearest first");
  }
});

/** Every stop within 1,000 m, unpruned and uncapped. */
function allWithin(net: TransitNetwork, p: Place): StopTime[] {
  return stopsNear(net, p.lat, p.lng, 1000).map((stop) => {
    const meters = Math.round(straight(net, p, stop) * DETOUR);
    return { stop, meters, seconds: accessWalkSeconds(meters, 80) };
  });
}

function bestArrival(net: TransitNetwork, access: StopTime[], egress: StopTime[]): number {
  const g = rangeRaptor(net, { access, egress, t0: T0, allowed: patternMask(net), walkMetersPerMin: 80 });
  for (;;) {
    const step = g.next();
    if (step.done) return Math.min(...step.value.map((j) => j.arrive));
  }
}

test("pruned access and egress lose nothing on the rail-expired golden (Lisa → KLCC, 09:05)", () => {
  const net = fixtureNetwork({ exclude: ["rail"] });
  const klcc = place(3.158935, 101.713287);
  const access = accessStops(net, LISA, opts(net));
  const egress = egressStops(net, klcc, opts(net));
  assert.ok(access.length <= 25 && egress.length <= 25);
  const best = bestArrival(net, access, egress);
  assert.equal(Math.floor(best / 60), 9 * 60 + 5, `${best}`);
  assert.equal(best, bestArrival(net, allWithin(net, LISA), allWithin(net, klcc)));
});

/**
 * 30 bus stops 22–660 m east of the origin on one pattern (outward, or
 * `inward` toward the origin), the bus 10 s per stop (faster than the ~21 s
 * walk between them); a rail stop 900 m north.
 */
function corridor(inward = false): { net: TransitNetwork; origin: Place } {
  const stops = Array.from({ length: 30 }, (_, i) => ({ id: `B${i}`, lat: 3.1, lon: 101.6 + (i + 1) * 0.0002 }));
  stops.push({ id: "R0", lat: 3.1 + 900 / M_PER_DEG, lon: 101.6 }, { id: "R1", lat: 3.2, lon: 101.6 });
  const bus = stops.slice(0, 30).map((s) => s.id);
  if (inward) bus.reverse();
  const net = tinyNetwork({
    stops,
    patterns: [
      { route: "T1", stops: bus, trips: [bus.map((_, i) => T0 + i * 10)] },
      { route: "KJ", mode: "lrt", stops: ["R0", "R1"], trips: [[T0, T0 + 600]] },
    ],
  });
  return { net, origin: place(3.1, 101.6) };
}

test("coverage pruning keeps a rail station that 25 bus stops would crowd out", () => {
  const { net, origin } = corridor();
  const out = accessStops(net, origin, opts(net));
  assert.deepEqual(ids(net, out), ["B0", "R0"]);
  assert.ok(Math.abs(out[1].meters - Math.round(900 * DETOUR)) <= 1);
  // Egress mirrors it on the bus toward the destination.
  const inward = corridor(true);
  assert.deepEqual(ids(inward.net, egressStops(inward.net, inward.origin, opts(inward.net))), ["B0", "R0"]);
  // Only bus allowed: the rail stop serves nothing allowed.
  assert.deepEqual(ids(net, accessStops(net, origin, opts(net, { allowed: patternMask(net, ["bus"]) }))), ["B0"]);
  // Nothing allowed: nothing to walk to.
  assert.deepEqual(accessStops(net, origin, opts(net, { allowed: patternMask(net, []) })), []);
});

/**
 * Stops S0, S1, S2 about 100 m apart (≈ 94 s walk each), heading away from
 * the place (`order` reversed: toward it), the bus taking `lag` seconds per
 * stop on every trip given (`lags`: one row per trip), or as a window.
 */
function line(o: { toward?: boolean; lags?: number[]; window?: boolean }): { net: TransitNetwork; at: Place } {
  const stops = ["S0", "S1", "S2"].map((id, i) => ({ id, lat: 3.1, lon: 101.6 + (i + 1) * 0.0009 }));
  const order = o.toward ? ["S2", "S1", "S0"] : ["S0", "S1", "S2"];
  const lags = o.lags ?? [30];
  const net = tinyNetwork({
    stops,
    patterns: [
      o.window
        ? { route: "L", stops: order, freq: [{ start: T0, end: T0 + 3600, headway: 600, offsets: [0, lags[0], 2 * lags[0]] }] }
        : { route: "L", stops: order, trips: lags.map((lag, t) => order.map((_, i) => T0 + t * 600 + i * lag)) },
    ],
  });
  return { net, at: place(3.1, 101.6) };
}

test("access prunes a stop downstream of a closer one only when the bus beats the extra walk", () => {
  const acc = (o: Parameters<typeof line>[0]) => {
    const { net, at } = line(o);
    return ids(net, accessStops(net, at, opts(net)));
  };
  // Boarding upstream catches every vehicle the farther stop would, leaving no earlier.
  assert.deepEqual(acc({ lags: [30] }), ["S0"]);
  assert.deepEqual(acc({ lags: [30], window: true }), ["S0"]);
  // A bus slower than the walk: walking on to S1 catches a bus missed at S0.
  assert.deepEqual(acc({ lags: [200] }), ["S0", "S1", "S2"]);
  assert.deepEqual(acc({ lags: [200], window: true }), ["S0", "S1", "S2"]);
  // Every trip must be fast enough.
  assert.deepEqual(acc({ lags: [30, 200] }), ["S0", "S1", "S2"]);
  // The bus runs toward the place: boarding upstream (farther) reaches stops S0 never does.
  assert.deepEqual(acc({ toward: true, lags: [30] }), ["S0", "S1", "S2"]);
});

test("egress prunes a stop upstream of a closer one only when the bus beats the extra walk", () => {
  const egr = (o: Parameters<typeof line>[0]) => {
    const { net, at } = line(o);
    return ids(net, egressStops(net, at, opts(net)));
  };
  // Riding on to the closer stop arrives no later.
  assert.deepEqual(egr({ toward: true, lags: [30] }), ["S0"]);
  assert.deepEqual(egr({ toward: true, lags: [30], window: true }), ["S0"]);
  // A bus slower than the walk: get off early and walk.
  assert.deepEqual(egr({ toward: true, lags: [200] }), ["S0", "S1", "S2"]);
  assert.deepEqual(egr({ toward: true, lags: [30, 200] }), ["S0", "S1", "S2"]);
  // The bus runs away from the place: a rider boarding past S0 never passes it.
  assert.deepEqual(egr({ lags: [30] }), ["S0", "S1", "S2"]);
});

test("coverage pruning keeps a farther stop that adds a pattern", () => {
  const stops = ["A", "B", "C", "D"].map((id, i) => ({ id, lat: 3.1, lon: 101.6 + (i + 1) * 0.001 }));
  const net = tinyNetwork({
    stops,
    patterns: [
      { route: "X", stops: ["A", "B"], trips: [[T0, T0 + 30]] },
      { route: "Y", stops: ["B", "C"], trips: [[T0, T0 + 30]] },
      { route: "Z", stops: ["C", "D"], trips: [[T0, T0 + 30]] },
    ],
  });
  // A: X. B: X (after A), adds Y. C: Y (after B), adds Z. D: Z (after C).
  assert.deepEqual(ids(net, accessStops(net, place(3.1, 101.6), opts(net))), ["A", "B", "C"]);
});

test("a snapped stop prunes like any chosen stop, at 0 s", () => {
  // P runs A → B. The place is a stale A: 500 m away, but snapped at 0 s.
  const net = tinyNetwork({
    stops: [
      { id: "A", lat: 3.1 + 500 / M_PER_DEG, lon: 101.6 },
      { id: "B", lat: 3.1 + 100 / M_PER_DEG, lon: 101.6 },
    ],
    patterns: [{ route: "P", stops: ["A", "B"], trips: [[T0, T0 + 10]] }],
  });
  assert.deepEqual(ids(net, accessStops(net, place(3.1, 101.6, { kind: "stop", ref: "A" }), opts(net))), ["A"]);
  assert.deepEqual(ids(net, accessStops(net, place(3.1, 101.6), opts(net))), ["B", "A"]);
});

test("stop place snaps to its ref with 0 s and still adds nearby stops", () => {
  const net = fixtureNetwork();
  const lisa = stopIndexById(net, "12000759");
  assert.ok(lisa >= 0);
  // Coordinates 60 m off the stop (a stale saved place): the ref still wins.
  const p = place(3.118231 + 60 / M_PER_DEG, 101.63065, { kind: "stop", ref: "12000759" });
  const out = accessStops(net, p, opts(net));
  assert.deepEqual(out[0], { stop: lisa, seconds: 0, meters: 0 });
  assert.equal(out.filter((x) => x.stop === lisa).length, 1);
  assert.ok(out.length > 1 && out.length <= 25);
  for (const x of out.slice(1)) assert.ok(x.meters > 0);
});

test("station place snaps to all member stops", () => {
  const net = fixtureNetwork();
  const st = stationIndexById(net, "kl-sentral");
  assert.ok(st >= 0);
  assert.deepEqual(stationMembers(net, st).map((s) => net.stops.id[s]).sort(), ["rail:KJ15", "rail:MR1"]);
  const p = place(3.133636, 101.687034, { kind: "station", ref: "kl-sentral" });
  const out = accessStops(net, p, opts(net));
  assert.deepEqual(ids(net, out.slice(0, 2)).sort(), ["rail:KJ15", "rail:MR1"]);
  assert.deepEqual(out.slice(0, 2).map((x) => [x.seconds, x.meters]), [[0, 0], [0, 0]]);
  assert.ok(out.length > 2 && out.length <= 25);
});

test("lookups: unknown ids are -1 / empty, and repeated calls agree", () => {
  const net = fixtureNetwork();
  assert.equal(stopIndexById(net, "nope"), -1);
  assert.equal(stationIndexById(net, "nope"), -1);
  assert.deepEqual(stationMembers(net, -1), []);
  assert.deepEqual(stationMembers(net, net.stations.length), []);
  assert.equal(net.stops.id[stopIndexById(net, "rail:KJ15")], "rail:KJ15");
  assert.equal(net.stations[stationIndexById(net, "klcc")].id, "klcc");
});

test("unknown ref falls back to coordinates", () => {
  const net = fixtureNetwork();
  const coords = accessStops(net, LISA, opts(net));
  assert.deepEqual(accessStops(net, { ...LISA, kind: "stop", ref: "gone" }, opts(net)), coords);
  assert.deepEqual(accessStops(net, { ...LISA, kind: "station", ref: "gone" }, opts(net)), coords);
  assert.ok(coords.length > 0);
});

test("modes filter masks patterns", () => {
  const net = fixtureNetwork();
  const mask = patternMask(net, ["bus", "feeder"]);
  let rail = 0;
  for (let p = 0; p < net.patterns.count; p++) {
    const mode = MODES[net.routes.mode[net.patterns.route[p]]];
    const isRail = mode !== "bus" && mode !== "feeder";
    if (isRail) rail++;
    assert.equal(mask[p], isRail ? 0 : 1, `pattern ${p} (${mode})`);
  }
  assert.ok(rail > 0);
  const all = patternMask(net);
  assert.ok(all.every((x) => x === 1));
  assert.equal(patternMask(net), all, "all-modes mask is cached");
  const out = accessStops(net, place(3.133636, 101.687034), opts(net, { allowed: mask }));
  assert.ok(out.length > 0);
  assert.ok(ids(net, out).every((id) => !id.startsWith("rail:") && !id.startsWith("ktm:")), ids(net, out).join(" "));
});

test("rail excluded → excludedFeeds returns ['rail'] and no rail: stops are reachable", () => {
  const net = fixtureNetwork({ exclude: ["rail"] });
  assert.deepEqual(excludedFeeds(net), ["rail"]);
  assert.ok(!net.stops.id.some((id) => id.startsWith("rail:")));
  const out = accessStops(net, { ...place(3.133636, 101.687034), kind: "station", ref: "kl-sentral" }, opts(net));
  assert.ok(out.length > 0);
  assert.ok(ids(net, out).every((id) => !id.startsWith("rail:")));
  assert.deepEqual(excludedFeeds(fixtureNetwork()), []);
  assert.deepEqual(excludedFeeds(fixtureNetwork({ exclude: ["ktm", "rail"] })), ["rail", "ktm"]);
});

test("walk-only offered at 300 m, not at 2.1 km", () => {
  const near = place(3.118231 + 300 / M_PER_DEG, 101.63065);
  const c = walkOnlyCandidate(LISA, near, T0, 80);
  assert.ok(c);
  const meters = Math.round(300 * DETOUR);
  assert.ok(Math.abs(c.walkMeters - meters) <= 1, `${c.walkMeters}`);
  assert.deepEqual(c, {
    raw: null,
    leave: T0,
    arrive: T0 + accessWalkSeconds(c.walkMeters, 80),
    rides: 0,
    walkSec: accessWalkSeconds(c.walkMeters, 80),
    walkMeters: c.walkMeters,
    firstWaitSec: 0,
    signature: "walk",
  });
  assert.equal(walkOnlyCandidate(LISA, place(3.118231 + 2100 / M_PER_DEG, 101.63065), T0, 80), null);
  // Measured walked: 1,700 m straight is 2,125 m on foot.
  assert.equal(walkOnlyCandidate(LISA, place(3.118231 + 1700 / M_PER_DEG, 101.63065), T0, 80), null);
  assert.ok(walkOnlyCandidate(LISA, place(3.118231 + 1500 / M_PER_DEG, 101.63065), T0, 80));
  assert.equal(WALK_ONLY_MAX_METERS, 2000);
});

test("walk speed scales access seconds", () => {
  const net = fixtureNetwork();
  const at80 = accessStops(net, LISA, opts(net, { walkMetersPerMin: 80 }));
  const at60 = accessStops(net, LISA, opts(net, { walkMetersPerMin: 60 }));
  assert.deepEqual(at60.map((x) => [x.stop, x.meters]), at80.map((x) => [x.stop, x.meters]));
  for (const [i, x] of at60.entries()) {
    assert.equal(x.seconds, x.meters);
    assert.equal(at80[i].seconds, Math.ceil(x.meters / (80 / 60)));
  }
  const near = place(3.118231 + 300 / M_PER_DEG, 101.63065);
  assert.ok(walkOnlyCandidate(LISA, near, T0, 60)!.arrive > walkOnlyCandidate(LISA, near, T0, 80)!.arrive);
});

test("same spot: overlapping snapped stops or under 50 m apart", () => {
  const net = fixtureNetwork();
  const o = opts(net);
  const ends = (from: Place, to: Place) => sameSpot(accessStops(net, from, o), egressStops(net, to, o), { from, to });
  const station = place(3.133636, 101.687034, { kind: "station", ref: "kl-sentral" });
  // The station and one of its platforms, ~100 m from the station's point.
  const kj15 = stopIndexById(net, "rail:KJ15");
  const platform = place(net.stops.lat[kj15] + 100 / M_PER_DEG, net.stops.lon[kj15], { kind: "stop", ref: "rail:KJ15" });
  assert.equal(ends(station, platform), true);
  assert.equal(ends(LISA, place(3.118231 + 40 / M_PER_DEG, 101.63065)), true);
  assert.equal(ends(LISA, place(3.118231 + 300 / M_PER_DEG, 101.63065)), false);
  assert.equal(ends(LISA, PASAR_SENI), false);
});
