import assert from "node:assert/strict";
import test from "node:test";
import { strToU8 } from "fflate";

import { fnv1a32Hex, fnv1a32HexSteps, HASH_STEP_BYTES } from "../hash.js";

test("fnv1a32Hex matches the published FNV-1a 32-bit vectors", () => {
  assert.equal(fnv1a32Hex(new Uint8Array(0)), "811c9dc5");
  assert.equal(fnv1a32Hex(strToU8("a")), "e40c292c");
  assert.equal(fnv1a32Hex(strToU8("foobar")), "bf9cf968");
});

test("fnv1a32Hex pads to 8 hex digits and reads a view's own bytes", () => {
  const bytes = strToU8("xxfoobar");
  assert.equal(fnv1a32Hex(bytes.subarray(2)), "bf9cf968");
  for (let i = 0; i < 256; i++) assert.match(fnv1a32Hex(new Uint8Array([i])), /^[0-9a-f]{8}$/);
});

test("fnv1a32HexSteps yields every HASH_STEP_BYTES and matches the one-shot hash", () => {
  const bytes = new Uint8Array(HASH_STEP_BYTES * 2 + 5).map((_, i) => (i * 31) % 256);
  const steps = fnv1a32HexSteps(bytes);
  let yields = 0;
  let step = steps.next();
  while (!step.done) {
    yields++;
    step = steps.next();
  }
  assert.equal(yields, 2);
  assert.equal(step.value, fnv1a32Hex(bytes));
  // A whole number of steps doesn't yield after the last one.
  let exact = 0;
  const gen = fnv1a32HexSteps(bytes.subarray(0, HASH_STEP_BYTES));
  while (!gen.next().done) exact++;
  assert.equal(exact, 0);
});
