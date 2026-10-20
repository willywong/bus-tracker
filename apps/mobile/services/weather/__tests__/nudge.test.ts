import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { areaByKey, type WeatherArea } from "../areas";
import {
  buildRainNudge,
  classifyWarning,
  formatUntil,
  matchWarningArea,
  parseMytDateTime,
  slotFor,
  translateForecast,
} from "../nudge";
import type { ForecastRow, WarningRow } from "../types";

// Fixtures (in __tests__/fixtures):
// - forecast-klang-valley-2026-10-20.json: REAL rows, copied verbatim and
//   filtered to the 13 Klang Valley location ids, from the full
//   /weather/forecast payload junmob/final-year-project archived at
//   data/raw/weather_forecast/date=2026-10-20/fetched_at=164639.json.gz
//   (3,080 rows, 440 locations x 7 days).
// - warning-2026-10-20T1646.json: REAL /weather/warning payload, verbatim
//   (4 records: 2 marine "Strong Winds and Rough Seas", 1 land "Thunderstorms
//   Warning" 15:00–18:00 naming "Selangor (Hulu Selangor, Gombak, Hulu Langat
//   dan Petaling) • W.P. Kuala Lumpur", 1 "No Advisory"), from
//   data/raw/weather_warning/date=2026-10-20/fetched_at=164639.json.gz in the
//   same repo. floodguard-penang's 2026-09-24 capture has the same schema.
// - warning-continuous-rain-ASSUMED.json: CONSTRUCTED. No continuous-rain
//   record has been captured from this API. Field names and null patterns
//   copy the real payload above. The titles copy MET's warning family names
//   (met.gov.my "Amaran Hujan Berterusan (Tahap Waspada)"), and the area
//   syntax copies the real thunderstorm text. The "No Advisory" record is
//   copied from the real payload.

const FIXTURES = join(__dirname, "fixtures");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

const forecast = load<ForecastRow[]>("forecast-klang-valley-2026-10-20.json");
const realWarnings = load<WarningRow[]>("warning-2026-10-20T1646.json");
const assumedWarnings = load<WarningRow[]>("warning-continuous-rain-ASSUMED.json");

const area = (key: string): WeatherArea => {
  const a = areaByKey(key);
  if (!a) throw new Error(`unknown area ${key}`);
  return a;
};
const myt = (local: string) => Date.parse(`${local}+08:00`);

