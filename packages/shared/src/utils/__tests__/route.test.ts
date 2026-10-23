import assert from "node:assert/strict";
import test from "node:test";
import { haversineMeters } from "../outlier.js";
import {
  bearingDegrees,
  distanceAlongRoute,
  pointAlongRoute,
  polylineLength,
  projectOntoRoute,
  routeLegs,
  snapToRoute,
  type LatLng,
} from "../route.js";

/** Three-point polyline roughly tracing 3.10,101.60 → 3.10,101.61 → 3.11,101.61. */
const POLY: LatLng[] = [
  { lat: 3.1, lng: 101.6 },
  { lat: 3.1, lng: 101.61 },
  { lat: 3.11, lng: 101.61 },
];

test("projectOntoRoute: point halfway along first segment", () => {
  const proj = projectOntoRoute({ lat: 3.1, lng: 101.605 }, POLY);
  assert.equal(proj.segmentIndex, 0);
  assert.ok(Math.abs(proj.progress - 0.5) < 0.01, `progress=${proj.progress}`);
  assert.ok(proj.offRouteMeters < 1, `off=${proj.offRouteMeters}`);
});

test("projectOntoRoute: picks nearest segment, not earliest", () => {
  const proj = projectOntoRoute({ lat: 3.105, lng: 101.61 }, POLY);
  assert.equal(proj.segmentIndex, 1);
  assert.ok(Math.abs(proj.progress - 0.5) < 0.01);
  assert.ok(proj.offRouteMeters < 1);
});

test("projectOntoRoute: clamps to segment endpoints when point is beyond them", () => {
  const before = projectOntoRoute({ lat: 3.1, lng: 101.59 }, POLY);
  assert.equal(before.segmentIndex, 0);
  assert.equal(before.progress, 0);

  const after = projectOntoRoute({ lat: 3.12, lng: 101.611 }, POLY);
  assert.equal(after.segmentIndex, 1);
  assert.equal(after.progress, 1);
});

test("projectOntoRoute: remainingMeters equals full polyline length at start", () => {
  const proj = projectOntoRoute({ lat: 3.1, lng: 101.6 }, POLY);
  const total = polylineLength(POLY);
  assert.ok(Math.abs(proj.remainingMeters - total) < 1);
});

test("projectOntoRoute: remainingMeters is 0 at end", () => {
  const proj = projectOntoRoute({ lat: 3.11, lng: 101.61 }, POLY);
  assert.equal(proj.segmentIndex, 1);
  assert.equal(proj.progress, 1);
  assert.ok(proj.remainingMeters < 1);
});

test("projectOntoRoute: remainingMeters decreases as we advance along the route", () => {
  const a = projectOntoRoute({ lat: 3.1, lng: 101.602 }, POLY);
  const b = projectOntoRoute({ lat: 3.1, lng: 101.608 }, POLY);
  assert.ok(a.remainingMeters > b.remainingMeters);
});

test("projectOntoRoute: rejects polylines with < 2 points", () => {
  assert.throws(
    () => projectOntoRoute({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }]),
    /at least 2 points/,
  );
});

test("polylineLength: sums haversine segment lengths", () => {
  const m = polylineLength(POLY);
  const expected =
    haversineMeters(POLY[0], POLY[1]) + haversineMeters(POLY[1], POLY[2]);
  assert.ok(Math.abs(m - expected) < 0.01);
});

test("distanceAlongRoute: from behind bus to forward stop is positive and equal to gap", () => {
  const bus = projectOntoRoute({ lat: 3.1, lng: 101.602 }, POLY);
  const stop = projectOntoRoute({ lat: 3.1, lng: 101.608 }, POLY);
  const d = distanceAlongRoute(bus, stop, POLY);
  assert.ok(d > 0);
  assert.ok(Math.abs(d - (bus.remainingMeters - stop.remainingMeters)) < 0.01);
});

test("distanceAlongRoute: spanning multiple segments accumulates correctly", () => {
  const bus = projectOntoRoute({ lat: 3.1, lng: 101.603 }, POLY);
  const stop = projectOntoRoute({ lat: 3.108, lng: 101.61 }, POLY);
  const d = distanceAlongRoute(bus, stop, POLY);
  assert.ok(d > 0);
  assert.ok(Math.abs(d - (bus.remainingMeters - stop.remainingMeters)) < 1);
});

