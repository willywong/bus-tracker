import { strict as assert } from "node:assert";
import { test } from "node:test";

import { computeScheduleDelay } from "../schedule-delay.js";

const MIDNIGHT = Date.UTC(2026, 3, 20, 16, 0, 0); // 2026-04-21 00:00 MYT

test("computeScheduleDelay returns null without schedule", () => {
  const res = computeScheduleDelay({
    scheduledDepartureSeconds: null,
    projectedArrivalEpochMs: MIDNIGHT + 23400 * 1000,
    serviceDayMidnightUtcMs: MIDNIGHT,
  });
  assert.equal(res, null);
});

test("on-time band is ±2 minutes", () => {
  const scheduled = 23400; // 06:30 MYT
  // +1m30s — inside the band
  const within = computeScheduleDelay({
    scheduledDepartureSeconds: scheduled,
    projectedArrivalEpochMs: MIDNIGHT + (scheduled + 90) * 1000,
    serviceDayMidnightUtcMs: MIDNIGHT,
  });
  assert.equal(within?.onTimeWindow, "on-time");

  // +3 minutes — late
  const late = computeScheduleDelay({
    scheduledDepartureSeconds: scheduled,
    projectedArrivalEpochMs: MIDNIGHT + (scheduled + 180) * 1000,
    serviceDayMidnightUtcMs: MIDNIGHT,
  });
  assert.equal(late?.onTimeWindow, "late");
  assert.equal(Math.round(late!.delayMinutes), 3);

  // −4 minutes — early
  const early = computeScheduleDelay({
    scheduledDepartureSeconds: scheduled,
    projectedArrivalEpochMs: MIDNIGHT + (scheduled - 240) * 1000,
    serviceDayMidnightUtcMs: MIDNIGHT,
  });
  assert.equal(early?.onTimeWindow, "early");
});

test("mismatch threshold discards implausible deltas", () => {
  const res = computeScheduleDelay({
    scheduledDepartureSeconds: 23400,
    projectedArrivalEpochMs: MIDNIGHT + (23400 + 30 * 60) * 1000, // +30 min
    serviceDayMidnightUtcMs: MIDNIGHT,
  });
  assert.equal(res, null, "should discard 30-minute deltas as trip mismatch");
});

test("custom maxAbsDelayMinutes widens the matching window", () => {
  const res = computeScheduleDelay({
    scheduledDepartureSeconds: 23400,
    projectedArrivalEpochMs: MIDNIGHT + (23400 + 20 * 60) * 1000,
    serviceDayMidnightUtcMs: MIDNIGHT,
    maxAbsDelayMinutes: 30,
  });
  assert.ok(res);
  assert.equal(res?.onTimeWindow, "late");
  assert.equal(Math.round(res!.delayMinutes), 20);
});
