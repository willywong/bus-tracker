// Minimal response types for the MET Malaysia endpoints on api.data.gov.my.
// Only the fields BusBuddy reads are listed. Every field is typed as
// possibly missing or null, because the docs and real payloads disagree
// (see the per-field notes).
//
// Shapes were checked against real payloads captured on 2026-10-20 by
// junmob/final-year-project (data/raw/weather_{forecast,warning}/) and on
// 2026-09-24 by luqshzeeq3601-art/floodguard-penang (tests/fixtures/
// metmalaysia/), and against the official docs (datagovmy-front
// apps/docs/pages/realtime-api/weather.en.mdx).

/** One row of GET /weather/forecast: one location on one calendar day. */
export interface ForecastRow {
  location: {
    /** "AA000": St state, Ds district, Tn town, Rc recreation, Dv division. */
    location_id: string;
    location_name: string;
  };
  /** Naive calendar date in Malaysia time, "YYYY-MM-DD". */
  date: string;
  /**
   * Malay text from a fixed vocabulary, e.g. "Ribut petir di beberapa
   * tempat". Real data has values the docs don't list: "Tiada Hujan"
   * (capital H), "Jerebu", "Mendung", "… di kebanyakan tempat",
   * "Ribut petir menyeluruh".
   */
  morning_forecast?: string | null;
  afternoon_forecast?: string | null;
  night_forecast?: string | null;
  summary_forecast?: string | null;
  /** "Pagi", "Petang", "Malam", "Pagi dan Petang", …, "Sepanjang Hari". */
  summary_when?: string | null;
  min_temp?: number | null;
  max_temp?: number | null;
}

/** One record of GET /weather/warning. */
export interface WarningRow {
  warning_issue?: {
    /** Naive ISO datetime in Malaysia time, e.g. "2026-10-20T15:25:00". */
    issued?: string | null;
    /** e.g. "Amaran Ribut Petir", "Amaran Angin Kencang dan Laut Bergelora", "Tiada Nasihat". */
    title_bm?: string | null;
    /** e.g. "Thunderstorms Warning", "Strong Winds and Rough Seas Warning", "No Advisory". */
    title_en?: string | null;
  } | null;
  /** Naive ISO datetime in Malaysia time. Null on "No Advisory" records. */
  valid_from?: string | null;
  /**
   * Naive ISO datetime in Malaysia time. Null on "No Advisory" records.
   * The API keeps returning records after this time, so filter on the client.
   */
  valid_to?: string | null;
  heading_en?: string | null;
  heading_bm?: string | null;
  /** Free text. The only place the affected areas are named. */
  text_en?: string | null;
  text_bm?: string | null;
  instruction_en?: string | null;
  instruction_bm?: string | null;
}

/** What the sky is doing, for the nudge's glyph. */
export type RainCondition = "thunderstorm" | "rain" | "heavy-rain" | "flood";

export interface RainNudge {
  kind: "warning" | "forecast";
  condition: RainCondition;
  /** The headline, "Thunderstorms likely this afternoon". */
  title: string;
  /** Where and what to do, without repeating the title: "Expected in parts of Petaling. Leave a few minutes early." */
  message: string;
  /** Epoch ms when the warning or forecast period ends. Null if unknown. */
  validUntilMs: number | null;
  sourceLabel: "MET Malaysia";
}
