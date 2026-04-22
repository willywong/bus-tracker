import assert from "node:assert/strict";
import test from "node:test";
import type { VehiclePosition } from "../../types/bus.js";
import {
  DEFAULT_DWELL_MINUTES_PER_STOP,
  computeEta,
  countIntermediateStops,
  dwellMinutes,
  evaluateApproach,
  pickApproachingVehicle,
} from "../eta.js";
import { projectOntoRoute, type LatLng } from "../route.js";

/** Square-ish loop polyline around (3.10, 101.60). Clockwise: E, then N, then W, then S, closing. */
const LOOP: LatLng[] = [
  { lat: 3.1, lng: 101.6 },
  { lat: 3.1, lng: 101.61 },
  { lat: 3.11, lng: 101.61 },
  { lat: 3.11, lng: 101.6 },
  { lat: 3.1, lng: 101.6 },
];

const STOP: LatLng = { lat: 3.11, lng: 101.61 };

function bus(
  vehicleId: string,
  lat: number,
  lng: number,
  bearing?: number,
): VehiclePosition {
  return {
    vehicleId,
    tripId: "T816-1",
    routeId: "T816",
    lat,
    lng,
    bearing,
    observedAt: 1_000,
  };
}

test("evaluateApproach: bus heading east on first segment approaches stop", () => {
  const e = evaluateApproach({
    bus: bus("A", 3.1, 101.605, 90),
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(e.verdict, "approaching");
  assert.ok(e.forwardMeters > 0);
  assert.ok(e.headingDot > 0.9, `dot=${e.headingDot}`);
});

test("evaluateApproach: bus heading west on first segment is departing (wrong direction)", () => {
  const e = evaluateApproach({
    bus: bus("A", 3.1, 101.605, 270),
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(e.verdict, "departing");
  assert.ok(e.headingDot < 0);
});

test("evaluateApproach: bus just past stop on a loop counts as departing (more than half the loop to wrap back)", () => {
  // Bus at 3.11, 101.605 on the W-bound leg (segment index 2), heading west (270°).
  const e = evaluateApproach({
    bus: bus("A", 3.11, 101.605, 270),
    stop: STOP,
    polyline: LOOP,
    loop: true,
  });
  // Heading is aligned with the westbound tangent — same loop direction — but
  // the bus has more than half the loop to travel before returning to the stop,
  // so the shorter path back is *backwards*. Treat as departing.
  assert.ok(e.headingDot > 0.9);
  assert.equal(e.verdict, "departing");
  assert.ok(e.forwardMeters > 2000);
});

test("evaluateApproach: bus just past stop on a loop with no heading data is departing", () => {
  // Same position as above but no bearing and no previousBus — falls back to
  // geometry-only, which must still classify a wrapped-around bus as departing.
  const e = evaluateApproach({
    bus: bus("A", 3.11, 101.605),
    stop: STOP,
    polyline: LOOP,
    loop: true,
  });
  assert.equal(e.headingDot, 0);
  assert.equal(e.verdict, "departing");
});

test("pickApproachingVehicle: returns null when the only bus has just passed the stop on a loop", () => {
  // Single just-passed bus — caller should fall back to scheduled arrivals,
  // not lock onto a bus that has to travel almost a full loop back.
  const justPast = bus("PAST", 3.11, 101.605, 270);
  const picked = pickApproachingVehicle({
    vehicles: [justPast],
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(picked, null);
});

test("pickApproachingVehicle: prefers a true approaching bus over a just-passed one on a loop", () => {
  const justPast = bus("PAST", 3.11, 101.605, 270);
  const approaching = bus("NEXT", 3.1, 101.608, 90);
  const picked = pickApproachingVehicle({
    vehicles: [justPast, approaching],
    stop: STOP,
    polyline: LOOP,
  });
  assert.ok(picked);
  assert.equal(picked!.vehicle.vehicleId, "NEXT");
});

test("evaluateApproach: falls back to position-only heading from previousBus", () => {
  const e = evaluateApproach({
    bus: bus("A", 3.1, 101.605),
    previousBus: { lat: 3.1, lng: 101.602 },
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(e.verdict, "approaching");
});

test("evaluateApproach: no heading, no previous — uses geometry only", () => {
  const e = evaluateApproach({
    bus: bus("A", 3.1, 101.605),
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(e.verdict, "approaching");
});

test("evaluateApproach: bus far off-route returns 'unknown'", () => {
  const e = evaluateApproach({
    bus: bus("A", 3.2, 101.5, 90),
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(e.verdict, "unknown");
});

test("pickApproachingVehicle: picks the approaching vehicle nearest the stop", () => {
  // Two east-bound buses: one near start, one closer to stop.
  const far = bus("FAR", 3.1, 101.602, 90);
  const near = bus("NEAR", 3.1, 101.608, 90);
  // And a wrong-way bus that should be filtered out.
  const wrong = bus("WRONG", 3.1, 101.608, 270);

  const picked = pickApproachingVehicle({
    vehicles: [far, near, wrong],
    stop: STOP,
    polyline: LOOP,
  });
  assert.ok(picked);
  assert.equal(picked!.vehicle.vehicleId, "NEAR");
});

test("pickApproachingVehicle: returns null when no vehicle is approaching", () => {
  const wrong = bus("WRONG", 3.1, 101.605, 270);
  const picked = pickApproachingVehicle({
    vehicles: [wrong],
    stop: STOP,
    polyline: LOOP,
  });
  assert.equal(picked, null);
});

/** Straight E-W polyline for dwell tests (no loop); 10 km span. */
const LINE: LatLng[] = [
  { lat: 3.1, lng: 101.6 },
  { lat: 3.1, lng: 101.7 },
];

test("countIntermediateStops: counts stops strictly between bus and target", () => {
  const busProj = projectOntoRoute({ lat: 3.1, lng: 101.61 }, LINE);
  const stopProj = projectOntoRoute({ lat: 3.1, lng: 101.66 }, LINE);
  const intermediates: LatLng[] = [
    { lat: 3.1, lng: 101.605 }, // behind bus
    { lat: 3.1, lng: 101.62 }, // between
    { lat: 3.1, lng: 101.63 }, // between
    { lat: 3.1, lng: 101.64 }, // between
    { lat: 3.1, lng: 101.66 }, // at target (excluded)
    { lat: 3.1, lng: 101.69 }, // after target
  ];
  const count = countIntermediateStops({
    bus: busProj,
    stop: stopProj,
    intermediateCandidates: intermediates,
    polyline: LINE,
    loop: false,
  });
  assert.equal(count, 3);
});

test("countIntermediateStops: returns 0 when target is behind bus and non-loop", () => {
  const busProj = projectOntoRoute({ lat: 3.1, lng: 101.65 }, LINE);
  const stopProj = projectOntoRoute({ lat: 3.1, lng: 101.61 }, LINE);
  const count = countIntermediateStops({
    bus: busProj,
    stop: stopProj,
    intermediateCandidates: [{ lat: 3.1, lng: 101.63 }],
    polyline: LINE,
    loop: false,
  });
  assert.equal(count, 0);
});

test("computeEta: returns traffic source with dwell when approaching vehicle and trafficMinutes given", () => {
  const vehicles = [bus("A", 3.1, 101.605, 90)];
  const intermediates: LatLng[] = [
    { lat: 3.1, lng: 101.606 },
    { lat: 3.1, lng: 101.608 },
  ];
  const result = computeEta({
    vehicles,
    stop: STOP,
    polyline: LOOP,
    intermediateCandidates: intermediates,
    trafficMinutes: 8,
  });
  assert.equal(result.source, "traffic");
  assert.equal(result.vehicleId, "A");
  assert.equal(result.minutesToStop, 8 + 2 * DEFAULT_DWELL_MINUTES_PER_STOP);
  assert.ok(result.busProjection);
  assert.ok(result.stopProjection);
  assert.ok(result.forwardMeters && result.forwardMeters > 0);
});

test("computeEta: falls back to schedule source (null minutes) when trafficMinutes is null", () => {
  const vehicles = [bus("A", 3.1, 101.605, 90)];
  const result = computeEta({
    vehicles,
    stop: STOP,
    polyline: LOOP,
    intermediateCandidates: [],
    trafficMinutes: null,
  });
  assert.equal(result.source, "schedule");
  assert.equal(result.minutesToStop, null);
  assert.equal(result.vehicleId, "A");
});

test("computeEta: returns source null when no vehicle is approaching", () => {
  const vehicles = [bus("W", 3.1, 101.605, 270)];
  const result = computeEta({
    vehicles,
    stop: STOP,
    polyline: LOOP,
    intermediateCandidates: [],
    trafficMinutes: 5,
  });
  assert.equal(result.source, null);
  assert.equal(result.vehicleId, null);
  assert.equal(result.minutesToStop, null);
});

test("dwellMinutes: multiplies count by minutesPerStop (defaults to 1.5)", () => {
  const busProj = projectOntoRoute({ lat: 3.1, lng: 101.61 }, LINE);
  const stopProj = projectOntoRoute({ lat: 3.1, lng: 101.66 }, LINE);
  const intermediates: LatLng[] = [
    { lat: 3.1, lng: 101.62 },
    { lat: 3.1, lng: 101.63 },
    { lat: 3.1, lng: 101.64 },
  ];
  const defaultMins = dwellMinutes({
    bus: busProj,
    stop: stopProj,
    intermediateCandidates: intermediates,
    polyline: LINE,
    loop: false,
  });
  assert.equal(defaultMins, 3 * DEFAULT_DWELL_MINUTES_PER_STOP);

  const custom = dwellMinutes({
    bus: busProj,
    stop: stopProj,
    intermediateCandidates: intermediates,
    polyline: LINE,
    loop: false,
    minutesPerStop: 2,
  });
  assert.equal(custom, 6);
});