describe("buildRainNudge with real 2026-10-20 payloads", () => {
  const at1646 = myt("2026-10-20T16:46:00");

  test("active thunderstorm warning naming Petaling", () => {
    const nudge = buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("petaling"), now: at1646 });
    assert.deepEqual(nudge, {
      kind: "warning",
      title: "Thunderstorm warning",
      message: "Petaling until 18:00 — leave a few minutes early",
      validUntilMs: myt("2026-10-20T18:00:00"),
      sourceLabel: "MET Malaysia",
    });
  });

  test("whole-territory match for W.P. Kuala Lumpur", () => {
    const nudge = buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("kuala-lumpur"), now: new Date(at1646) });
    assert.equal(nudge?.kind, "warning");
    assert.equal(nudge?.message, "Kuala Lumpur until 18:00 — leave a few minutes early");
  });

  test("Klang is not in the warning's district list, so it falls back to the afternoon forecast", () => {
    const nudge = buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("klang"), now: at1646 });
    assert.deepEqual(nudge, {
      kind: "forecast",
      title: "Thunderstorms likely this afternoon",
      message: "Klang: thunderstorms in places — allow a few extra minutes",
      validUntilMs: myt("2026-10-20T19:00:00"),
      sourceLabel: "MET Malaysia",
    });
  });

  test("marine warnings mentioning 'perairan Selangor' never trigger", () => {
    const marine = realWarnings.filter((w) => /Laut Bergelora/.test(w.warning_issue?.title_bm ?? ""));
    assert.equal(marine.length, 2);
    assert.match(marine[0].text_bm ?? "", /perairan Selangor/);
    for (const key of ["kuala-selangor", "klang", "petaling"]) {
      assert.equal(buildRainNudge({ forecastRows: [], warnings: marine, area: area(key), now: at1646 }), null);
    }
  });

  test("expired warning is ignored, and hazy night gives no nudge", () => {
    // At 18:30 the 15:00–18:00 warning has expired, but the API still returns
    // it. The afternoon forecast (until 19:00) applies instead.
    const at1830 = buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("petaling"), now: myt("2026-10-20T18:30:00") });
    assert.equal(at1830?.kind, "forecast");
    // Ds057 night_forecast on 2026-10-20 is "Jerebu".
    assert.equal(
      buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("petaling"), now: myt("2026-10-20T19:30:00") }),
      null,
    );
  });

  test("warning not yet valid: morning forecast is used", () => {
    const nudge = buildRainNudge({
      forecastRows: forecast,
      warnings: realWarnings,
      area: area("petaling"),
      now: myt("2026-10-20T08:00:00"),
    });
    assert.equal(nudge?.kind, "forecast");
    assert.equal(nudge?.title, "Rain likely this morning");
    assert.equal(nudge?.message, "Petaling: rain in places — allow a few extra minutes");
    assert.equal(nudge?.validUntilMs, myt("2026-10-20T12:00:00"));
  });

  test("'Tiada Hujan' (real capitalisation) gives no nudge", () => {
    // Ds055 Gombak morning on 2026-10-20 is "Tiada Hujan".
    assert.equal(
      buildRainNudge({ forecastRows: forecast, warnings: [], area: area("gombak"), now: myt("2026-10-20T08:00:00") }),
      null,
    );
  });

  test("Putrajaya afternoon 'Jerebu' gives no nudge", () => {
    assert.equal(buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("putrajaya"), now: at1646 }), null);
  });

  test("night slot runs until 05:00 the next day", () => {
    const nudge = buildRainNudge({
      forecastRows: forecast,
      warnings: [],
      area: area("hulu-langat"),
      now: myt("2026-10-20T20:15:00"),
    });
    assert.equal(nudge?.title, "Rain likely tonight");
    assert.equal(nudge?.message, "Hulu Langat: rain in places — allow a few extra minutes");
    assert.equal(nudge?.validUntilMs, myt("2026-10-21T05:00:00"));
  });

  test("next-day rows are used after midnight", () => {
    const nudge = buildRainNudge({
      forecastRows: forecast,
      warnings: [],
      area: area("petaling"),
      now: myt("2026-10-21T13:00:00"),
    });
    assert.equal(nudge?.title, "Thunderstorms likely this afternoon");
  });

  test("before 05:00 needs yesterday's row, which the API doesn't serve, so null", () => {
    assert.equal(
      buildRainNudge({ forecastRows: forecast, warnings: [], area: area("petaling"), now: myt("2026-10-20T03:00:00") }),
      null,
    );
  });

  test("falls back to the state row when the district row is missing", () => {
    const stateOnly = forecast.filter((r) => r.location.location_id === "St008");
    const nudge = buildRainNudge({ forecastRows: stateOnly, warnings: [], area: area("petaling"), now: at1646 });
    assert.equal(nudge?.message, "Selangor: thunderstorms in places inland — allow a few extra minutes");

    const klState = forecast.filter((r) => r.location.location_id === "St009");
    const kl = buildRainNudge({ forecastRows: klState, warnings: [], area: area("kuala-lumpur"), now: at1646 });
    assert.equal(kl?.message, "Kuala Lumpur: thunderstorms in places — allow a few extra minutes");
  });

  test("returns null with no data at all", () => {
    assert.equal(buildRainNudge({ forecastRows: null, warnings: undefined, area: area("petaling"), now: at1646 }), null);
    assert.equal(buildRainNudge({ forecastRows: forecast, warnings: realWarnings, area: area("petaling"), now: NaN }), null);
  });
});

