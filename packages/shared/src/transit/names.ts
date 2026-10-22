import type { FeedId } from "./network.js";

// Rail and KTM stop names arrive ALL CAPS ("KL SENTRAL - REDONE"); these turn
// them into display case. Shared by the rail-stations script and the feed
// reader so a station reads the same everywhere.

/** Naming-rights suffixes dropped from display names ("KL SENTRAL - REDONE"). */
export const SPONSOR_SUFFIXES = new Set([
  "UOB",
  "REDONE",
  "BANK RAKYAT",
  "CBP COOPBANK PERTAMA",
]);
export const UPPERCASE_WORDS = new Set([
  "KL", "KLCC", "PWTC", "USJ", "SS", "IOI", "UPM", "SA", "TTDI", "TRX", "BRT",
  "LRT", "MRT", "UOB",
]);
export const SPECIAL_WORDS: Record<string, string> = {
  UITM: "UiTM",
  SUNMED: "SunMed",
};

export function stripSponsor(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s+-\s+(.+)$/.exec(clean);
  if (m && SPONSOR_SUFFIXES.has(m[2].toUpperCase())) return m[1];
  return clean;
}

export function titleWord(w: string): string {
  if (w === "") return w;
  const up = w.toUpperCase();
  if (w !== up) return w; // already mixed case in the feed ("SunU")
  if (SPECIAL_WORDS[up]) return SPECIAL_WORDS[up];
  if (UPPERCASE_WORDS.has(up) || /^[A-Z]+\d+$/.test(up)) return up;
  return up.charAt(0) + up.slice(1).toLowerCase();
}

export function titleCase(name: string): string {
  return name
    .split(" ")
    .map((word) => word.split("-").map(titleWord).join("-"))
    .join(" ");
}

/** Merge key: case, spacing and punctuation insensitive ("USJ7" == "USJ 7"). */
export function nameKey(name: string): string {
  return stripSponsor(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A stop name as riders should read it. Rail and KTM names are title-cased
 * without their sponsor suffix; bus names are already in display case.
 */
export function displayStopName(feed: FeedId, raw: string): string {
  if (feed === "rail" || feed === "ktm") return titleCase(stripSponsor(raw.trim()));
  return raw.trim();
}
