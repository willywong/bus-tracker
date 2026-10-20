import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_WEATHER_AREAS, areaForLocation } from "../areas";
import type { ForecastRow } from "../types";

// Real /weather/forecast rows (2026-10-20, junmob/final-year-project archive).
// See nudge.test.ts for provenance.
const forecast = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "forecast-klang-valley-2026-10-20.json"), "utf8"),
) as ForecastRow[];

const cases: [string, number, number, string][] = [
  ["KLCC", 3.1579, 101.7116, "kuala-lumpur"],
  ["Mid Valley", 3.1176, 101.6773, "kuala-lumpur"],
  ["Kepong", 3.2115, 101.6366, "kuala-lumpur"],
  ["Petaling Jaya SS2", 3.1182, 101.6216, "petaling"],
  ["Phileo Damansara (T816 stop)", 3.1005, 101.6234, "petaling"],
  ["Shah Alam Seksyen 7", 3.0727, 101.4893, "petaling"],
  ["Subang Jaya", 3.0438, 101.5806, "petaling"],
  ["Puchong", 3.0236, 101.6189, "petaling"],
  ["Klang town", 3.0436, 101.4490, "klang"],
  ["Rawang", 3.3203, 101.5755, "gombak"],
  ["Batu Caves", 3.2374, 101.6840, "gombak"],
  ["Kajang", 2.9935, 101.7871, "hulu-langat"],
  ["Ampang", 3.1488, 101.7616, "hulu-langat"],
  ["Cyberjaya", 2.9227, 101.6513, "sepang"],
  ["Putrajaya Presint 1", 2.9435, 101.6986, "putrajaya"],
  ["Banting", 2.8114, 101.5017, "kuala-langat"],
  ["Kuala Selangor", 3.3416, 101.2550, "kuala-selangor"],
  ["Kuala Kubu Bharu", 3.5659, 101.6556, "hulu-selangor"],
];

for (const [name, lat, lng, key] of cases) {
  test(`${name} -> ${key}`, () => {
    assert.equal(areaForLocation(lat, lng)?.key, key);
  });
}

test("outside the Klang Valley or invalid -> null", () => {
  assert.equal(areaForLocation(5.4141, 100.3288), null); // George Town
  assert.equal(areaForLocation(1.4927, 103.7414), null); // Johor Bahru
  assert.equal(areaForLocation(2.7297, 101.9381), null); // Seremban
  assert.equal(areaForLocation(NaN, 101.7), null);
});

test("every forecast id exists in the real payload with the expected name", () => {
  const names = new Map(forecast.map((r) => [r.location.location_id, r.location.location_name]));
  for (const area of ALL_WEATHER_AREAS) {
    const [districtId, stateId] = area.forecastLocationIds;
    assert.ok(names.has(districtId), `${area.key}: ${districtId}`);
    assert.ok(names.has(stateId), `${area.key}: ${stateId}`);
    assert.equal(names.get(districtId), area.label, `${area.key} district name`);
    assert.equal(names.get(stateId), area.state, `${area.key} state name`);
    // 7 days per id, as `contains=<id>@location__location_id` returns.
    assert.equal(forecast.filter((r) => r.location.location_id === districtId).length, 7);
  }
});
