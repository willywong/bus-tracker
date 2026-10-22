/**
 * Prototype (plan 12/00 step 4): time a whole-network build — unzip, parse,
 * group trips into patterns, fill typed arrays — the way the app would do it
 * on the JS thread. Throwaway: not production code. The dev screen
 * `apps/mobile/app/dev-network.tsx` runs it on a device; `run-network-bench.ts` runs it in Node.
 *
 * Two passes over the same four zips:
 *  - sync: `parseGtfsZip` per feed, then the compile, without yielding;
 *  - sliced: streaming unzip + column scan + compile as one generator that
 *    yields every 16 KB / 64 KB / 2,048 rows, for `runInSlices`.
 */
import { Unzip, UnzipInflate } from "fflate";
import type { GtfsCalendar, GtfsCalendarDate } from "../src/types/gtfs.js";
import { parseGtfsZip, scanCsvColumnsSteps } from "../src/utils/gtfs-parser.js";
import { gtfsTimeToSeconds } from "../src/utils/gtfs-time.js";

export interface BenchFeed {
  id: string;
  file: string;
  rail: boolean;
  /** route_short_names to keep; all routes when absent. */
  keepRoutes?: ReadonlySet<string>;
}

export const BENCH_FEEDS: readonly BenchFeed[] = [
  { id: "rail", file: "rapid-rail-kl.zip", rail: true },
  { id: "bus-kl", file: "rapid-bus-kl.zip", rail: false },
  { id: "feeder", file: "rapid-bus-mrtfeeder.zip", rail: false },
  { id: "ktmb", file: "ktmb.zip", rail: true, keepRoutes: new Set(["Seremban Line", "Port Klang Line"]) },
];

const BUS_HEADWAY_CUTOFF_SEC = 720;
const ROWS_PER_STEP = 2048;
const UNZIP_STEP_BYTES = 16 * 1024;
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const FILES = new Set([
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "frequencies.txt",
  "calendar.txt",
  "calendar_dates.txt",
]);

/** The columns the compile reads, as both passes produce them. */
interface FeedSource {
  routes: Array<{ route_id: string; route_short_name: string }>;
  stops: Array<{ stop_id: string; stop_lat: number; stop_lon: number }>;
  trips: Array<{ trip_id: string; route_id: string; service_id: string; direction_id?: number }>;
  stopTimes: Array<{ trip_id: string; stop_id: string; stop_sequence: number; arrival_time?: string; departure_time?: string }>;
  frequencies: Array<{ trip_id: string; start_time: string; end_time: string; headway_secs: number }>;
  calendar: GtfsCalendar[];
  calendarDates: GtfsCalendarDate[];
}

export interface SpikeNetwork {
  stops: number;
  patterns: number;
  trips: number;
  events: number;
  windows: number;
  bytes: number;
}

export interface Timings {
  /** Stage name → ms. In the sliced pass these are wall times, gaps included. */
  stages: Array<[string, number]>;
  net: SpikeNetwork | null;
}

const now = () => performance.now();

function activeServiceIds(src: FeedSource, ymd: string): Set<string> {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const active = new Set<string>();
  for (const c of src.calendar) {
    if (c[dow] && c.start_date <= ymd && c.end_date >= ymd) active.add(c.service_id);
  }
  for (const x of src.calendarDates) {
    if (x.date !== ymd) continue;
    if (x.exception_type === 2) active.delete(x.service_id);
    else active.add(x.service_id);
  }
  return active;
}

interface PatternBuild {
  stops: number[];
  /** Per trip: arrival then departure times, one pair per stop. */
  trips: Int32Array[];
  /** [start, end, headway] per turn-up-and-go window, plus the template's offsets. */
  windows: Array<[number, number, number, Int32Array]>;
}

/**
 * Groups every feed's trips for `ymd` into patterns and fills the network's
 * typed arrays (spec §3.3 shape), yielding every 2,048 rows.
 */
