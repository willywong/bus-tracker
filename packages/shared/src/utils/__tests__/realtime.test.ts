import assert from "node:assert/strict";
import test from "node:test";
import type { RouteId } from "../../types/bus.js";
import { entitiesToPositions } from "../realtime.js";
import type { DecodedFeed } from "../protobuf.js";

function feed(entities: DecodedFeed["entity"]): DecodedFeed {
  return {
    header: { gtfs_realtime_version: "2.0", timestamp: 1713000000 },
    entity: entities,
  };
}

function tripMap(pairs: Array<[string, RouteId]>): ReadonlyMap<string, RouteId> {
  return new Map(pairs);
}

const FALLBACK = 1_713_000_500_000;

test("entitiesToPositions emits one VehiclePosition per T816 trip", () => {
  const map = tripMap([
    ["T816-1", "T816"],
    ["T816-2", "T816"],
  ]);
  const positions = entitiesToPositions(
    feed([
      {
        id: "e1",
        vehicle: {
          trip: { trip_id: "T816-1", route_id: "30000025" },
          vehicle: { id: "MRT-001" },
          position: { latitude: 3.1, longitude: 101.62, bearing: 90, speed: 7 },
          timestamp: 1_713_000_010,
        },
      },
      {
        id: "e2",
        vehicle: {
          trip: { trip_id: "T816-2" },
          position: { latitude: 3.2, longitude: 101.63 },
        },
      },
    ]),
    map,
    FALLBACK,
  );

  assert.equal(positions.length, 2);
  assert.equal(positions[0].vehicleId, "MRT-001");
  assert.equal(positions[0].routeId, "T816");
  assert.equal(positions[0].tripId, "T816-1");
  assert.equal(positions[0].lat, 3.1);
  assert.equal(positions[0].lng, 101.62);
  assert.equal(positions[0].bearing, 90);
  assert.equal(positions[0].speed, 7);
  assert.equal(positions[0].observedAt, 1_713_000_010_000);

  // second entity: no vehicle.id → falls back to entity id; no timestamp → fallbackNow
  assert.equal(positions[1].vehicleId, "e2");
  assert.equal(positions[1].observedAt, FALLBACK);
});

test("entitiesToPositions rejects entries without trip_id, position, or mapping", () => {
  const map = tripMap([["T816-1", "T816"]]);
  const positions = entitiesToPositions(
    feed([
      { id: "no-vehicle" },
      {
        id: "no-trip",
        vehicle: { position: { latitude: 1, longitude: 2 } },
      },
      {
        id: "no-pos",
        vehicle: { trip: { trip_id: "T816-1" } },
      },
      {
        id: "unmapped-trip",
        vehicle: {
          trip: { trip_id: "T999-1" },
          position: { latitude: 3, longitude: 4 },
        },
      },
      {
        id: "deleted",
        is_deleted: true,
        vehicle: {
          trip: { trip_id: "T816-1" },
          position: { latitude: 5, longitude: 6 },
        },
      },
      {
        id: "ok",
        vehicle: {
          trip: { trip_id: "T816-1" },
          position: { latitude: 7, longitude: 8 },
        },
      },
    ]),
    map,
    FALLBACK,
  );
  assert.equal(positions.length, 1);
  assert.equal(positions[0].vehicleId, "ok");
});

test("entitiesToPositions falls back to trip.route_id when trip_id lookup misses", () => {
  // Mirrors the Prasarana data-drift case: static bundle's trip_ids carry one
  // date prefix (e.g. 260313...), realtime emits a different date prefix
  // (e.g. 260420...). The realtime entity still tags the route short-name
  // ("T816") on `trip.route_id`, which we trust when it's in the favorited set.
  const map = tripMap([["260313010076S10", "T816" as RouteId]]);
  const allowed = new Set(["T816"]) as ReadonlySet<RouteId>;
  const positions = entitiesToPositions(
    feed([
      {
        id: "e-fallback",
        vehicle: {
          trip: { trip_id: "260420010076S4", route_id: "T816" },
          vehicle: { id: "VH4643" },
          position: { latitude: 3.12, longitude: 101.64, bearing: 105, speed: 15 },
          timestamp: 1_713_000_010,
        },
      },
      {
        id: "e-not-favorited",
        vehicle: {
          trip: { trip_id: "260420010099S4", route_id: "T999" },
          position: { latitude: 3.13, longitude: 101.65 },
        },
      },
    ]),
    map,
    FALLBACK,
    allowed,
  );
  assert.equal(positions.length, 1);
  assert.equal(positions[0].vehicleId, "VH4643");
  assert.equal(positions[0].routeId, "T816");
  assert.equal(positions[0].tripId, "260420010076S4");
});

test("entitiesToPositions drops NaN lat/lng (sanity)", () => {
  const map = tripMap([["T816-1", "T816"]]);
  const positions = entitiesToPositions(
    feed([
      {
        id: "nan",
        vehicle: {
          trip: { trip_id: "T816-1" },
          position: { latitude: Number.NaN, longitude: 101 },
        },
      },
    ]),
    map,
    FALLBACK,
  );
  assert.equal(positions.length, 0);
});
