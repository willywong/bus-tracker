import assert from "node:assert/strict";
import { test } from "node:test";

import { arrivalShareMessage } from "../shareArrival";

test("null without stop", () => {
  assert.equal(arrivalShareMessage("T816", null, "4 min", "live"), null);
  assert.equal(arrivalShareMessage("T816", "Hotel Lisa De Inn", null, "live"), null);
});

test("scheduled wording", () => {
  assert.equal(
    arrivalShareMessage("T816", "Hotel Lisa De Inn", "08:15", "scheduled"),
    "T816 to Hotel Lisa De Inn: 08:15 (scheduled).",
  );
});

test("live wording", () => {
  assert.equal(
    arrivalShareMessage("T816", "Hotel Lisa De Inn", "4 min", "live"),
    "T816 to Hotel Lisa De Inn: 4 min (live estimate).",
  );
});