function* compileSteps(
  feeds: ReadonlyArray<{ feed: BenchFeed; src: FeedSource }>,
  ymd: string,
): Generator<void, SpikeNetwork, void> {
  const stopIndex = new Map<string, number>();
  const stopLat: number[] = [];
  const stopLon: number[] = [];
  const patterns = new Map<string, PatternBuild>();
  let rows = 0;
  const tick = () => ++rows % ROWS_PER_STEP === 0;

  for (const { feed, src } of feeds) {
    const ns = `${feed.id}:`;
    for (const s of src.stops) {
      if (tick()) yield;
      if (stopIndex.has(ns + s.stop_id)) continue;
      stopIndex.set(ns + s.stop_id, stopLat.length);
      stopLat.push(s.stop_lat);
      stopLon.push(s.stop_lon);
    }
    const keepRoute = feed.keepRoutes
      ? new Set(src.routes.filter((r) => feed.keepRoutes!.has(r.route_short_name)).map((r) => r.route_id))
      : null;
    const active = activeServiceIds(src, ymd);
    const kept = new Map<string, (typeof src.trips)[number]>();
    for (const t of src.trips) {
      if (tick()) yield;
      if (active.has(t.service_id) && (!keepRoute || keepRoute.has(t.route_id))) kept.set(t.trip_id, t);
    }
    // [stop_sequence, stop, arr, dep] flattened per trip.
    const byTrip = new Map<string, number[]>();
    for (const st of src.stopTimes) {
      if (tick()) yield;
      if (!kept.has(st.trip_id)) continue;
      const stop = stopIndex.get(ns + st.stop_id);
      const arr = gtfsTimeToSeconds(st.arrival_time) ?? gtfsTimeToSeconds(st.departure_time);
      const dep = gtfsTimeToSeconds(st.departure_time) ?? arr;
      if (stop === undefined || arr == null || dep == null) continue;
      let a = byTrip.get(st.trip_id);
      if (!a) byTrip.set(st.trip_id, (a = []));
      a.push(st.stop_sequence, stop, arr, dep);
    }
    const windowsByTrip = new Map<string, Array<[number, number, number]>>();
    for (const f of src.frequencies) {
      const s = gtfsTimeToSeconds(f.start_time);
      const e = gtfsTimeToSeconds(f.end_time);
      if (s == null || e == null || f.headway_secs <= 0) continue;
      let a = windowsByTrip.get(f.trip_id);
      if (!a) windowsByTrip.set(f.trip_id, (a = []));
      a.push([s, e, f.headway_secs]);
    }
    for (const [tripId, flat] of byTrip) {
      if (tick()) yield;
      const n = flat.length / 4;
      if (n < 2) continue;
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => flat[a * 4] - flat[b * 4]);
      const stops = order.map((i) => flat[i * 4 + 1]);
      const times = new Int32Array(n * 2);
      order.forEach((i, k) => {
        times[k * 2] = flat[i * 4 + 2];
        times[k * 2 + 1] = flat[i * 4 + 3];
      });
      const t = kept.get(tripId)!;
      const key = `${feed.id}|${t.route_id}|${t.direction_id ?? ""}|${stops.join(",")}`;
      let p = patterns.get(key);
      if (!p) patterns.set(key, (p = { stops, trips: [], windows: [] }));
      const windows = windowsByTrip.get(tripId);
      if (!windows) {
        p.trips.push(times);
        continue;
      }
      const first = times[1];
      const offsets = times.map((x) => x - first);
      for (const [s, e, h] of windows) {
        if (feed.rail || h <= BUS_HEADWAY_CUTOFF_SEC) {
          p.windows.push([s, e, h, offsets]);
          continue;
        }
        for (let start = s; start <= e; start += h) p.trips.push(offsets.map((x) => x + start));
      }
    }
  }

  // Flatten: patterns → stop slots, trips sorted by first departure → arr/dep.
  const list = [...patterns.values()];
  let slots = 0;
  let events = 0;
  let windowCount = 0;
  for (const p of list) {
    slots += p.stops.length;
    events += p.trips.length * p.stops.length;
    windowCount += p.windows.length;
  }
  const patternStopStart = new Int32Array(list.length + 1);
  const patternStops = new Int32Array(slots);
  const timeStart = new Int32Array(list.length + 1);
  const tripCount = new Int32Array(list.length);
  const arr = new Int32Array(events);
  const dep = new Int32Array(events);
  const freq = new Int32Array(windowCount * 4);
  const runOffset = new Int32Array(slots);
  let slot = 0;
  let ev = 0;
  let w = 0;
  let trips = 0;
  list.forEach((p, pi) => {
    patternStopStart[pi] = slot;
    timeStart[pi] = ev;
    tripCount[pi] = p.trips.length;
    trips += p.trips.length;
    p.trips.sort((a, b) => a[1] - b[1]);
    const len = p.stops.length;
    for (let s = 0; s < len; s++) {
      patternStops[slot + s] = p.stops[s];
      if (p.windows.length > 0) runOffset[slot + s] = p.windows[0][3][s * 2 + 1];
    }
    // Event-major as in spec: arr[timeStart[p] + t*len + s].
    for (const times of p.trips) {
      for (let s = 0; s < len; s++) {
        arr[ev] = times[s * 2];
        dep[ev] = times[s * 2 + 1];
        ev++;
      }
    }
    for (const [s, e, h] of p.windows) {
      freq[w++] = pi;
      freq[w++] = s;
      freq[w++] = e;
      freq[w++] = h;
    }
    slot += len;
  });
  yield;
  patternStopStart[list.length] = slot;
  timeStart[list.length] = ev;
  const lat = Float32Array.from(stopLat);
  const lon = Float32Array.from(stopLon);
  const bytes = [patternStopStart, patternStops, timeStart, tripCount, arr, dep, freq, runOffset, lat, lon].reduce(
    (n, a) => n + a.byteLength,
    0,
  );
  return { stops: stopLat.length, patterns: list.length, trips, events, windows: windowCount, bytes };
}

