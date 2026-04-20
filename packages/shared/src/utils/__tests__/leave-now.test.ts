import assert from "node:assert/strict";
import test from "node:test";
import { shouldNotify } from "../leave-now.js";

const QUIET_START_22 = 22 * 60;
const QUIET_END_06 = 6 * 60;

function noonOn(day = 21): Date {
  return new Date(2026, 3, day, 12, 0);
}

test("shouldNotify: fires when eta within walk + buffer outside quiet hours", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 11,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    true,
  );
});

test("shouldNotify: does not fire when eta exceeds threshold", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 12,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});

test("shouldNotify: exact match (eta === walk + buffer) fires", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 10,
      walkMinutes: 10,
      bufferMinutes: 0,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    true,
  );
});

test("shouldNotify: zero eta (bus already there) still fires outside quiet", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 0,
      walkMinutes: 10,
      bufferMinutes: 2,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    true,
  );
});

test("shouldNotify: negative eta (already passed) does not fire", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: -2,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});

test("shouldNotify: non-finite eta does not fire", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: Number.NaN,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: noonOn(),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});

test("shouldNotify: suppressed inside wrapping quiet hours (22:00-06:00)", () => {
  const midnight = new Date(2026, 3, 21, 0, 5);
  assert.equal(
    shouldNotify({
      etaMinutes: 8,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: midnight,
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});

test("shouldNotify: suppressed right at start of quiet (22:00) and before end (05:59)", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 22, 0),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 5, 59),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});

test("shouldNotify: fires at exact quiet-end boundary (06:00)", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 6, 0),
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    true,
  );
});

test("shouldNotify: same-day quiet window (13:00-14:00) suppresses only within", () => {
  const range = { quietStartMin: 13 * 60, quietEndMin: 14 * 60 };
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 13, 30),
      ...range,
    }),
    false,
  );
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 14, 0),
      ...range,
    }),
    true,
  );
});

test("shouldNotify: empty quiet window (start === end) never suppresses", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: new Date(2026, 3, 21, 3, 0),
      quietStartMin: 9 * 60,
      quietEndMin: 9 * 60,
    }),
    true,
  );
});

test("shouldNotify: accepts numeric minute-of-day for now", () => {
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: 12 * 60,
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    true,
  );
  assert.equal(
    shouldNotify({
      etaMinutes: 5,
      walkMinutes: 10,
      bufferMinutes: 1,
      now: 23 * 60,
      quietStartMin: QUIET_START_22,
      quietEndMin: QUIET_END_06,
    }),
    false,
  );
});
