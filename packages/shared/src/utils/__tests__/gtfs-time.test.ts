import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  gtfsTimeToSeconds,
  secondsToClockHHMM,
  toMalaysiaParts,
} from "../gtfs-time.js";

test("gtfsTimeToSeconds parses standard HH:MM:SS", () => {
  assert.equal(gtfsTimeToSeconds("00:00:00"), 0);
  assert.equal(gtfsTimeToSeconds("06:30:00"), 23400);
  assert.equal(gtfsTimeToSeconds("23:59:59"), 86399);
});

test("gtfsTimeToSeconds handles GTFS 24:00+ overflow", () => {
  assert.equal(gtfsTimeToSeconds("24:00:00"), 86400);
  assert.equal(gtfsTimeToSeconds("25:30:00"), 91800);
  assert.equal(gtfsTimeToSeconds("27:15:45"), 27 * 3600 + 15 * 60 + 45);
});

test("gtfsTimeToSeconds returns null for missing / malformed input", () => {
  assert.equal(gtfsTimeToSeconds(undefined), null);
  assert.equal(gtfsTimeToSeconds(null), null);
  assert.equal(gtfsTimeToSeconds(""), null);
  assert.equal(gtfsTimeToSeconds("6:30"), null);
  assert.equal(gtfsTimeToSeconds("abc"), null);
});

test("secondsToClockHHMM renders wall-clock within a single day", () => {
  assert.equal(secondsToClockHHMM(0), "00:00");
  assert.equal(secondsToClockHHMM(23400), "06:30");
  assert.equal(secondsToClockHHMM(86399), "23:59");
});

test("secondsToClockHHMM wraps GTFS overflow", () => {
  assert.equal(secondsToClockHHMM(86400), "00:00");
  assert.equal(secondsToClockHHMM(91800), "01:30");
});

test("toMalaysiaParts produces correct calendar parts around midnight", () => {
  // 2026-04-21 06:30:00 local Malaysia → UTC 2026-04-20T22:30:00Z
  const parts = toMalaysiaParts(new Date("2026-04-20T22:30:00Z"));
  assert.equal(parts.ymd, "20260421");
  assert.equal(parts.dow, 2); // Tuesday
  assert.equal(parts.secSinceMidnight, 23400);
});

test("toMalaysiaParts midnight offset aligns with Asia/Kuala_Lumpur", () => {
  // 2026-04-21 00:00 local MY = 2026-04-20T16:00:00Z
  const parts = toMalaysiaParts(new Date("2026-04-20T16:30:00Z"));
  assert.equal(parts.ymd, "20260421");
  assert.equal(parts.secSinceMidnight, 1800);
  assert.equal(parts.midnightUtcMs, Date.parse("2026-04-20T16:00:00Z"));
});

test("gtfsTimeToSeconds parses unpadded hours", () => {
  assert.equal(gtfsTimeToSeconds("6:00:00"), 21600);
  assert.equal(gtfsTimeToSeconds("9:05:30"), 9 * 3600 + 5 * 60 + 30);
});