function fromParsed(zip: Uint8Array): FeedSource {
  const p = parseGtfsZip(zip);
  return {
    routes: p.routes.map((r) => ({ route_id: String(r.route_id), route_short_name: r.route_short_name })),
    stops: p.stops,
    trips: p.trips,
    stopTimes: p.stopTimes,
    frequencies: p.frequencies,
    calendar: p.calendar,
    calendarDates: p.calendarDates,
  };
}

/** Sync pass: `parseGtfsZip` then the compile, nothing yields. */
export function runSyncPass(zips: ReadonlyArray<{ feed: BenchFeed; zip: Uint8Array }>, ymd: string): Timings {
  const stages: Array<[string, number]> = [];
  const feeds: Array<{ feed: BenchFeed; src: FeedSource }> = [];
  for (const { feed, zip } of zips) {
    const t0 = now();
    feeds.push({ feed, src: fromParsed(zip) });
    stages.push([`parse ${feed.id}`, now() - t0]);
  }
  const t0 = now();
  const steps = compileSteps(feeds, ymd);
  let r = steps.next();
  while (!r.done) r = steps.next();
  stages.push(["compile", now() - t0]);
  return { stages, net: r.value };
}

/** Sliced pass as one generator: streaming unzip, column scans, compile. */
export function* slicedPassSteps(
  zips: ReadonlyArray<{ feed: BenchFeed; zip: Uint8Array }>,
  ymd: string,
  stages: Array<[string, number]>,
): Generator<void, SpikeNetwork, void> {
  const feeds: Array<{ feed: BenchFeed; src: FeedSource }> = [];
  for (const { feed, zip } of zips) {
    const t0 = now();
    feeds.push({ feed, src: yield* readFeedSteps(zip) });
    stages.push([`read ${feed.id}`, now() - t0]);
  }
  const t0 = now();
  const net = yield* compileSteps(feeds, ymd);
  stages.push(["compile", now() - t0]);
  return net;
}

