/**
 * Prototype (plan 12/00): size the whole-network routing data for one
 * service date from the four captured GTFS zips.
 *
 *   pnpm -C packages/shared exec tsx scripts/network-sizing.ts <dir> <YYYYMMDD>
 *
 * Counts per feed: stops, patterns (route|direction|stop sequence), trips
 * with every frequency window expanded, stop events, and the same after the
 * spec §3.3 headway rule (every rail window, and bus windows ≤ 720 s, stay
 * turn-up-and-go windows instead of trips). Throwaway: not production code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGtfsZip, type ParsedGtfs } from "../src/utils/gtfs-parser.js";
import { gtfsTimeToSeconds } from "../src/utils/gtfs-time.js";

const FEEDS = [
  { id: "rail", file: "rapid-rail-kl.zip", rail: true },
  { id: "bus-kl", file: "rapid-bus-kl.zip", rail: false },
  { id: "feeder", file: "rapid-bus-mrtfeeder.zip", rail: false },
  { id: "ktmb", file: "ktmb.zip", rail: true },
] as const;

const BUS_HEADWAY_CUTOFF_SEC = 720;
const KTM_KOMUTER_LINES = new Set(["Seremban Line", "Port Klang Line"]);
const KV_BBOX = { minLat: 2.7, maxLat: 3.45, minLon: 101.25, maxLon: 101.95 };
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface FeedSize {
  feed: string;
  stops: number;
  patterns: number;
  patternStopSlots: number;
  tripsExpanded: number;
  stopEventsExpanded: number;
  freqWindows: number;
  turnUpAndGoWindows: number;
  railWindowsOver720: number;
  tripsAfterRule: number;
  stopEventsAfterRule: number;
  headwayMinMedMax: [number, number, number] | null;
}

/** Service ids running on `ymd`: calendar weekday + range, then calendar_dates add/remove. */
export function activeServiceIds(p: ParsedGtfs, ymd: string): Set<string> {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const active = new Set<string>();
  for (const c of p.calendar) {
    if (c[dow] && c.start_date <= ymd && c.end_date >= ymd) active.add(c.service_id);
  }
  for (const x of p.calendarDates) {
    if (x.date !== ymd) continue;
    if (x.exception_type === 2) active.delete(x.service_id);
    else active.add(x.service_id);
  }
  return active;
}

/** Departures a window implies, inclusive end (same as expandFrequencies). */
function windowRuns(start: number, end: number, headway: number): number {
  return end < start ? 0 : Math.floor((end - start) / headway) + 1;
}

export function sizeFeed(
  feed: string,
  p: ParsedGtfs,
  ymd: string,
  opts: { rail: boolean; keepStop?: (id: string) => boolean; keepRoute?: (id: string) => boolean },
): FeedSize {
  const active = activeServiceIds(p, ymd);
  const trips = p.trips.filter(
    (t) => active.has(t.service_id) && (!opts.keepRoute || opts.keepRoute(t.route_id)),
  );
  const tripIds = new Set(trips.map((t) => t.trip_id));
  const seqByTrip = new Map<string, Array<[number, string]>>();
  for (const st of p.stopTimes) {
    if (!tripIds.has(st.trip_id)) continue;
    if (opts.keepStop && !opts.keepStop(st.stop_id)) continue;
    let a = seqByTrip.get(st.trip_id);
    if (!a) seqByTrip.set(st.trip_id, (a = []));
    a.push([st.stop_sequence, st.stop_id]);
  }
  const windowsByTrip = new Map<string, Array<[number, number, number]>>();
  for (const f of p.frequencies) {
    const s = gtfsTimeToSeconds(f.start_time);
    const e = gtfsTimeToSeconds(f.end_time);
    if (s == null || e == null) continue;
    let a = windowsByTrip.get(f.trip_id);
    if (!a) windowsByTrip.set(f.trip_id, (a = []));
    a.push([s, e, f.headway_secs]);
  }

  const patterns = new Map<string, number>();
  const usedStops = new Set<string>();
  const headways: number[] = [];
  const out: FeedSize = {
    feed,
    stops: 0,
    patterns: 0,
    patternStopSlots: 0,
    tripsExpanded: 0,
    stopEventsExpanded: 0,
    freqWindows: 0,
    turnUpAndGoWindows: 0,
    railWindowsOver720: 0,
    tripsAfterRule: 0,
    stopEventsAfterRule: 0,
    headwayMinMedMax: null,
  };
  for (const t of trips) {
    const seq = seqByTrip.get(t.trip_id);
    if (!seq || seq.length < 2) continue;
    seq.sort((a, b) => a[0] - b[0]);
    const ids = seq.map(([, id]) => id);
    for (const id of ids) usedStops.add(id);
    const key = `${t.route_id}|${t.direction_id ?? ""}|${ids.join(",")}`;
    if (!patterns.has(key)) patterns.set(key, ids.length);
    const windows = windowsByTrip.get(t.trip_id);
    if (!windows) {
      out.tripsExpanded += 1;
      out.stopEventsExpanded += ids.length;
      out.tripsAfterRule += 1;
      out.stopEventsAfterRule += ids.length;
      continue;
    }
    for (const [s, e, h] of windows) {
      const runs = windowRuns(s, e, h);
      headways.push(h);
      out.freqWindows += 1;
      out.tripsExpanded += runs;
      out.stopEventsExpanded += runs * ids.length;
      if (opts.rail && h > BUS_HEADWAY_CUTOFF_SEC) out.railWindowsOver720 += 1;
      if (opts.rail || h <= BUS_HEADWAY_CUTOFF_SEC) {
        out.turnUpAndGoWindows += 1;
      } else {
        out.tripsAfterRule += runs;
        out.stopEventsAfterRule += runs * ids.length;
      }
    }
  }
  out.stops = usedStops.size;
  out.patterns = patterns.size;
  for (const n of patterns.values()) out.patternStopSlots += n;
  if (headways.length > 0) {
    headways.sort((a, b) => a - b);
    out.headwayMinMedMax = [headways[0], headways[headways.length >> 1], headways[headways.length - 1]];
  }
  return out;
}

