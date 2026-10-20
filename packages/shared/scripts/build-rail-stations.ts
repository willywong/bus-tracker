/**
 * Builds packages/shared/src/data/rail-stations.ts from a Prasarana
 * `rapid-rail-kl` GTFS static zip: one entry per physical station, with every
 * LRT / MRT / Monorail / BRT line that serves it and the line's colours.
 * Emitted as a TS module (not JSON) for the same Edge-Runtime reason as
 * traffic-signals.ts.
 *
 * The feed models interchanges as separate per-line stops with no
 * parent_station, so stops are merged when their normalised names match and
 * they are within MERGE_SAME_NAME_METERS of each other.
 *
 * Rerun when the rail feed changes (new line or station, recoloured line):
 *
 *   curl -L -o /tmp/rapid-rail-kl.zip \
 *     "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"
 *   pnpm -C packages/shared exec tsx scripts/build-rail-stations.ts /tmp/rapid-rail-kl.zip [YYYY-MM-DD]
 *
 * The optional date is when the zip was downloaded; it defaults to a
 * `_YYYYMMDD` stamp in the file name, else today. It only goes in the header.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "../src/utils/gtfs-parser.js";
import { haversineMeters } from "../src/utils/outlier.js";
import type { RailLine, RailMode } from "../src/utils/rail.js";

const FEED_URL =
  "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl";
// Same-name stops of different lines closer than this are one interchange.
// Ampang Park (LRT KJ <-> MRT PY, linked by a walkway) is ~290 m apart in the
// feed, so 250 m would be too tight; requiring a name match keeps this safe.
const MERGE_SAME_NAME_METERS = 400;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../src/data/rail-stations.ts");

// Fallback line colours, used only when a route has no route_color. Values are
// Rapid KL's published line colours as carried by the rapid-rail-kl feed
// (routes.txt, 2026-07-22); keyed by the official station-code prefix.
const OFFICIAL_LINE_COLORS: Record<string, { color: string; textColor: string }> = {
  AG: { color: "#E57200", textColor: "#FFFFFF" },
  SP: { color: "#76232F", textColor: "#FFFFFF" },
  KJ: { color: "#D50032", textColor: "#FFFFFF" },
  KG: { color: "#047940", textColor: "#FFFFFF" },
  PY: { color: "#FFCD00", textColor: "#000000" },
  MR: { color: "#84BD00", textColor: "#FFFFFF" },
  BRT: { color: "#115740", textColor: "#FFFFFF" },
  SA: { color: "#00A9E0", textColor: "#FFFFFF" },
};
// If the feed's text colour has a WCAG contrast below this against the line
// colour (the feed ships white on MRT Putrajaya yellow, ~1.5:1), use black or
// white, whichever reads better. Official white-on-colour badges (Ampang
// orange, Monorail green, Shah Alam blue) are all above it and kept.
const MIN_TEXT_CONTRAST = 2;

const MODE_BY_CATEGORY: Record<string, RailMode> = {
  LRT: "LRT",
  MRT: "MRT",
  MRL: "Monorail",
  MR: "Monorail",
  BRT: "BRT",
};
const MODE_ORDER: RailMode[] = ["LRT", "MRT", "Monorail", "BRT"];

// Naming-rights suffixes dropped from display names ("KL SENTRAL - REDONE").
const SPONSOR_SUFFIXES = new Set([
  "UOB",
  "REDONE",
  "BANK RAKYAT",
  "CBP COOPBANK PERTAMA",
]);
const UPPERCASE_WORDS = new Set([
  "KL", "KLCC", "PWTC", "USJ", "SS", "IOI", "UPM", "SA", "TTDI", "TRX", "BRT",
  "LRT", "MRT", "UOB",
]);
const SPECIAL_WORDS: Record<string, string> = {
  UITM: "UiTM",
  SUNMED: "SunMed",
};

interface FeedStop {
  stopId: string;
  rawName: string;
  displayName: string;
  key: string;
  lat: number;
  lng: number;
  line: RailLine;
}

function hex(v: string | undefined): string | null {
  const s = (v ?? "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toUpperCase()}` : null;
}

function luminance(color: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function stripSponsor(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s+-\s+(.+)$/.exec(clean);
  if (m && SPONSOR_SUFFIXES.has(m[2].toUpperCase())) return m[1];
  return clean;
}

function titleWord(w: string): string {
  if (w === "") return w;
  const up = w.toUpperCase();
  if (w !== up) return w; // already mixed case in the feed ("SunU")
  if (SPECIAL_WORDS[up]) return SPECIAL_WORDS[up];
  if (UPPERCASE_WORDS.has(up) || /^[A-Z]+\d+$/.test(up)) return up;
  return up.charAt(0) + up.slice(1).toLowerCase();
}

function titleCase(name: string): string {
  return name
    .split(" ")
    .map((word) => word.split("-").map(titleWord).join("-"))
    .join(" ");
}

/** Merge key: case, spacing and punctuation insensitive ("USJ7" == "USJ 7"). */
function nameKey(name: string): string {
  return stripSponsor(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Newest file timestamp inside the zip (from the central directory). */
function newestEntryDate(zip: Uint8Array): string | null {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  let newest = 0;
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const date = dv.getUint16(p + 14, true);
    const name = strFromU8(
      zip.subarray(p + 46, p + 46 + dv.getUint16(p + 28, true)),
    );
    if (!name.startsWith("__MACOSX/") && date > newest) newest = date;
    p +=
      46 +
      dv.getUint16(p + 28, true) +
      dv.getUint16(p + 30, true) +
      dv.getUint16(p + 32, true);
  }
  if (!newest) return null;
  const y = (newest >> 9) + 1980;
  const m = (newest >> 5) & 15;
  const d = newest & 31;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function buildLines(
  routes: Array<Record<string, string>>,
  stops: Array<Record<string, string>>,
  stopRoutes: Map<string, Set<string>>,
): Map<string, RailLine> {
  const lines = new Map<string, RailLine>();
  for (const r of routes) {
    if (r.status && r.status !== "valid") continue;
    const routeId = r.route_id;
    // Official code prefix = the letters most of this line's stop_ids start with.
    const prefixCounts = new Map<string, number>();
    for (const s of stops) {
      if (!stopRoutes.get(s.stop_id)?.has(routeId)) continue;
      const pre = /^[A-Za-z]+/.exec(s.stop_id)?.[0]?.toUpperCase();
      if (pre) prefixCounts.set(pre, (prefixCounts.get(pre) ?? 0) + 1);
    }
    const prefix =
      [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      routeId.toUpperCase();
    const longName = (r.route_long_name || r.route_short_name || routeId).trim();
    const mode =
      MODE_BY_CATEGORY[(r.category ?? "").toUpperCase()] ??
      MODE_BY_CATEGORY[longName.split(" ")[0].toUpperCase()] ??
      (/monorail/i.test(longName) ? "Monorail" : null);
    if (!mode) throw new Error(`route ${routeId}: cannot determine rail mode`);

    const fallback = OFFICIAL_LINE_COLORS[prefix];
    const color = hex(r.route_color) ?? fallback?.color;
    if (!color) throw new Error(`route ${routeId}: no route_color and no fallback`);
    let textColor = hex(r.route_text_color) ?? fallback?.textColor ?? "#FFFFFF";
    if (contrast(color, textColor) < MIN_TEXT_CONTRAST) {
      const better =
        contrast(color, "#000000") >= contrast(color, "#FFFFFF")
          ? "#000000"
          : "#FFFFFF";
      console.warn(
        `· ${prefix}: text ${textColor} on ${color} is ${contrast(color, textColor).toFixed(2)}:1, using ${better}`,
      );
      textColor = better;
    }
    lines.set(routeId, {
      code: prefix === mode.toUpperCase() ? mode : `${mode} ${prefix}`,
      mode,
      name: longName,
      color,
      textColor,
    });
  }
  return lines;
}

function lineSort(a: RailLine, b: RailLine): number {
  return (
    MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
    a.code.localeCompare(b.code)
  );
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function main(): void {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error(
      "usage: tsx scripts/build-rail-stations.ts <rapid-rail-kl.zip> [YYYY-MM-DD]",
    );
    process.exit(2);
  }
  const zip = new Uint8Array(readFileSync(zipPath));
  const files = unzipSync(zip, {
    filter: (f) => !f.name.startsWith("__MACOSX/"),
  });
  const read = (name: string) => {
    const f = files[name];
    if (!f) throw new Error(`${name} missing from ${zipPath}`);
    return parseCsv(strFromU8(f));
  };
  const routes = read("routes.txt");
  const stopsCsv = read("stops.txt");
  const trips = read("trips.txt");
  const stopTimes = read("stop_times.txt");

  const stamp = /(\d{4})(\d{2})(\d{2})/.exec(basename(zipPath));
  const downloaded =
    process.argv[3] ??
    (stamp
      ? `${stamp[1]}-${stamp[2]}-${stamp[3]}`
      : new Date().toISOString().slice(0, 10));
  const feedDate = newestEntryDate(zip) ?? "unknown";

  // stop -> routes, via trips (stop_times.route_id and stops.route_id don't
  // always match routes.route_id in this feed, e.g. "AGL" vs "AG", "MRT").
  const routeIds = new Set(routes.map((r) => r.route_id));
  const tripRoute = new Map(trips.map((t) => [t.trip_id, t.route_id]));
  const stopRoutes = new Map<string, Set<string>>();
  const addStopRoute = (stopId: string, routeId: string | undefined) => {
    if (!routeId || !routeIds.has(routeId)) return;
    let set = stopRoutes.get(stopId);
    if (!set) stopRoutes.set(stopId, (set = new Set()));
    set.add(routeId);
  };
  for (const st of stopTimes) addStopRoute(st.stop_id, tripRoute.get(st.trip_id));
  for (const s of stopsCsv) {
    if (!stopRoutes.has(s.stop_id)) addStopRoute(s.stop_id, s.route_id);
  }

  const lines = buildLines(routes, stopsCsv, stopRoutes);

  const feedStops: FeedStop[] = [];
  for (const s of stopsCsv) {
    if (s.status && s.status !== "valid") continue;
    const lat = Number(s.stop_lat);
    const lng = Number(s.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
      console.warn(`· ${s.stop_id}: bad coordinates, skipping`);
      continue;
    }
    const served = [...(stopRoutes.get(s.stop_id) ?? [])]
      .map((id) => lines.get(id))
      .filter((l): l is RailLine => !!l);
    if (served.length === 0) {
      console.warn(`· ${s.stop_id} ${s.stop_name}: no line, skipping`);
      continue;
    }
    for (const line of served) {
      feedStops.push({
        stopId: s.stop_id,
        rawName: s.stop_name,
        displayName: titleCase(stripSponsor(s.stop_name)),
        key: nameKey(s.stop_name),
        lat,
        lng,
        line,
      });
    }
  }

  // Union-find over same-name stops within the merge distance.
  const parent = feedStops.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < feedStops.length; i++) {
    for (let j = i + 1; j < feedStops.length; j++) {
      const a = feedStops[i];
      const b = feedStops[j];
      if (a.key !== b.key) continue;
      const d = haversineMeters(a, b);
      if (d <= MERGE_SAME_NAME_METERS) parent[find(i)] = find(j);
      else console.warn(`· same name "${a.rawName}" ${a.stopId}/${b.stopId} ${Math.round(d)} m apart, kept separate`);
    }
  }
  const groups = new Map<number, FeedStop[]>();
  feedStops.forEach((s, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), s]);
  });

  interface OutStation {
    id: string;
    name: string;
    lat: number;
    lng: number;
    stopIds: string[];
    lines: RailLine[];
  }
  const stations: OutStation[] = [];
  for (const members of groups.values()) {
    const stationLines = [...new Set(members.map((m) => m.line))].sort(lineSort);
    // Name from the first line's stop (LRT before BRT: "USJ 7" over "USJ7").
    const named = members.find((m) => m.line === stationLines[0]) ?? members[0];
    const uniquePoints = new Map(members.map((m) => [m.stopId, m]));
    const pts = [...uniquePoints.values()];
    stations.push({
      id: slug(named.displayName),
      name: named.displayName,
      lat: round6(pts.reduce((s, p) => s + p.lat, 0) / pts.length),
      lng: round6(pts.reduce((s, p) => s + p.lng, 0) / pts.length),
      stopIds: [...uniquePoints.keys()].sort(),
      lines: stationLines,
    });
  }
  stations.sort((a, b) => a.name.localeCompare(b.name) || a.lat - b.lat);
  const seenIds = new Map<string, number>();
  for (const s of stations) {
    const n = seenIds.get(s.id) ?? 0;
    seenIds.set(s.id, n + 1);
    if (n > 0) s.id = `${s.id}-${n + 1}`;
  }

  // Review aids: remaining " - " names, and different-name stations very close.
  for (const s of stations) {
    if (s.name.includes(" - ")) console.log(`· kept hyphenated name: ${s.name}`);
  }
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const d = haversineMeters(stations[i], stations[j]);
      if (d < 300) {
        console.log(
          `· nearby but separate: ${stations[i].name} / ${stations[j].name} (${Math.round(d)} m)`,
        );
      }
    }
  }

  // Serialise: each line once as a const, stations reference it.
  const sortedLines = [...new Set(lines.values())].sort(lineSort);
  const constName = new Map(
    sortedLines.map((l) => [l, `L_${l.code.split(" ").pop()!.toUpperCase()}`]),
  );
  const out: string[] = [
    "// Generated by packages/shared/scripts/build-rail-stations.ts. Do not edit by hand.",
    `// Source: Prasarana rapid-rail-kl GTFS static (${FEED_URL}),`,
    `// newest file in feed dated ${feedDate}, downloaded ${downloaded}. Open data, data.gov.my.`,
    "// Regenerate: pnpm -C packages/shared exec tsx scripts/build-rail-stations.ts <rapid-rail-kl.zip>",
    `// ${stations.length} stations, ${sortedLines.length} lines. Interchanges merged by name within ${MERGE_SAME_NAME_METERS} m;`,
    "// lat/lng is the mean of the merged per-line stops.",
    'import type { RailLine, RailStation } from "../utils/rail.js";',
    "",
  ];
  for (const l of sortedLines) {
    out.push(`const ${constName.get(l)}: RailLine = ${JSON.stringify(l)};`);
  }
  out.push(
    "",
    `export const RAIL_LINES: readonly RailLine[] = [${sortedLines.map((l) => constName.get(l)).join(", ")}];`,
    "",
    "export const RAIL_STATIONS: readonly RailStation[] = [",
  );
  for (const s of stations) {
    out.push(
      `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, lat: ${s.lat}, lng: ${s.lng}, stopIds: ${JSON.stringify(s.stopIds)}, lines: [${s.lines.map((l) => constName.get(l)).join(", ")}] },`,
    );
  }
  out.push("];", "");
  const body = out.join("\n");
  writeFileSync(OUTPUT_PATH, body, "utf8");

  const interchanges = stations.filter((s) => s.lines.length > 1);
  console.log(
    `\n✓ wrote ${stations.length} stations (${interchanges.length} interchanges) on ${sortedLines.length} lines → ${OUTPUT_PATH}`,
  );
  for (const l of sortedLines) {
    console.log(`  ${l.code.padEnd(12)} ${l.color} on ${l.textColor}  ${l.name}`);
  }
  console.log(`  payload size: ~${Math.round(body.length / 1024)} KB`);
}

main();
