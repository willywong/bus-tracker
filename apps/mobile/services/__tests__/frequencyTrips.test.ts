import assert from "node:assert/strict";
import { test } from "node:test";

import { pickFrequencyInstance, stripTripIdDatePrefix } from "../../db/queries";

const runs = [
  { trip_id: "kl:t@05:30", dep: 5.5 * 3600 },
  { trip_id: "kl:t@06:00", dep: 6 * 3600 },
  { trip_id: "kl:t@06:30", dep: 6.5 * 3600 },
  { trip_id: "kl:t@24:10", dep: 24 * 3600 + 600 },
];

test("a live run maps to the stored run nearest its start time", () => {
  assert.equal(pickFrequencyInstance(runs, 6 * 3600 + 20 * 60, 9 * 3600), "kl:t@06:30");
  assert.equal(pickFrequencyInstance(runs, 6 * 3600 + 5 * 60, 9 * 3600), "kl:t@06:00");
});

test("a start just after midnight matches yesterday's 24:xx run", () => {
  assert.equal(pickFrequencyInstance(runs, 8 * 60, 15 * 60), "kl:t@24:10");
});

test("without a start time: the run that left most recently, including after midnight", () => {
  assert.equal(pickFrequencyInstance(runs, null, 6 * 3600 + 10 * 60), "kl:t@06:00");
  assert.equal(pickFrequencyInstance(runs, null, 20 * 60), "kl:t@24:10");
  assert.equal(pickFrequencyInstance(runs.slice(0, 3), null, 60), "kl:t@05:30");
});

test("drift tier sees through the category namespace", () => {
  assert.equal(stripTripIdDatePrefix("pg:261016010252S5"), "010252S5");
  assert.equal(stripTripIdDatePrefix("261002010001S10"), "010001S10");
  assert.equal(stripTripIdDatePrefix("kl:weekday_U4000_x_2"), null);
});
