import assert from "node:assert/strict";
import test from "node:test";
import {
  interpolateScheduledPosition,
  type ScheduledStopTime,
} from "../scheduled-position.js";
import type { LatLng } from "../route.js";

const STRAIGHT_POLY: LatLng[] = [
  { lat: 3.1, lng: 101.6 },
  { lat: 3.1, lng: 101.61 },
  { lat: 3.1, lng: 101.62 },
];

const STOP_A: LatLng = { lat: 3.1, lng: 101.605 };
const STOP_B: LatLng = { lat: 3.1, lng: 101.615 };

function stopsMap(entries: [string, LatLng][]): ReadonlyMap<string, LatLng> {
  return new Map(entries);
}

test("returns null when fewer than 2 stop_times", () => {
  const stopTimes: ScheduledStopTime[] = [
    {
      stopId: "A",
      stopSequence: 1,
      arrivalSeconds: 600,
      departureSeconds: 600,
    },
  ];
  const out = interpolateScheduledPosition({
    stopTimes,
    stopsById: stopsMap([["A", STOP_A]]),
    polyline: STRAIGHT_POLY,
    nowSec: 700,
  });
  assert.equal(out, null);
});

test("returns null when polyline has fewer than 2 points", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: [{ lat: 3.1, lng: 101.6 }],
    nowSec: 900,
  });
  assert.equal(out, null);
});

test("pins to origin stop before the trip's first departure", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 500,
  });
  assert.deepEqual(out, STOP_A);
});

test("returns null before first departure when origin stop is missing from lookup", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([["B", STOP_B]]),
    polyline: STRAIGHT_POLY,
    nowSec: 500,
  });
  assert.equal(out, null);
});

test("returns null after the trip's last arrival", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 1300,
  });
  assert.equal(out, null);
});

test("midway between consecutive stops returns midpoint along polyline", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 900,
  });
  assert.ok(out, "expected a coordinate");
  // Midpoint of (3.1, 101.605) → (3.1, 101.615) is (3.1, 101.610).
  assert.ok(Math.abs(out.lat - 3.1) < 1e-4);
  assert.ok(Math.abs(out.lng - 101.61) < 1e-4, `lng=${out.lng}`);
});

test("dwelling at a stop snaps to that stop's coordinates", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 720 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 660,
  });
  assert.deepEqual(out, STOP_A);
});

test("returns null when a needed stop is missing from the lookup", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([["A", STOP_A]]),
    polyline: STRAIGHT_POLY,
    nowSec: 900,
  });
  assert.equal(out, null);
});

test("falls back to departureSeconds when arrivalSeconds is null", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: null, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: null, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 900,
  });
  assert.ok(out);
  assert.ok(Math.abs(out.lng - 101.61) < 1e-4);
});

test("loop wrap: consecutive stops crossing the polyline seam still produce a point", () => {
  // Box loop around the unit-ish square at ~3.10 lat / ~101.60 lng.
  const LOOP: LatLng[] = [
    { lat: 3.1, lng: 101.6 },
    { lat: 3.1, lng: 101.61 },
    { lat: 3.11, lng: 101.61 },
    { lat: 3.11, lng: 101.6 },
    { lat: 3.1, lng: 101.6 },
  ];
  // Stop A near the end of the loop (last leg, heading south); stop B at the
  // start. Without loop-wrap, posB < posA and we'd compute a backwards motion.
  const stopA: LatLng = { lat: 3.105, lng: 101.6 };
  const stopB: LatLng = { lat: 3.1, lng: 101.605 };
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 100, departureSeconds: 100 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 200, departureSeconds: 200 },
    ],
    stopsById: stopsMap([
      ["A", stopA],
      ["B", stopB],
    ]),
    polyline: LOOP,
    nowSec: 150,
    loop: true,
  });
  assert.ok(out, "expected a coordinate from loop interpolation");
  // The midpoint should be near the (3.1, 101.6) corner — the polyline seam.
  assert.ok(Math.abs(out.lat - 3.1) < 0.01, `lat=${out.lat}`);
  assert.ok(Math.abs(out.lng - 101.6) < 0.01, `lng=${out.lng}`);
});