function* readFeedSteps(zip: Uint8Array): Generator<void, FeedSource, void> {
  const files = yield* unzipSteps(zip, FILES);
  const scan = (name: string, columns: readonly string[], onRow: (row: string[], col: readonly number[]) => void) =>
    scanCsvColumnsSteps(files.get(name) ?? [], columns, onRow);
  const c = (row: string[], i: number) => (i < 0 ? "" : (row[i] ?? "").trim());
  const src: FeedSource = {
    routes: [],
    stops: [],
    trips: [],
    stopTimes: [],
    frequencies: [],
    calendar: [],
    calendarDates: [],
  };
  yield* scan("routes.txt", ["route_id", "route_short_name"], (r, [id, s]) => {
    src.routes.push({ route_id: c(r, id), route_short_name: c(r, s) });
  });
  yield* scan("stops.txt", ["stop_id", "stop_lat", "stop_lon"], (r, [id, la, lo]) => {
    src.stops.push({ stop_id: c(r, id), stop_lat: Number(c(r, la)), stop_lon: Number(c(r, lo)) });
  });
  yield* scan("trips.txt", ["trip_id", "route_id", "service_id", "direction_id"], (r, [id, route, svc, dir]) => {
    const d = c(r, dir);
    src.trips.push({ trip_id: c(r, id), route_id: c(r, route), service_id: c(r, svc), direction_id: d === "" ? undefined : Number(d) });
  });
  yield* scan(
    "stop_times.txt",
    ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
    (r, [t, s, q, a, d]) => {
      src.stopTimes.push({
        trip_id: c(r, t),
        stop_id: c(r, s),
        stop_sequence: Number(c(r, q)) || 0,
        arrival_time: c(r, a) || undefined,
        departure_time: c(r, d) || undefined,
      });
    },
  );
  yield* scan("frequencies.txt", ["trip_id", "start_time", "end_time", "headway_secs"], (r, [t, s, e, h]) => {
    src.frequencies.push({ trip_id: c(r, t), start_time: c(r, s), end_time: c(r, e), headway_secs: Number(c(r, h)) });
  });
  const days = ["service_id", ...DOW, "start_date", "end_date"];
  yield* scan("calendar.txt", days, (r, col) => {
    const cal = { service_id: c(r, col[0]), start_date: c(r, col[8]), end_date: c(r, col[9]) } as GtfsCalendar;
    DOW.forEach((day, i) => {
      cal[day] = c(r, col[i + 1]) === "1";
    });
    src.calendar.push(cal);
  });
  yield* scan("calendar_dates.txt", ["service_id", "date", "exception_type"], (r, [s, d, e]) => {
    src.calendarDates.push({ service_id: c(r, s), date: c(r, d), exception_type: Number(c(r, e)) === 2 ? 2 : 1 });
  });
  return src;
}

/** Copy of the private `unzipSteps` in utils/search-routes.ts. */
function* unzipSteps(zip: Uint8Array, names: ReadonlySet<string>): Generator<void, Map<string, Uint8Array[]>, void> {
  const files = new Map<string, Uint8Array[]>();
  const unzip = new Unzip((file) => {
    if (!names.has(file.name)) return;
    const chunks: Uint8Array[] = [];
    files.set(file.name, chunks);
    file.ondata = (err, data) => {
      if (err) throw err;
      if (data.length > 0) chunks.push(data);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < zip.length; i += UNZIP_STEP_BYTES) {
    unzip.push(zip.subarray(i, i + UNZIP_STEP_BYTES), i + UNZIP_STEP_BYTES >= zip.length);
    yield;
  }
  return files;
}

export interface SliceStats {
  wallMs: number;
  busyMs: number;
  longestSliceMs: number;
  slices: number;
}

/**
 * Copy of the private `runInSlices` in utils/search-routes.ts, measuring
 * each slice. Pauses for a macrotask whenever a slice has run `sliceMs`.
 */
export async function runInSlicesMeasured<T>(
  steps: Generator<void, T, void>,
  sliceMs: number,
): Promise<{ value: T; stats: SliceStats }> {
  const t0 = now();
  const stats: SliceStats = { wallMs: 0, busyMs: 0, longestSliceMs: 0, slices: 0 };
  let sliceStart = now();
  const close = () => {
    const d = now() - sliceStart;
    stats.busyMs += d;
    stats.slices++;
    if (d > stats.longestSliceMs) stats.longestSliceMs = d;
  };
  for (;;) {
    const step = steps.next();
    if (step.done) {
      close();
      stats.wallMs = now() - t0;
      return { value: step.value, stats };
    }
    if (now() - sliceStart >= sliceMs) {
      close();
      await new Promise((r) => setTimeout(r, 0));
      sliceStart = now();
    }
  }
}

export function formatTimings(title: string, t: Timings): string {
  const lines = [title];
  for (const [name, ms] of t.stages) lines.push(`  ${name.padEnd(14)} ${ms.toFixed(0).padStart(6)} ms`);
  const total = t.stages.reduce((n, [, ms]) => n + ms, 0);
  lines.push(`  ${"total".padEnd(14)} ${total.toFixed(0).padStart(6)} ms`);
  if (t.net) {
    const n = t.net;
    lines.push(
      `  net: ${n.stops} stops, ${n.patterns} patterns, ${n.trips} trips, ${n.events} events, ${n.windows} windows, ${(n.bytes / 1e6).toFixed(2)} MB`,
    );
  }
  return lines.join("\n");
}
