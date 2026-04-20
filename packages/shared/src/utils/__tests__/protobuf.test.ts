import assert from "node:assert/strict";
import test from "node:test";
import protobuf from "protobufjs";
import { decodeFeed, getFeedMessage, resetProtobufCacheForTests } from "../protobuf.js";

function encodeFeed(obj: unknown): Uint8Array {
  const FeedMessage = getFeedMessage();
  const err = FeedMessage.verify(obj as Record<string, unknown>);
  if (err) throw new Error(`verify: ${err}`);
  const msg = FeedMessage.create(obj as Record<string, unknown>);
  return FeedMessage.encode(msg).finish();
}

test("decodeFeed roundtrips vehicle positions with keepCase snake_case fields", () => {
  resetProtobufCacheForTests();
  const buf = encodeFeed({
    header: {
      gtfs_realtime_version: "2.0",
      timestamp: 1713000000,
    },
    entity: [
      {
        id: "veh-001",
        vehicle: {
          trip: { trip_id: "T816-out-1", route_id: "30000025", direction_id: 0 },
          vehicle: { id: "MRT-001", label: "T816" },
          position: { latitude: 3.1005, longitude: 101.6234, bearing: 90, speed: 7.5 },
          timestamp: 1713000010,
        },
      },
    ],
  });

  const decoded = decodeFeed(buf);
  assert.equal(decoded.header.gtfs_realtime_version, "2.0");
  assert.equal(decoded.header.timestamp, 1713000000);
  assert.equal(decoded.entity.length, 1);

  const e = decoded.entity[0];
  assert.equal(e.id, "veh-001");
  assert.equal(e.vehicle?.trip?.trip_id, "T816-out-1");
  assert.equal(e.vehicle?.trip?.route_id, "30000025");
  assert.equal(e.vehicle?.vehicle?.id, "MRT-001");
  assert.ok(e.vehicle?.position);
  assert.ok(Math.abs(e.vehicle!.position!.latitude - 3.1005) < 1e-4);
  assert.ok(Math.abs(e.vehicle!.position!.longitude - 101.6234) < 1e-4);
  assert.equal(e.vehicle?.position?.bearing, 90);
});

test("decodeFeed on an empty feed returns an empty entity array", () => {
  resetProtobufCacheForTests();
  const buf = encodeFeed({
    header: { gtfs_realtime_version: "2.0" },
    entity: [],
  });
  const decoded = decodeFeed(buf);
  assert.equal(decoded.entity.length, 0);
});

test("FeedMessage type loads from inlined .proto text (keepCase)", () => {
  resetProtobufCacheForTests();
  const T = getFeedMessage();
  assert.equal(T.fullName, ".transit_realtime.FeedMessage");
  assert.ok(T.fields.entity);
  assert.ok(T.fields.header);
  // protobufjs exposes `type` on IField — it's a string name of the referenced message
  assert.equal((T.fields.entity as protobuf.Field).type, "FeedEntity");
});
