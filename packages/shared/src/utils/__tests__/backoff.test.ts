import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextPollDelay,
  parseRetryAfterMs,
} from "../backoff.js";

const BASE = 30_000;

test("computeNextPollDelay: success resets to base interval", () => {
  assert.equal(
    computeNextPollDelay({ baseMs: BASE, consecutiveFailures: 0 }),
    BASE,
  );
});

test("computeNextPollDelay: 429 honours Retry-After when >= base", () => {
  assert.equal(
    computeNextPollDelay({
      baseMs: BASE,
      consecutiveFailures: 1,
      status: 429,
      retryAfterMs: 45_000,
    }),
    45_000,
  );
});

test("computeNextPollDelay: 429 floors at base when Retry-After is below", () => {
  assert.equal(
    computeNextPollDelay({
      baseMs: BASE,
      consecutiveFailures: 1,
      status: 429,
      retryAfterMs: 5_000,
    }),
    BASE,
  );
});

test("computeNextPollDelay: 429 without Retry-After falls back to base", () => {
  assert.equal(
    computeNextPollDelay({
      baseMs: BASE,
      consecutiveFailures: 1,
      status: 429,
    }),
    BASE,
  );
});

test("computeNextPollDelay: 429 is capped at maxMs", () => {
  assert.equal(
    computeNextPollDelay({
      baseMs: BASE,
      consecutiveFailures: 1,
      status: 429,
      retryAfterMs: 10 * 60_000,
    }),
    BASE * 4,
  );
});

test("computeNextPollDelay: generic error exponential backoff capped at 4x base", () => {
  // 1st failure -> 30s (2^0 * base)
  assert.equal(
    computeNextPollDelay({ baseMs: BASE, consecutiveFailures: 1 }),
    BASE,
  );
  // 2nd failure -> 60s
  assert.equal(
    computeNextPollDelay({ baseMs: BASE, consecutiveFailures: 2 }),
    60_000,
  );
  // 3rd failure -> 120s (4x cap)
  assert.equal(
    computeNextPollDelay({ baseMs: BASE, consecutiveFailures: 3 }),
    120_000,
  );
  // 4th failure -> still capped
  assert.equal(
    computeNextPollDelay({ baseMs: BASE, consecutiveFailures: 4 }),
    120_000,
  );
});

test("parseRetryAfterMs: seconds form", () => {
  assert.equal(parseRetryAfterMs("45", 1_000_000), 45_000);
  assert.equal(parseRetryAfterMs("0", 1_000_000), 0);
});

test("parseRetryAfterMs: HTTP-date form", () => {
  const now = Date.parse("2026-04-22T12:00:00Z");
  const header = "Wed, 22 Apr 2026 12:00:45 GMT";
  assert.equal(parseRetryAfterMs(header, now), 45_000);
});

test("parseRetryAfterMs: past dates clamp to 0", () => {
  const now = Date.parse("2026-04-22T12:01:00Z");
  const header = "Wed, 22 Apr 2026 12:00:00 GMT";
  assert.equal(parseRetryAfterMs(header, now), 0);
});

test("parseRetryAfterMs: null / empty / garbage return null", () => {
  assert.equal(parseRetryAfterMs(null, 0), null);
  assert.equal(parseRetryAfterMs(undefined, 0), null);
  assert.equal(parseRetryAfterMs("   ", 0), null);
  assert.equal(parseRetryAfterMs("not-a-date", 0), null);
});
