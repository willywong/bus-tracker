// Pure logic that turns MET Malaysia forecast rows and warnings into a
// single short English nudge for a stop's area. No I/O and no clock reads:
// `now` is always passed in.

import type { WeatherArea } from "./areas";
import type { ForecastRow, RainNudge, WarningRow } from "./types";

export type { RainNudge } from "./types";

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A warning with no valid_to counts as active for this long after it starts. */
const OPEN_ENDED_WARNING_MS = 6 * HOUR_MS;

// ---------------------------------------------------------------------------
// Time helpers (Malaysia is UTC+8 all year, with no DST)

/**
 * Parses MET's timezone-naive ISO datetimes as Malaysia time. Strings that
 * already carry an offset or "Z" are respected. Returns null for empty or
 * invalid input.
 */
export function parseMytDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const withTime = /T\d/.test(trimmed) ? trimmed : `${trimmed}T00:00:00`;
  const ms = Date.parse(hasZone ? withTime : `${withTime}+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

interface MytParts {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

function mytParts(ms: number): MytParts {
  const d = new Date(ms + MYT_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Epoch ms of `date` (YYYY-MM-DD, Malaysia time) at `hour`:00. */
function mytDateAtHour(date: string, hour: number): number {
  return Date.parse(`${date}T00:00:00+08:00`) + hour * HOUR_MS;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Formats an end time in Malaysia time: "18:00" for later today, "midnight"
 * for tonight's midnight, "Wed midnight" for a later midnight, and
 * "Fri 09:00" for other days.
 */
export function formatUntil(untilMs: number, nowMs: number): string {
  const until = mytParts(untilMs);
  const now = mytParts(nowMs);
  if (until.hour === 0 && until.minute === 0) {
    const dayBefore = mytParts(untilMs - 60_000);
    return dayBefore.date === now.date ? "midnight" : `${WEEKDAYS[dayBefore.weekday]} midnight`;
  }
  const hhmm = `${pad2(until.hour)}:${pad2(until.minute)}`;
  if (until.date === now.date) return hhmm;
  return `${WEEKDAYS[until.weekday]} ${hhmm}`;
}

// ---------------------------------------------------------------------------
// Forecast phrase translation

export type Precip = "thunderstorm" | "rain" | "none";

export interface ForecastPhrase {
  precip: Precip;
  /** True for "di satu dua tempat" (isolated). */
  isolated: boolean;
  /** Concise English, e.g. "Thunderstorms in places". */
  english: string;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Translates MET's Malay forecast vocabulary into short English. It covers
 * the documented enum and the extra spellings seen in real payloads
 * ("Tiada Hujan", "Jerebu", "Mendung", "di kebanyakan tempat",
 * "menyeluruh"). Unknown phrases that mention rain or thunderstorms are
 * still classified, and other unknown phrases come back with precip "none".
 */
export function translateForecast(text: string | null | undefined): ForecastPhrase | null {
  if (!text || !text.trim()) return null;
  const t = normalise(text);

  if (t.includes("tiada hujan")) return { precip: "none", isolated: false, english: "No rain" };

  const thunder = t.includes("ribut petir");
  const rain = !thunder && /\bhujan\b/.test(t);
  if (!thunder && !rain) {
    let english = text.trim();
    if (/\b(ber)?jerebu\b/.test(t)) english = "Hazy";
    else if (t.includes("mendung")) english = "Cloudy";
    else if (t.includes("cerah")) english = "Fair";
    return { precip: "none", isolated: false, english };
  }

  const heavy = rain && t.includes("lebat");
  const base = thunder ? "Thunderstorms" : heavy ? "Heavy rain" : "Rain";
  const lower = base.toLowerCase();
  const isolated = t.includes("satu dua tempat");

  let english: string;
  if (isolated) english = `Isolated ${lower}`;
  else if (t.includes("kebanyakan tempat")) english = `${base} in most places`;
  else if (t.includes("beberapa tempat")) english = `${base} in places`;
  else if (t.includes("menyeluruh")) english = `Widespread ${lower}`;
  else english = base;

  if (t.includes("kawasan pantai")) english += " near the coast";
  else if (t.includes("kawasan pedalaman")) english += " inland";

  return { precip: thunder ? "thunderstorm" : "rain", isolated, english };
}

// ---------------------------------------------------------------------------
// Warnings

export type WarningKind = "flood" | "heavy-rain" | "thunderstorm";

const WARNING_RANK: Record<WarningKind, number> = { flood: 3, "heavy-rain": 2, thunderstorm: 1 };
const WARNING_TITLE: Record<WarningKind, string> = {
  flood: "Flood warning",
  "heavy-rain": "Heavy rain warning",
  thunderstorm: "Thunderstorm warning",
};

/**
 * Classifies a warning by its title and heading only. The body of a marine
 * "Strong Winds and Rough Seas" warning also contains "THUNDERSTORMS
 * WARNING … waters of Selangor", so the body is never used to decide the
 * type. Returns null for marine, cyclone, earthquake and "No Advisory"
 * records.
 */
export function classifyWarning(w: WarningRow): WarningKind | null {
  const head = normalise(
    [w.warning_issue?.title_bm, w.warning_issue?.title_en, w.heading_bm, w.heading_en]
      .filter(Boolean)
      .join(" | "),
  );
  if (!head) return null;
  if (/tiada nasihat|no advisory|laut bergelora|rough seas|siklon|cyclone|gempa|earthquake|tsunami/.test(head)) {
    return null;
  }
  if (/banjir|flood/.test(head)) return "flood";
  if (/hujan berterusan|continuous rain|hujan lebat|heavy rain/.test(head)) return "heavy-rain";
  if (/ribut petir|thunderstorm/.test(head)) return "thunderstorm";
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parenDepth(text: string, end: number): number {
  let depth = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function splitDistricts(list: string): string[] {
  return list
    .split(/,|&|\bdan\b|\band\b/i)
    .map((s) => normalise(s))
    .filter(Boolean);
}

/**
 * Checks whether a warning's free text covers the area. MET writes the
 * areas as "State (District, District dan District) • State • …"
 * (real thunderstorm warning, 2026-10-20). A state with no district list
 * means the whole state. Returns the place name to show, or null.
 *
 * Only a state or territory named at the top level counts. A district
 * named alone, outside its state's brackets, is not matched, because names
 * like "Klang" are ambiguous ("Lembah Klang", "Pelabuhan Klang").
 */
export function matchWarningArea(text: string | null | undefined, area: WeatherArea): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ");
  const wanted = area.warningDistrictNames.map(normalise);
  let wholeState = false;

  for (const name of area.warningStateNames) {
    const re = new RegExp(
      // MET place names are plain ASCII, so [A-Za-z] avoids needing Unicode
      // property escapes (\p{L}) in Hermes.
      `(^|[^A-Za-z.])(${escapeRegExp(name)})(?![A-Za-z])\\s*(?:\\(([^)]*)\\))?`,
      "gi",
    );
    for (const m of flat.matchAll(re)) {
      const start = (m.index ?? 0) + m[1].length;
      if (parenDepth(flat, start) > 0) continue; // inside another state's district list
      // "Hulu Selangor" / "Kuala Selangor" are districts, not the state.
      const before = flat.slice(Math.max(0, start - 6), start).toLowerCase();
      if (/(hulu|ulu|kuala) $/.test(before)) continue;
      const districts = m[3];
      if (districts === undefined) {
        wholeState = true;
        continue;
      }
      if (splitDistricts(districts).some((d) => wanted.includes(d))) return area.label;
    }
  }
  return wholeState ? area.stateLabel : null;
}

interface ActiveWarning {
  kind: WarningKind;
  place: string;
  validToMs: number | null;
}

function activeWarningsForArea(
  warnings: readonly WarningRow[],
  area: WeatherArea,
  nowMs: number,
): ActiveWarning[] {
  const out: ActiveWarning[] = [];
  for (const w of warnings) {
    if (!w) continue;
    const kind = classifyWarning(w);
    if (!kind) continue;

    const fromMs = parseMytDateTime(w.valid_from);
    const toMs = parseMytDateTime(w.valid_to);
    if (fromMs !== null && fromMs > nowMs) continue; // not started yet
    if (toMs !== null) {
      if (toMs <= nowMs) continue; // expired, which the API still returns
    } else {
      const startMs = fromMs ?? parseMytDateTime(w.warning_issue?.issued);
      if (startMs === null || nowMs - startMs > OPEN_ENDED_WARNING_MS) continue;
    }

    const place = matchWarningArea(w.text_bm, area) ?? matchWarningArea(w.text_en, area);
    if (!place) continue;
    out.push({ kind, place, validToMs: toMs });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forecast period

export type ForecastPeriod = "morning" | "afternoon" | "night";

interface Slot {
  period: ForecastPeriod;
  /** Which row's date to read (night before 05:00 is yesterday's night). */
  date: string;
  endsAtMs: number;
}

/**
 * MET doesn't publish the hour boundaries of pagi, petang and malam. We use
 * morning 05:00–12:00, afternoon 12:00–19:00 and night 19:00–05:00. The
 * morning slot starts at 05:00 so first-bus commuters get the morning
 * forecast. Before 05:00 we read the previous day's night forecast, which
 * the API usually no longer serves, so there's no nudge then.
 */
export function slotFor(nowMs: number): Slot {
  const { date, hour } = mytParts(nowMs);
  if (hour < 5) return { period: "night", date: addDays(date, -1), endsAtMs: mytDateAtHour(date, 5) };
  if (hour < 12) return { period: "morning", date, endsAtMs: mytDateAtHour(date, 12) };
  if (hour < 19) return { period: "afternoon", date, endsAtMs: mytDateAtHour(date, 19) };
  return { period: "night", date, endsAtMs: mytDateAtHour(addDays(date, 1), 5) };
}

const PERIOD_PHRASE: Record<ForecastPeriod, string> = {
  morning: "this morning",
  afternoon: "this afternoon",
  night: "tonight",
};

function periodText(row: ForecastRow, period: ForecastPeriod): string | null | undefined {
  if (period === "morning") return row.morning_forecast;
  if (period === "afternoon") return row.afternoon_forecast;
  return row.night_forecast;
}

function displayLocationName(row: ForecastRow, area: WeatherArea): string {
  const name = row.location?.location_name?.trim();
  if (!name) return area.label;
  return name.replace(/^W\.?P\.?\s+/i, "");
}

// ---------------------------------------------------------------------------
// Public entry point

export interface BuildRainNudgeInput {
  /** Rows from /weather/forecast for any of area.forecastLocationIds. */
  forecastRows: readonly ForecastRow[] | null | undefined;
  /** Records from /weather/warning, unfiltered. */
  warnings: readonly WarningRow[] | null | undefined;
  area: WeatherArea;
  now: number | Date;
}

/**
 * Picks at most one nudge for the area:
 * 1. An active thunderstorm, heavy or continuous rain, or flood warning
 *    whose text names the area's district (or its whole state or territory).
 *    Floods rank above heavy rain, which ranks above thunderstorms. On a tie,
 *    the warning lasting longest wins.
 * 2. Otherwise, rain or thunderstorms in today's forecast for the period
 *    covering `now`. The first location id in area.forecastLocationIds that
 *    has a row for that date is used.
 * Returns null when nothing relevant applies.
 */
export function buildRainNudge(input: BuildRainNudgeInput): RainNudge | null {
  const { area } = input;
  const nowMs = typeof input.now === "number" ? input.now : input.now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  const active = activeWarningsForArea(input.warnings ?? [], area, nowMs);
  if (active.length > 0) {
    active.sort(
      (a, b) =>
        WARNING_RANK[b.kind] - WARNING_RANK[a.kind] ||
        (b.validToMs ?? Infinity) - (a.validToMs ?? Infinity),
    );
    const best = active[0];
    const until = best.validToMs !== null ? ` until ${formatUntil(best.validToMs, nowMs)}` : "";
    return {
      kind: "warning",
      title: WARNING_TITLE[best.kind],
      message: `${best.place}${until} — leave a few minutes early`,
      validUntilMs: best.validToMs,
      sourceLabel: "MET Malaysia",
    };
  }

  const rows = input.forecastRows ?? [];
  const slot = slotFor(nowMs);
  let row: ForecastRow | undefined;
  for (const id of area.forecastLocationIds) {
    row = rows.find((r) => r?.location?.location_id === id && r.date === slot.date);
    if (row) break;
  }
  if (!row) return null;

  const phrase = translateForecast(periodText(row, slot.period));
  if (!phrase || phrase.precip === "none") return null;

  const what = phrase.precip === "thunderstorm" ? "Thunderstorms" : "Rain";
  const likelihood = phrase.isolated ? "possible" : "likely";
  return {
    kind: "forecast",
    title: `${what} ${likelihood} ${PERIOD_PHRASE[slot.period]}`,
    message: `${displayLocationName(row, area)}: ${phrase.english.charAt(0).toLowerCase()}${phrase.english.slice(1)} — allow a few extra minutes`,
    validUntilMs: slot.endsAtMs,
    sourceLabel: "MET Malaysia",
  };
}
