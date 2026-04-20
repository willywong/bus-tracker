import assert from "node:assert/strict";
import test from "node:test";
import type { VehiclePosition } from "../../types/bus.js";
import { createOutlierFilter, haversineMeters } from "../outlier.js";

function pos(
  vehicleId: string,
  lat: number,
  lng: number,
  t: number,
): VehiclePosition {
  return {
    vehicleId,
    tripId: "T816-1",
    routeId: "T816",
    lat,
    lng,
    observedAt: t,
  };
}

test("haversineMeters: zero distance on identical points", () => {
  assert.equal(haversineMeters({ lat: 3.1, lng: 101.6 }, { lat: 3.1, lng: 101.6 }), 0);
});

test("haversineMeters: ~111km per degree of latitude", () => {
  const m = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(m - 111_195) < 500, `got ${m}`);
});

test("outlier filter accepts first reading per vehicle, then rejects >500m jumps", () => {
  const rejected: Array<{ id: string; meters: number }> = [];
  const f = createOutlierFilter({
    onReject: (p, _r, meters) => rejected.push({ id: p.vehicleId, meters }),
  });

  // baseline
  const r1 = f.accept([pos("A", 3.1, 101.6, 1)]);
  assert.equal(r1.length, 1);

  // ~0m shift — accepted
  const r2 = f.accept([pos("A", 3.10001, 101.60001, 2)]);
  assert.equal(r2.length, 1);

  // ~1.1km jump in latitude (0.01 deg ≈ 1.1km) — rejected
  const r3 = f.accept([pos("A", 3.11, 101.6, 3)]);
  assert.equal(r3.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].id, "A");
  assert.ok(rejected[0].meters > 500);

  // a different vehicle — first reading always accepted even if far
  const r4 = f.accept([pos("B", 3.5, 101.8, 4)]);
  assert.equal(r4.length, 1);
});

test("outlier filter: once rejected, last-accepted is not advanced — next small step is still compared to the older anchor", () => {
  const f = createOutlierFilter();
  f.accept([pos("A", 3.1, 101.6, 1)]);
  f.accept([pos("A", 3.2, 101.6, 2)]); // reject: ~11km
  const next = f.accept([pos("A", 3.1001, 101.6, 3)]);
  assert.equal(next.length, 1, "reading close to the original anchor should be accepted");
});

test("outlier filter: reset() forgets all anchors", () => {
  const f = createOutlierFilter();
  f.accept([pos("A", 3.1, 101.6, 1)]);
  f.reset();
  // a huge jump is fine right after reset — it's the new first reading
  const r = f.accept([pos("A", 5, 110, 2)]);
  assert.equal(r.length, 1);
});
