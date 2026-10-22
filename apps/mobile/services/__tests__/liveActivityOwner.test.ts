import assert from "node:assert/strict";
import { test } from "node:test";

import { busActivityAllowed, isGoActive, setGoActive, subscribeGoActive } from "../liveActivityOwner";

test("a followed bus shows its activity only while Go is off", () => {
  assert.equal(busActivityAllowed(true, false), true);
  assert.equal(busActivityAllowed(true, true), false);
  assert.equal(busActivityAllowed(false, false), false);
  assert.equal(busActivityAllowed(false, true), false);
});

test("setGoActive notifies on change only, and unsubscribes", () => {
  let calls = 0;
  const off = subscribeGoActive(() => calls++);
  assert.equal(isGoActive(), false);
  setGoActive(true);
  setGoActive(true);
  assert.equal(isGoActive(), true);
  assert.equal(calls, 1);
  setGoActive(false);
  assert.equal(calls, 2);
  off();
  setGoActive(true);
  assert.equal(calls, 2);
  setGoActive(false);
});
