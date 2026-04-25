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

test("pins to origin stop during the trip window instead of interpolating", () => {
  // Mid-trip (nowSec = 900, between origin dep 600 and terminus 1200) — the
  // ghost must stay at the origin stop rather than drift along the polyline,
  // since no live vehicle has confirmed the trip is running.
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
  assert.deepEqual(out, STOP_A);
});

test("dwell at a mid-route stop still pins to origin", () => {
  // Even when the schedule has the bus dwelling at stop B (arr 1200, dep 1260)
  // and nowSec is inside that dwell window, the ghost stays at the origin.
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 720 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1260 },
      { stopId: "C", stopSequence: 3, arrivalSeconds: 1800, departureSeconds: 1800 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
      ["C", { lat: 3.1, lng: 101.62 }],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 1230,
  });
  assert.deepEqual(out, STOP_A);
});

test("returns null when origin stop is missing from the lookup mid-trip", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 600, departureSeconds: 600 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([["B", STOP_B]]),
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
  assert.deepEqual(out, STOP_A);
});

test("returns null when the origin's arrival and departure seconds are both null", () => {
  const out = interpolateScheduledPosition({
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: null, departureSeconds: null },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 1200, departureSeconds: 1200 },
    ],
    stopsById: stopsMap([
      ["A", STOP_A],
      ["B", STOP_B],
    ]),
    polyline: STRAIGHT_POLY,
    nowSec: 900,
  });
  assert.equal(out, null);
});

test("ignores polyline and loop args and still pins to origin on loop routes", () => {
  const LOOP: LatLng[] = [
    { lat: 3.1, lng: 101.6 },
    { lat: 3.1, lng: 101.61 },
    { lat: 3.11, lng: 101.61 },
    { lat: 3.11, lng: 101.6 },
    { lat: 3.1, lng: 101.6 },
  ];
  const stopA: LatLng = { lat: 3.105, lng: 101.6 };
  const stopB: LatLng = { lat: 3.1, lng: 101.605 };
  const baseArgs = {
    stopTimes: [
      { stopId: "A", stopSequence: 1, arrivalSeconds: 100, departureSeconds: 100 },
      { stopId: "B", stopSequence: 2, arrivalSeconds: 200, departureSeconds: 200 },
    ],
    stopsById: stopsMap([
      ["A", stopA],
      ["B", stopB],
    ]),
    nowSec: 150,
  };
  const withLoop = interpolateScheduledPosition({
    ...baseArgs,
    polyline: LOOP,
    loop: true,
  });
  const withoutAnyGeometry = interpolateScheduledPosition(baseArgs);
  assert.deepEqual(withLoop, stopA);
  // Contract check: the polyline / loop args are no-ops; supplying them or not
  // must produce identical output. Catches any future regression that quietly
  // reintroduces polyline-aware interpolation.
  assert.deepEqual(withLoop, withoutAnyGeometry);
});