describe("buildRainNudge with assumed continuous-rain warning", () => {
  const at1500 = myt("2026-11-24T15:00:00");

  test("heavy rain outranks thunderstorm; multi-day end shows weekday", () => {
    const nudge = buildRainNudge({ forecastRows: [], warnings: assumedWarnings, area: area("klang"), now: at1500 });
    assert.deepEqual(nudge, {
      kind: "warning",
      title: "Heavy rain warning",
      message: "Klang until Wed midnight — leave a few minutes early",
      validUntilMs: myt("2026-11-26T00:00:00"),
      sourceLabel: "MET Malaysia",
    });
  });

  test("thunderstorm only for Petaling, and W.P. Putrajaya as a whole territory", () => {
    const p = buildRainNudge({ forecastRows: [], warnings: assumedWarnings, area: area("petaling"), now: at1500 });
    assert.equal(p?.title, "Thunderstorm warning");
    assert.equal(p?.message, "Petaling until 17:00 — leave a few minutes early");
    const pj = buildRainNudge({ forecastRows: [], warnings: assumedWarnings, area: area("putrajaya"), now: at1500 });
    assert.equal(pj?.message, "Putrajaya until 17:00 — leave a few minutes early");
  });

  test("unlisted district gets nothing", () => {
    assert.equal(buildRainNudge({ forecastRows: [], warnings: assumedWarnings, area: area("gombak"), now: at1500 }), null);
  });

  test("flood warning outranks the rest; open-ended warnings expire after 6 h", () => {
    const flood: WarningRow = {
      warning_issue: { issued: "2026-11-24T14:00:00", title_bm: "Amaran Banjir", title_en: "Flood Warning" },
      valid_from: null,
      valid_to: null,
      heading_bm: "AMARAN BANJIR",
      text_bm: "Banjir dijangka di negeri Selangor (Klang dan Kuala Langat).",
    };
    const nudge = buildRainNudge({ forecastRows: [], warnings: [...assumedWarnings, flood], area: area("klang"), now: at1500 });
    assert.equal(nudge?.title, "Flood warning");
    assert.equal(nudge?.message, "Klang — leave a few minutes early");
    assert.equal(nudge?.validUntilMs, null);

    const later = buildRainNudge({ forecastRows: [], warnings: [flood], area: area("klang"), now: myt("2026-11-24T21:00:00") });
    assert.equal(later, null);
  });
});

describe("translateForecast", () => {
  const cases: [string, string, "thunderstorm" | "rain" | "none"][] = [
    // Documented enum (weather.en.mdx)
    ["Berjerebu", "Hazy", "none"],
    ["Tiada hujan", "No rain", "none"],
    ["Hujan", "Rain", "rain"],
    ["Hujan di beberapa tempat", "Rain in places", "rain"],
    ["Hujan di satu dua tempat", "Isolated rain", "rain"],
    ["Hujan di satu dua tempat di kawasan pantai", "Isolated rain near the coast", "rain"],
    ["Hujan di satu dua tempat di kawasan pedalaman", "Isolated rain inland", "rain"],
    ["Ribut petir", "Thunderstorms", "thunderstorm"],
    ["Ribut petir di beberapa tempat", "Thunderstorms in places", "thunderstorm"],
    ["Ribut petir di beberapa tempat di kawasan pedalaman", "Thunderstorms in places inland", "thunderstorm"],
    ["Ribut petir di satu dua tempat", "Isolated thunderstorms", "thunderstorm"],
    ["Ribut petir di satu dua tempat di kawasan pantai", "Isolated thunderstorms near the coast", "thunderstorm"],
    ["Ribut petir di satu dua tempat di kawasan pedalaman", "Isolated thunderstorms inland", "thunderstorm"],
    // Seen in the real 2026-10-20 payload but missing from the docs
    ["Tiada Hujan", "No rain", "none"],
    ["Jerebu", "Hazy", "none"],
    ["Mendung", "Cloudy", "none"],
    ["Ribut petir di kebanyakan tempat", "Thunderstorms in most places", "thunderstorm"],
    ["Hujan di kebanyakan tempat", "Rain in most places", "rain"],
    ["Ribut petir menyeluruh", "Widespread thunderstorms", "thunderstorm"],
    ["Ribut petir menyeluruh di kawasan pedalaman", "Widespread thunderstorms inland", "thunderstorm"],
    ["Hujan di beberapa tempat di kawasan pantai", "Rain in places near the coast", "rain"],
    ["Ribut petir di beberapa tempat di kawasan pantai", "Thunderstorms in places near the coast", "thunderstorm"],
    // Defensive
    ["  ribut   PETIR  ", "Thunderstorms", "thunderstorm"],
    ["Hujan lebat", "Heavy rain", "rain"],
  ];
  for (const [ms, en, precip] of cases) {
    test(`${ms} -> ${en}`, () => {
      const t = translateForecast(ms);
      assert.equal(t?.english, en);
      assert.equal(t?.precip, precip);
    });
  }

  test("covers every distinct value in the real fixture", () => {
    const values = new Set(
      forecast.flatMap((r) => [r.morning_forecast, r.afternoon_forecast, r.night_forecast, r.summary_forecast]),
    );
    for (const v of values) {
      const t = translateForecast(v);
      assert.ok(t, String(v));
      assert.notEqual(t?.english, v, `untranslated: ${v}`);
    }
  });

  test("empty and unknown", () => {
    assert.equal(translateForecast(""), null);
    assert.equal(translateForecast(null), null);
    assert.deepEqual(translateForecast("Berangin"), { precip: "none", isolated: false, english: "Berangin" });
  });

  test("isolated flag drives 'possible' wording", () => {
    const rows: ForecastRow[] = [
      { location: { location_id: "Ds057", location_name: "Petaling" }, date: "2026-10-22", afternoon_forecast: "Ribut petir di satu dua tempat" },
    ];
    const nudge = buildRainNudge({ forecastRows: rows, warnings: [], area: area("petaling"), now: myt("2026-10-22T14:00:00") });
    assert.equal(nudge?.title, "Thunderstorms possible this afternoon");
    assert.equal(nudge?.message, "Petaling: isolated thunderstorms — allow a few extra minutes");
  });
});

