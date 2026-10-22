import assert from "node:assert/strict";
import test from "node:test";

import { simplifyPath } from "../shapes.js";

/** Degrees of latitude per metre. */
const M = 1 / 111_320;

test("simplifyPath keeps both ends of short paths unchanged", () => {
  assert.deepEqual(simplifyPath([]), []);
  const one = [{ lat: 3, lng: 101 }];
  assert.deepEqual(simplifyPath(one), one);
  const two = [{ lat: 3, lng: 101 }, { lat: 3.1, lng: 101.1 }];
  assert.deepEqual(simplifyPath(two), two);
});

test("simplifyPath drops points within 5 m of a straight run", () => {
  // 100 points due north, 1 m apart, wobbling 2 m east and west.
  const pts = Array.from({ length: 100 }, (_, i) => ({
    lat: 3 + i * M,
    lng: 101.7 + (i % 2 === 0 ? 2 : -2) * M,
  }));
  const out = simplifyPath(pts, 5);
  assert.equal(out.length, 2);
  assert.equal(out[0], pts[0]);
  assert.equal(out[1], pts[99]);
});

test("simplifyPath keeps a corner further than the tolerance, in order", () => {
  // An L: 50 m north, then 50 m east, sampled every metre.
  const north = Array.from({ length: 51 }, (_, i) => ({ lat: 3 + i * M, lng: 101.7 }));
  const east = Array.from({ length: 50 }, (_, i) => ({ lat: 3 + 50 * M, lng: 101.7 + (i + 1) * M }));
  const pts = [...north, ...east];
  const out = simplifyPath(pts, 5);
  assert.deepEqual(out, [pts[0], pts[50], pts[100]]);
});

test("simplifyPath keeps a 10 m bump but not a 3 m one", () => {
  const line = (bumpM: number) =>
    Array.from({ length: 21 }, (_, i) => ({ lat: 3 + i * 10 * M, lng: 101.7 + (i === 10 ? bumpM * M : 0) }));
  const bumped = line(10);
  assert.ok(simplifyPath(bumped, 5).includes(bumped[10]));
  assert.equal(simplifyPath(line(3), 5).length, 2);
});

test("simplifyPath handles a closed loop (first point == last point)", () => {
  const loop = Array.from({ length: 37 }, (_, i) => {
    const a = (i / 36) * 2 * Math.PI;
    return { lat: 3 + 200 * M * Math.sin(a), lng: 101.7 + 200 * M * Math.cos(a) };
  });
  const out = simplifyPath(loop, 5);
  assert.ok(out.length > 4 && out.length < loop.length, `kept ${out.length}`);
  assert.equal(out[0], loop[0]);
  assert.equal(out[out.length - 1], loop[36]);
});
