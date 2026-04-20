import assert from "node:assert/strict";
import test from "node:test";
import {
  isWithinQuietHours,
  minuteOfDay,
} from "../quiet-hours.js";

test("minuteOfDay: hours and minutes in one number", () => {
  assert.equal(minuteOfDay(new Date(2026, 3, 21, 0, 0)), 0);
  assert.equal(minuteOfDay(new Date(2026, 3, 21, 6, 30)), 390);
  assert.equal(minuteOfDay(new Date(2026, 3, 21, 23, 59)), 1439);
});

test("isWithinQuietHours: same-day window", () => {
  const range = { startMin: 13 * 60, endMin: 14 * 60 }; // 13:00–14:00
  assert.equal(isWithinQuietHours(13 * 60, range), true);
  assert.equal(isWithinQuietHours(13 * 60 + 30, range), true);
  assert.equal(isWithinQuietHours(14 * 60, range), false);
  assert.equal(isWithinQuietHours(12 * 60, range), false);
});

test("isWithinQuietHours: wrapping window 22:00–06:00", () => {
  const range = { startMin: 22 * 60, endMin: 6 * 60 };
  assert.equal(isWithinQuietHours(22 * 60, range), true);
  assert.equal(isWithinQuietHours(23 * 60 + 30, range), true);
  assert.equal(isWithinQuietHours(0, range), true);
  assert.equal(isWithinQuietHours(5 * 60, range), true);
  assert.equal(isWithinQuietHours(6 * 60, range), false);
  assert.equal(isWithinQuietHours(12 * 60, range), false);
  assert.equal(isWithinQuietHours(21 * 60 + 59, range), false);
});

test("isWithinQuietHours: empty window when start equals end", () => {
  const range = { startMin: 9 * 60, endMin: 9 * 60 };
  assert.equal(isWithinQuietHours(9 * 60, range), false);
  assert.equal(isWithinQuietHours(0, range), false);
});

test("isWithinQuietHours: accepts Date inputs", () => {
  const range = { startMin: 22 * 60, endMin: 6 * 60 };
  assert.equal(
    isWithinQuietHours(new Date(2026, 3, 21, 23, 30), range),
    true,
  );
  assert.equal(
    isWithinQuietHours(new Date(2026, 3, 21, 12, 0), range),
    false,
  );
});