/**
 * Rough size of the typed arrays (spec §3.3): arr + dep per stop event,
 * stop slots + runOffset per pattern stop, 3 ints per frequency window,
 * ~8 ints per pattern, and per stop 2 float32 + int32 + u8.
 */
export function estimateInt32Bytes(sizes: readonly FeedSize[]): number {
  let bytes = 0;
  for (const s of sizes) {
    bytes += 4 * 2 * s.stopEventsAfterRule;
    bytes += 4 * 2 * s.patternStopSlots;
    bytes += 4 * 3 * s.turnUpAndGoWindows;
    bytes += 4 * 8 * s.patterns;
    bytes += s.stops * (4 + 4 + 4 + 1);
  }
  return bytes;
}

function inKv(lat: number, lon: number): boolean {
  return lat >= KV_BBOX.minLat && lat <= KV_BBOX.maxLat && lon >= KV_BBOX.minLon && lon <= KV_BBOX.maxLon;
}

function table(rows: readonly FeedSize[]): string {
  const head = "feed            stops  patterns  trips(exp)  events(exp)  windows  tug  rail>720  trips(rule)  events(rule)  headway min/med/max";
  const lines = rows.map((r) =>
    [
      r.feed.padEnd(14),
      String(r.stops).padStart(6),
      String(r.patterns).padStart(9),
      String(r.tripsExpanded).padStart(11),
      String(r.stopEventsExpanded).padStart(12),
      String(r.freqWindows).padStart(8),
      String(r.turnUpAndGoWindows).padStart(4),
      String(r.railWindowsOver720).padStart(9),
      String(r.tripsAfterRule).padStart(12),
      String(r.stopEventsAfterRule).padStart(13),
      "  " + (r.headwayMinMedMax ? r.headwayMinMedMax.join("/") : "-"),
    ].join(" "),
  );
  return [head, ...lines].join("\n");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [dir, ymd] = process.argv.slice(2);
  if (!dir || !/^\d{8}$/.test(ymd ?? "")) {
    console.error("usage: tsx scripts/network-sizing.ts <fixture dir> <YYYYMMDD>");
    process.exit(1);
  }
  const all: FeedSize[] = [];
  let ktmKv: FeedSize | null = null;
  for (const f of FEEDS) {
    const t0 = performance.now();
    const p = parseGtfsZip(readFileSync(join(dir, f.file)));
    const parseMs = performance.now() - t0;
    all.push(sizeFeed(f.id, p, ymd, { rail: f.rail }));
    console.error(`${f.id}: parsed in ${parseMs.toFixed(0)} ms (Node)`);
    if (f.id === "ktmb") {
      const komuter = new Set(
        p.routes.filter((r) => KTM_KOMUTER_LINES.has(r.route_short_name)).map((r) => String(r.route_id)),
      );
      const kvStops = new Set(p.stops.filter((s) => inKv(s.stop_lat, s.stop_lon)).map((s) => s.stop_id));
      ktmKv = sizeFeed("ktm-komuter-kv", p, ymd, {
        rail: true,
        keepRoute: (id) => komuter.has(id),
        keepStop: (id) => kvStops.has(id),
      });
      console.error(
        `ktmb routes: ${p.routes.map((r) => `${r.route_id}=${r.route_short_name}`).join(", ")}`,
      );
    }
  }
  const total = all.reduce<FeedSize>(
    (acc, r) => ({
      ...acc,
      stops: acc.stops + r.stops,
      patterns: acc.patterns + r.patterns,
      patternStopSlots: acc.patternStopSlots + r.patternStopSlots,
      tripsExpanded: acc.tripsExpanded + r.tripsExpanded,
      stopEventsExpanded: acc.stopEventsExpanded + r.stopEventsExpanded,
      freqWindows: acc.freqWindows + r.freqWindows,
      turnUpAndGoWindows: acc.turnUpAndGoWindows + r.turnUpAndGoWindows,
      railWindowsOver720: acc.railWindowsOver720 + r.railWindowsOver720,
      tripsAfterRule: acc.tripsAfterRule + r.tripsAfterRule,
      stopEventsAfterRule: acc.stopEventsAfterRule + r.stopEventsAfterRule,
    }),
    { ...all[0], feed: "TOTAL", stops: 0, patterns: 0, patternStopSlots: 0, tripsExpanded: 0, stopEventsExpanded: 0, freqWindows: 0, turnUpAndGoWindows: 0, railWindowsOver720: 0, tripsAfterRule: 0, stopEventsAfterRule: 0, headwayMinMedMax: null },
  );
  const routed = all.filter((r) => r.feed !== "ktmb").concat(ktmKv ? [ktmKv] : []);
  console.log(`Service date ${ymd}\n`);
  console.log(table([...all, total, ...(ktmKv ? [ktmKv] : [])]));
  console.log(
    `\nEstimated typed arrays (rail + bus-kl + feeder + KTM Komuter in KV, after rule): ${(estimateInt32Bytes(routed) / 1e6).toFixed(2)} MB`,
  );
}