test("distanceAlongRoute: bus past stop returns negative on non-loop", () => {
  const bus = projectOntoRoute({ lat: 3.1, lng: 101.608 }, POLY);
  const stop = projectOntoRoute({ lat: 3.1, lng: 101.602 }, POLY);
  const d = distanceAlongRoute(bus, stop, POLY);
  assert.ok(d < 0);
});

test("distanceAlongRoute: bus past stop wraps when loop=true", () => {
  const bus = projectOntoRoute({ lat: 3.1, lng: 101.608 }, POLY);
  const stop = projectOntoRoute({ lat: 3.1, lng: 101.602 }, POLY);
  const d = distanceAlongRoute(bus, stop, POLY, { loop: true });
  const total = polylineLength(POLY);
  assert.ok(d > 0);
  assert.ok(d < total);
});

test("pointAlongRoute: 0 returns the start point", () => {
  const p = pointAlongRoute(POLY, 0);
  assert.ok(Math.abs(p.lat - POLY[0].lat) < 1e-9);
  assert.ok(Math.abs(p.lng - POLY[0].lng) < 1e-9);
});

test("pointAlongRoute: total length returns the last point", () => {
  const p = pointAlongRoute(POLY, polylineLength(POLY));
  const last = POLY[POLY.length - 1];
  assert.ok(Math.abs(p.lat - last.lat) < 1e-6);
  assert.ok(Math.abs(p.lng - last.lng) < 1e-6);
});

test("pointAlongRoute: half the total length lands on the corner of POLY", () => {
  // POLY's two segments are roughly equal length, so half-total ≈ the corner.
  const half = polylineLength(POLY) / 2;
  const p = pointAlongRoute(POLY, half);
  // Both segments are ~1.1 km; the corner sits within ~50m of the midpoint.
  assert.ok(Math.abs(p.lng - 101.61) < 0.001, `lng=${p.lng}`);
});

test("pointAlongRoute: negative without loop clamps to start", () => {
  const p = pointAlongRoute(POLY, -100);
  assert.deepEqual(p, POLY[0]);
});

test("pointAlongRoute: past total without loop clamps to end", () => {
  const p = pointAlongRoute(POLY, polylineLength(POLY) + 1000);
  assert.deepEqual(p, POLY[POLY.length - 1]);
});

test("pointAlongRoute: with loop, distance past total wraps back to start", () => {
  const total = polylineLength(POLY);
  const p = pointAlongRoute(POLY, total + 0, { loop: true });
  // total mod total = 0 → start point.
  assert.ok(Math.abs(p.lat - POLY[0].lat) < 1e-9);
  assert.ok(Math.abs(p.lng - POLY[0].lng) < 1e-9);
});

test("snapToRoute: pulls a fix beside the road onto the line", () => {
  // ~22 m south of the first segment.
  const snap = snapToRoute({ lat: 3.0998, lng: 101.605 }, POLY);
  assert.equal(snap.snapped, true);
  assert.ok(haversineMeters(snap.point, { lat: 3.1, lng: 101.605 }) < 0.5);
  assert.equal(snap.bearing, undefined);
});

test("snapToRoute: leaves a fix far off the route where it is", () => {
  const raw = { lat: 3.095, lng: 101.605 }; // ~550 m off
  const snap = snapToRoute(raw, POLY, { heading: 90 });
  assert.equal(snap.snapped, false);
  assert.deepEqual(snap.point, raw);
  assert.equal(snap.bearing, 90);
});

test("snapToRoute: arrow follows the road segment, not the GPS bearing", () => {
  // First segment runs east (90°); the GPS says 70°.
  const snap = snapToRoute({ lat: 3.1001, lng: 101.605 }, POLY, { heading: 70 });
  assert.equal(snap.snapped, true);
  assert.ok(Math.abs((snap.bearing ?? 0) - 90) < 0.5, `bearing=${snap.bearing}`);
});