describe("warning helpers", () => {
  test("classifyWarning on real records", () => {
    assert.deepEqual(realWarnings.map(classifyWarning), [null, null, "thunderstorm", null]);
  });

  test("matchWarningArea parses the real thunderstorm text", () => {
    const thunder = realWarnings[2];
    assert.equal(matchWarningArea(thunder.text_bm, area("petaling")), "Petaling");
    assert.equal(matchWarningArea(thunder.text_bm, area("gombak")), "Gombak");
    assert.equal(matchWarningArea(thunder.text_bm, area("hulu-selangor")), "Hulu Selangor");
    assert.equal(matchWarningArea(thunder.text_bm, area("hulu-langat")), "Hulu Langat");
    assert.equal(matchWarningArea(thunder.text_bm, area("kuala-lumpur")), "Kuala Lumpur");
    assert.equal(matchWarningArea(thunder.text_bm, area("klang")), null);
    assert.equal(matchWarningArea(thunder.text_bm, area("sepang")), null);
    assert.equal(matchWarningArea(thunder.text_bm, area("putrajaya")), null);
    // The English text uses the same names for these states.
    assert.equal(matchWarningArea(thunder.text_en, area("petaling")), "Petaling");
  });

  test("'Hulu Selangor' inside brackets is not the whole state", () => {
    assert.equal(matchWarningArea("di negeri Perak (Hulu Perak) • Selangor (Hulu Selangor)", area("petaling")), null);
    assert.equal(matchWarningArea("Pahang (Bentong dan Hulu Selangor)", area("hulu-selangor")), null);
    assert.equal(matchWarningArea("di negeri Perak (Kinta) • Selangor sehingga 6:00 Petang", area("petaling")), "Selangor");
    assert.equal(matchWarningArea("Selangor (Petaling) dan W.P. Kuala Lumpur sehingga 5:00 Petang", area("kuala-lumpur")), "Kuala Lumpur");
    assert.equal(matchWarningArea("Selangor (Petaling) dan W.P. Kuala Lumpur", area("petaling")), "Petaling");
  });

  test("time helpers", () => {
    assert.equal(parseMytDateTime("2026-10-20T18:00:00"), Date.parse("2026-10-20T10:00:00Z"));
    assert.equal(parseMytDateTime("2026-10-20 18:00:00"), Date.parse("2026-10-20T10:00:00Z"));
    assert.equal(parseMytDateTime("2026-10-20T18:00:00+08:00"), Date.parse("2026-10-20T10:00:00Z"));
    assert.equal(parseMytDateTime(null), null);
    assert.equal(parseMytDateTime("garbage"), null);

    const now = myt("2026-10-20T16:00:00");
    assert.equal(formatUntil(myt("2026-10-20T18:00:00"), now), "18:00");
    assert.equal(formatUntil(myt("2026-10-21T00:00:00"), now), "midnight");
    assert.equal(formatUntil(myt("2026-10-23T00:00:00"), now), "Thu midnight");
    assert.equal(formatUntil(myt("2026-10-21T09:30:00"), now), "Wed 09:30");

    assert.equal(slotFor(myt("2026-10-20T04:59:00")).period, "night");
    assert.equal(slotFor(myt("2026-10-20T04:59:00")).date, "2026-10-19");
    assert.equal(slotFor(myt("2026-10-20T05:00:00")).period, "morning");
    assert.equal(slotFor(myt("2026-10-20T11:59:00")).period, "morning");
    assert.equal(slotFor(myt("2026-10-20T12:00:00")).period, "afternoon");
    assert.equal(slotFor(myt("2026-10-20T19:00:00")).period, "night");
    // 23:30 MYT is 15:30 UTC the same day; 00:30 MYT is the previous UTC day.
    assert.equal(slotFor(myt("2026-10-21T00:30:00")).date, "2026-10-20");
  });
});
