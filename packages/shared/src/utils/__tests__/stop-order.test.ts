import assert from "node:assert/strict";
import test from "node:test";
import type {
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
  T816Bundle,
} from "../../types/gtfs.js";
import {
  orderStopsByTrip,
  pickRepresentativeTrip,
} from "../stop-order.js";

function trip(
  tripId: string,
  shapeId: string | null,
  directionId?: 0 | 1,
): GtfsTrip {
  return {
    route_id: "R",
    service_id: "S",
    trip_id: tripId,
    shape_id: shapeId ?? undefined,
    direction_id: directionId,
  };
}

function stop(id: string, name = id): GtfsStop {
  return { stop_id: id, stop_name: name, stop_lat: 0, stop_lon: 0 };
}

function stopTime(
  tripId: string,
  stopId: string,
  seq: number,
): GtfsStopTime {
  return {
    trip_id: tripId,
    stop_id: stopId,
    stop_sequence: seq,
    arrival_time: "00:00:00",
    departure_time: "00:00:00",
  };
}

test("pickRepresentativeTrip returns null when bundle has no trips", () => {
  assert.equal(pickRepresentativeTrip({ trips: [] }), null);
});

test("pickRepresentativeTrip picks the most-common shape_id", () => {
  const trips: GtfsTrip[] = [
    trip("a1", "A"),
    trip("a2", "A"),
    trip("a3", "A"),
    trip("b1", "B"),
    trip("b2", "B"),
  ];
  const rep = pickRepresentativeTrip({ trips });
  assert.ok(rep);
  assert.equal(rep!.shapeId, "A");
});

test("pickRepresentativeTrip breaks ties by preferring direction_id=0", () => {
  const trips: GtfsTrip[] = [
    trip("a1", "A", 1),
    trip("a2", "A", 1),
    trip("b1", "B", 0),
    trip("b2", "B", 0),
  ];
  const rep = pickRepresentativeTrip({ trips });
  assert.ok(rep);
  assert.equal(rep!.shapeId, "B");
  assert.equal(rep!.directionId, 0);
});

test("pickRepresentativeTrip prefers dir-0 trip within the winning shape", () => {
  const trips: GtfsTrip[] = [
    trip("a1", "A", 1),
    trip("a2", "A", 0),
    trip("a3", "A", 1),
    trip("b1", "B", 1),
  ];
  const rep = pickRepresentativeTrip({ trips });
  assert.ok(rep);
  assert.equal(rep!.tripId, "a2");
});

test("pickRepresentativeTrip falls back to first trip when no trip has a shape_id", () => {
  const trips: GtfsTrip[] = [trip("a1", null), trip("a2", null)];
  const rep = pickRepresentativeTrip({ trips });
  assert.ok(rep);
  assert.equal(rep!.tripId, "a1");
});

test("orderStopsByTrip sorts stops ascending by stop_sequence on the trip", () => {
  const stops = [stop("S3", "Cantor"), stop("S1", "Avery"), stop("S2", "Babel")];
  const stopTimes: GtfsStopTime[] = [
    stopTime("T", "S1", 1),
    stopTime("T", "S2", 2),
    stopTime("T", "S3", 3),
  ];
  const out = orderStopsByTrip({ stops, stopTimes }, "T");
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["S1", "S2", "S3"],
  );
});

test("orderStopsByTrip dedupes loop revisits by first visit (lowest sequence)", () => {
  const stops = [stop("S1"), stop("S2"), stop("S3")];
  const stopTimes: GtfsStopTime[] = [
    stopTime("T", "S1", 1),
    stopTime("T", "S2", 2),
    stopTime("T", "S3", 3),
    stopTime("T", "S1", 4), // loop back to S1
  ];
  const out = orderStopsByTrip({ stops, stopTimes }, "T");
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["S1", "S2", "S3"],
  );
});

test("orderStopsByTrip appends stops missing from the trip alphabetically", () => {
  const stops = [stop("S1", "Alpha"), stop("SX", "Zulu"), stop("SY", "Mike")];
  const stopTimes: GtfsStopTime[] = [stopTime("T", "S1", 1)];
  const out = orderStopsByTrip({ stops, stopTimes }, "T");
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["S1", "SY", "SX"], // S1 (in trip), then Mike/Zulu alphabetical
  );
});

test("orderStopsByTrip falls back to pure alphabetical when tripId is null", () => {
  const stops = [stop("S1", "Beta"), stop("S2", "Alpha"), stop("S3", "Gamma")];
  const out = orderStopsByTrip({ stops, stopTimes: [] }, null);
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["S2", "S1", "S3"],
  );
});

test("orderStopsByTrip ignores stop_times from other trips", () => {
  const stops = [stop("S1"), stop("S2")];
  const stopTimes: GtfsStopTime[] = [
    stopTime("OTHER", "S2", 1),
    stopTime("T", "S1", 1),
    stopTime("T", "S2", 2),
  ];
  const out = orderStopsByTrip({ stops, stopTimes }, "T");
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["S1", "S2"],
  );
});

test("orderStopsByTrip works end-to-end with pickRepresentativeTrip on a loop bundle", () => {
  const trips: GtfsTrip[] = [
    trip("T1", "S", 0),
    trip("T2", "S", 0),
    trip("T3", "S", 0),
    trip("T4", "OTHER", 1),
  ];
  const stops = [
    stop("A", "Aardvark"),
    stop("B", "Bison"),
    stop("C", "Camel"),
  ];
  const stopTimes: GtfsStopTime[] = [
    stopTime("T1", "A", 1),
    stopTime("T1", "B", 2),
    stopTime("T1", "C", 3),
    stopTime("T1", "A", 4), // loop
  ];
  const bundle: Pick<T816Bundle, "trips" | "stops" | "stopTimes"> = {
    trips,
    stops,
    stopTimes,
  };
  const rep = pickRepresentativeTrip(bundle);
  assert.equal(rep?.shapeId, "S");
  const out = orderStopsByTrip(bundle, rep!.tripId);
  assert.deepEqual(
    out.map((s) => s.stop_id),
    ["A", "B", "C"],
  );
});