test("snapToRoute: on a two-way road, picks the side running with the bus", () => {
  // Out along the road and back on a parallel line ~11 m north.
  const outAndBack: LatLng[] = [
    { lat: 3.1, lng: 101.6 },
    { lat: 3.1, lng: 101.61 },
    { lat: 3.1001, lng: 101.61 },
    { lat: 3.1001, lng: 101.6 },
  ];
  // Nearer the eastbound line, but heading west.
  const snap = snapToRoute({ lat: 3.10003, lng: 101.605 }, outAndBack, { heading: 265 });
  assert.equal(snap.snapped, true);
  assert.ok(Math.abs(snap.point.lat - 3.1001) < 1e-6, `lat=${snap.point.lat}`);
  assert.ok(Math.abs((snap.bearing ?? 0) - 270) < 0.5, `bearing=${snap.bearing}`);
});

test("snapToRoute: a degenerate polyline leaves the point alone", () => {
  const raw = { lat: 3.1, lng: 101.6 };
  assert.equal(snapToRoute(raw, [raw]).snapped, false);
});

test("snapToRoute: reports the segment it drew the bus on", () => {
  assert.equal(snapToRoute({ lat: 3.0998, lng: 101.605 }, POLY).segmentIndex, 0);
  assert.equal(snapToRoute({ lat: 3.105, lng: 101.6102 }, POLY).segmentIndex, 1);
  assert.equal(snapToRoute({ lat: 3.095, lng: 101.605 }, POLY).segmentIndex, null);
});

test("routeLegs: turns the corner instead of cutting across it", () => {
  const legs = routeLegs(
    POLY,
    { point: { lat: 3.1, lng: 101.605 }, segmentIndex: 0 },
    { point: { lat: 3.105, lng: 101.61 }, segmentIndex: 1 },
  );
  assert.ok(legs);
  assert.equal(legs.length, 2);
  assert.deepEqual(legs[0].to, POLY[1]);
  assert.ok(Math.abs(legs[0].bearing - 90) < 0.5, `east, got ${legs[0].bearing}`);
  assert.ok(Math.abs(legs[1].bearing - 0) < 0.5, `north, got ${legs[1].bearing}`);
  assert.ok(Math.abs(legs[0].meters - 555) < 10, `~555 m, got ${legs[0].meters}`);
});

test("routeLegs: a step forward on one segment is a single leg", () => {
  const legs = routeLegs(
    POLY,
    { point: { lat: 3.1, lng: 101.602 }, segmentIndex: 0 },
    { point: { lat: 3.1, lng: 101.604 }, segmentIndex: 0 },
  );
  assert.equal(legs?.length, 1);
});

test("routeLegs: null when the new fix is behind the last", () => {
  const back = { point: { lat: 3.1, lng: 101.602 }, segmentIndex: 0 };
  const ahead = { point: { lat: 3.1, lng: 101.604 }, segmentIndex: 0 };
  assert.equal(routeLegs(POLY, ahead, back), null);
  assert.equal(
    routeLegs(POLY, { point: { lat: 3.105, lng: 101.61 }, segmentIndex: 1 }, back),
    null,
  );
});

test("routeLegs: null when the way round is implausibly long", () => {
  const long: LatLng[] = [
    { lat: 3.1, lng: 101.6 },
    { lat: 3.1, lng: 101.63 },
    { lat: 3.1001, lng: 101.6 },
  ];
  assert.equal(
    routeLegs(
      long,
      { point: { lat: 3.1, lng: 101.601 }, segmentIndex: 0 },
      { point: { lat: 3.10009, lng: 101.602 }, segmentIndex: 1 },
    ),
    null,
  );
});

test("bearingDegrees: compass headings", () => {
  const o = { lat: 3.1, lng: 101.6 };
  assert.ok(Math.abs(bearingDegrees(o, { lat: 3.11, lng: 101.6 }) - 0) < 0.01);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 3.1, lng: 101.61 }) - 90) < 0.01);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 3.09, lng: 101.6 }) - 180) < 0.01);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 3.1, lng: 101.59 }) - 270) < 0.01);
});
