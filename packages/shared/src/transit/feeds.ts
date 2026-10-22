import { RAIL_LINES } from "../data/rail-stations.js";
import type {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsFrequency,
  GtfsRoute,
  GtfsShapePoint,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
} from "../types/gtfs.js";
import { namespaceParsedGtfs, routeCodeOf } from "../utils/categories.js";
import { scanCsvColumnsSteps, type ParsedGtfs } from "../utils/gtfs-parser.js";
import { drain, unzipSteps } from "../utils/steps.js";
import { displayStopName } from "./names.js";
import { FEED_INFO, namespaceFeedId, RAIL_MODE_TO_MODE, type FeedId, type Mode } from "./network.js";

export interface RouteMeta {
  /** Short badge text: "T816", "KJ", "KTM Seremban". */
  label: string;
  longName: string;
  mode: Mode;
  /** '#RRGGBB'. Buses stay ink (#000000); rail and KTM carry the line colour. */
  color: string;
  textColor: string;
}

/** One feed zip, read and cleaned up for the network compiler. */
export interface NormalisedFeed {
  feed: FeedId;
  parsed: ParsedGtfs;                 // ids namespaced; stops filtered (ktm); shapes empty unless asked
  routeMeta: Map<string, RouteMeta>;  // by namespaced route_id
  stopNames: Map<string, string>;     // namespaced stop_id → display name
  validFrom: string; validUntil: string; // 'YYYYMMDD': min start_date / max(end_date, added calendar_dates)
}

export interface ReadFeedOptions {
  /** Also read shapes.txt (with {@link fixShapePoint} applied). Off by default. */
  shapes?: boolean;
}

const FEED_FILES = [
  "routes.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
];

/** Spec §3.1: KTM is cut to the Komuter lines inside the Klang Valley. */
const KLANG_VALLEY = { minLat: 2.7, maxLat: 3.45, minLon: 101.25, maxLon: 101.95 };
/** KTMB `route_short_name` of each Komuter line kept, and its badge label. */
const KTM_LINES: Record<string, string> = {
  "Seremban Line": "KTM Seremban",
  "Port Klang Line": "KTM Port Klang",
};
const KTM_DEFAULT_COLOR = "#3C5A9F";

/** A trimmed field, or "" when the column is missing. */
function cell(row: string[], i: number): string {
  return i < 0 ? "" : (row[i] ?? "").trim();
}

function num(s: string): number {
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Puts a shape point's coordinates the right way round. Some feeds have
 * shipped lon under the lat header; a Klang Valley longitude (~101) can never
 * be a latitude, so anything past 90 is swapped back.
 */
export function fixShapePoint(p: GtfsShapePoint): GtfsShapePoint {
  if (Math.abs(p.shape_pt_lat) <= 90) return p;
  return { ...p, shape_pt_lat: p.shape_pt_lon, shape_pt_lon: p.shape_pt_lat };
}

/**
 * Reads one feed zip into a {@link NormalisedFeed}, as a generator that
 * yields every few ms (drive it with `runSteps`). Only the files the network
 * needs are inflated, and each is scanned in 64 KB steps. Trips without
 * stop_times are dropped; KTM is cut to the Komuter lines inside the Klang
 * Valley; ids are namespaced for `feed` (the feeder's stay raw).
 */
export function* readFeedSteps(
  zip: Uint8Array,
  feed: FeedId,
  opts: ReadFeedOptions = {},
): Generator<void, NormalisedFeed, void> {
  const names = new Set(FEED_FILES);
  if (opts.shapes) names.add("shapes.txt");
  const files = yield* unzipSteps(zip, names);
  const scan = (
    name: string,
    columns: readonly string[],
    onRow: (row: string[], col: readonly number[]) => void,
  ) => {
    const chunks = files.get(name) ?? [];
    files.delete(name);
    return scanCsvColumnsSteps(drain(chunks), columns, onRow);
  };

  // Row objects as parseGtfsZip builds them, so the existing helpers
  // (expandFrequencies, namespaceParsedGtfs, …) take them as they are.
  let routes: GtfsRoute[] = [];
  yield* scan(
    "routes.txt",
    ["route_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
    (r, [id, short, long, type, color, text]) => {
      const routeType = cell(r, type);
      routes.push({
        route_id: cell(r, id),
        route_short_name: cell(r, short),
        route_long_name: cell(r, long) || undefined,
        route_type: routeType ? num(routeType) : undefined,
        route_color: cell(r, color) || undefined,
        route_text_color: cell(r, text) || undefined,
      });
    },
  );
  if (feed === "ktm") routes = routes.filter((r) => r.route_short_name in KTM_LINES);
  const routeIds = new Set(routes.map((r) => String(r.route_id)));

  let stops: GtfsStop[] = [];
  yield* scan(
    "stops.txt",
    ["stop_id", "stop_name", "stop_lat", "stop_lon", "wheelchair_boarding", "location_type", "parent_station"],
    (r, [id, name, lat, lon, wheel, loc, parent]) => {
      const w = cell(r, wheel);
      const locationType = cell(r, loc);
      stops.push({
        stop_id: cell(r, id),
        stop_name: cell(r, name),
        stop_lat: num(cell(r, lat)),
        stop_lon: num(cell(r, lon)),
        wheelchair_boarding: w === "1" ? 1 : w === "2" ? 2 : w === "0" ? 0 : undefined,
        location_type: locationType ? num(locationType) : undefined,
        parent_station: cell(r, parent) || undefined,
      });
    },
  );

  let trips: GtfsTrip[] = [];
  yield* scan(
    "trips.txt",
    ["route_id", "service_id", "trip_id", "shape_id", "direction_id", "trip_headsign"],
    (r, [route, service, id, shape, dir, headsign]) => {
      const routeId = cell(r, route);
      if (feed === "ktm" && !routeIds.has(routeId)) return;
      const d = cell(r, dir);
      trips.push({
        route_id: routeId,
        service_id: cell(r, service),
        trip_id: cell(r, id),
        shape_id: cell(r, shape) || undefined,
        direction_id: d === "1" ? 1 : d === "0" ? 0 : undefined,
        trip_headsign: cell(r, headsign) || undefined,
      });
    },
  );
  const tripIds = new Set(trips.map((t) => t.trip_id));

  let stopTimes: GtfsStopTime[] = [];
  // data.gov.my withholds the stop_times of some trips (~2% of bus-kl); a
  // trip without them can't be routed.
  const timed = new Set<string>();
  yield* scan(
    "stop_times.txt",
    ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
    (r, [trip, stop, seq, arr, dep]) => {
      const tripId = cell(r, trip);
      if (feed === "ktm" && !tripIds.has(tripId)) return;
      timed.add(tripId);
      stopTimes.push({
        trip_id: tripId,
        stop_id: cell(r, stop),
        stop_sequence: num(cell(r, seq)),
        arrival_time: cell(r, arr) || undefined,
        departure_time: cell(r, dep) || undefined,
      });
    },
  );

  const shapes: GtfsShapePoint[] = [];
  if (opts.shapes) {
    yield* scan(
      "shapes.txt",
      ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
      (r, [id, lat, lon, seq]) => {
        shapes.push(
          fixShapePoint({
            shape_id: cell(r, id),
            shape_pt_lat: num(cell(r, lat)),
            shape_pt_lon: num(cell(r, lon)),
            shape_pt_sequence: num(cell(r, seq)),
          }),
        );
      },
    );
  }

  const calendar: GtfsCalendar[] = [];
  yield* scan(
    "calendar.txt",
    ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
    (r, [id, mo, tu, we, th, fr, sa, su, start, end]) => {
      calendar.push({
        service_id: cell(r, id),
        monday: cell(r, mo) === "1",
        tuesday: cell(r, tu) === "1",
        wednesday: cell(r, we) === "1",
        thursday: cell(r, th) === "1",
        friday: cell(r, fr) === "1",
        saturday: cell(r, sa) === "1",
        sunday: cell(r, su) === "1",
        start_date: cell(r, start),
        end_date: cell(r, end),
      });
    },
  );

  const calendarDates: GtfsCalendarDate[] = [];
  yield* scan("calendar_dates.txt", ["service_id", "date", "exception_type"], (r, [id, date, type]) => {
    const t = cell(r, type);
    const serviceId = cell(r, id);
    const d = cell(r, date);
    if ((t !== "1" && t !== "2") || !serviceId || !d) return;
    calendarDates.push({ service_id: serviceId, date: d, exception_type: t === "1" ? 1 : 2 });
  });

  let frequencies: GtfsFrequency[] = [];
  yield* scan(
    "frequencies.txt",
    ["trip_id", "start_time", "end_time", "headway_secs", "exact_times"],
    (r, [id, start, end, headway, exact]) => {
      const tripId = cell(r, id);
      const startTime = cell(r, start);
      const endTime = cell(r, end);
      const h = num(cell(r, headway));
      if (!tripId || !startTime || !endTime || h <= 0) return;
      frequencies.push({
        trip_id: tripId,
        start_time: startTime,
        end_time: endTime,
        headway_secs: h,
        exact_times: cell(r, exact) === "1" ? 1 : 0,
      });
    },
  );

  trips = trips.filter((t) => timed.has(t.trip_id));
  if (feed === "ktm") ({ stops, trips, stopTimes } = cutToKlangValley(stops, trips, stopTimes));
  const keptTrips = new Set(trips.map((t) => t.trip_id));
  frequencies = frequencies.filter((f) => keptTrips.has(f.trip_id));
  yield;

  // Route metadata needs the raw stop ids (rail line prefixes), so it's
  // worked out before namespacing and keyed by the namespaced route_id.
  const routeMeta = new Map<string, RouteMeta>();
  const railPrefix = feed === "rail" ? railPrefixes(routes, stops, trips, stopTimes) : null;
  for (const r of routes) {
    const id = String(r.route_id);
    routeMeta.set(namespaceFeedId(feed, id), routeMetaFor(feed, r, railPrefix?.get(id)));
  }
  const stopNames = new Map<string, string>();
  for (const s of stops) stopNames.set(namespaceFeedId(feed, s.stop_id), displayStopName(feed, s.stop_name));
  const { validFrom, validUntil } = validity(calendar, calendarDates, trips);
  yield;

  const parsed: ParsedGtfs = {
    routes,
    stops,
    trips,
    stopTimes,
    shapes,
    calendar,
    calendarDates,
    fareAttributes: [],
    fareRules: [],
    transfers: [],
    frequencies,
  };
  const category = FEED_INFO[feed].category;
  if (feed === "bus-kl" && category) namespaceParsedGtfs(parsed, category);
  else namespaceParsedFeed(parsed, feed);

  return { feed, parsed, routeMeta, stopNames, validFrom, validUntil };
}

/** Drains {@link readFeedSteps} in one go, for tests and scripts. */
export function readFeed(zip: Uint8Array, feed: FeedId, opts?: ReadFeedOptions): NormalisedFeed {
  const steps = readFeedSteps(zip, feed, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Namespaces every id in `parsed` for a rail or KTM `feed` **in place** and
 * returns it: {@link namespaceParsedGtfs} with the feed prefixes from
 * `FEED_INFO`. No-op for a feed whose ids stay raw (the feeder).
 */
export function namespaceParsedFeed(parsed: ParsedGtfs, feed: FeedId): ParsedGtfs {
  if (!FEED_INFO[feed].idPrefix) return parsed;
  const ns = (id: string) => namespaceFeedId(feed, id);
  const nsOpt = (id: string | undefined) => (id === undefined ? id : ns(id));
  for (const r of parsed.routes) r.route_id = ns(String(r.route_id));
  for (const s of parsed.stops) {
    s.stop_id = ns(s.stop_id);
    s.parent_station = nsOpt(s.parent_station);
  }
  for (const t of parsed.trips) {
    t.route_id = ns(t.route_id);
    t.service_id = ns(t.service_id);
    t.trip_id = ns(t.trip_id);
    t.shape_id = nsOpt(t.shape_id);
  }
  for (const st of parsed.stopTimes) {
    st.trip_id = ns(st.trip_id);
    st.stop_id = ns(st.stop_id);
  }
  for (const p of parsed.shapes) p.shape_id = ns(p.shape_id);
  for (const c of parsed.calendar) c.service_id = ns(c.service_id);
  for (const c of parsed.calendarDates) c.service_id = ns(c.service_id);
  for (const a of parsed.fareAttributes) a.fare_id = ns(a.fare_id);
  for (const r of parsed.fareRules) {
    r.fare_id = ns(r.fare_id);
    r.route_id = nsOpt(r.route_id);
    r.origin_id = nsOpt(r.origin_id);
    r.destination_id = nsOpt(r.destination_id);
    r.contains_id = nsOpt(r.contains_id);
  }
  for (const t of parsed.transfers) {
    t.from_stop_id = ns(t.from_stop_id);
    t.to_stop_id = ns(t.to_stop_id);
  }
  for (const f of parsed.frequencies) f.trip_id = ns(f.trip_id);
  return parsed;
}

function routeMetaFor(feed: FeedId, r: GtfsRoute, railPrefix: string | undefined): RouteMeta {
  const id = String(r.route_id);
  if (feed === "rail") {
    const prefix = railPrefix ?? id.toUpperCase();
    const line = RAIL_LINES.find((l) => l.code === prefix || l.code.endsWith(` ${prefix}`));
    if (!line) throw new Error(`rail route ${id}: unknown line prefix ${prefix}`);
    return {
      label: prefix,
      longName: line.name,
      mode: RAIL_MODE_TO_MODE[line.mode],
      color: line.color,
      textColor: line.textColor,
    };
  }
  if (feed === "ktm") {
    const name = r.route_short_name;
    return {
      label: KTM_LINES[name],
      longName: `KTM Komuter ${name}`,
      mode: "ktm",
      color: r.route_color ? `#${r.route_color}` : KTM_DEFAULT_COLOR,
      textColor: r.route_text_color ? `#${r.route_text_color}` : "#FFFFFF",
    };
  }
  const label = routeCodeOf(r);
  return {
    label,
    longName: r.route_long_name ?? label,
    mode: feed === "feeder" ? "feeder" : "bus",
    color: "#000000",
    textColor: "#FFFFFF",
  };
}

/**
 * Each rail route's official code prefix ("KJ"): the letters most of its
 * stops' ids start with, as `scripts/build-rail-stations.ts` derives it. The
 * route_ids don't say (Sri Petaling is `PH`, its stops `SP1`…).
 */
function railPrefixes(
  routes: readonly GtfsRoute[],
  stops: readonly GtfsStop[],
  trips: readonly GtfsTrip[],
  stopTimes: readonly GtfsStopTime[],
): Map<string, string> {
  const tripRoute = new Map(trips.map((t) => [t.trip_id, t.route_id]));
  const stopRoutes = new Map<string, Set<string>>();
  for (const st of stopTimes) {
    const routeId = tripRoute.get(st.trip_id);
    if (!routeId) continue;
    let set = stopRoutes.get(st.stop_id);
    if (!set) stopRoutes.set(st.stop_id, (set = new Set()));
    set.add(routeId);
  }
  const out = new Map<string, string>();
  for (const r of routes) {
    const routeId = String(r.route_id);
    const counts = new Map<string, number>();
    for (const s of stops) {
      if (!stopRoutes.get(s.stop_id)?.has(routeId)) continue;
      const pre = /^[A-Za-z]+/.exec(s.stop_id)?.[0]?.toUpperCase();
      if (pre) counts.set(pre, (counts.get(pre) ?? 0) + 1);
    }
    const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (prefix) out.set(routeId, prefix);
  }
  return out;
}

/**
 * Cuts KTM trips to the Klang Valley bbox: stop_times outside it go, a trip
 * keeps running only with two or more stops left, and only the stops still
 * served are kept. A trip's kept stops must be one unbroken run of its
 * stop_sequence; a trip that leaves the bbox and comes back means the feed
 * changed shape, so that throws rather than joining two far-apart stops.
 */
function cutToKlangValley(
  stops: GtfsStop[],
  trips: GtfsTrip[],
  stopTimes: GtfsStopTime[],
): { stops: GtfsStop[]; trips: GtfsTrip[]; stopTimes: GtfsStopTime[] } {
  const { minLat, maxLat, minLon, maxLon } = KLANG_VALLEY;
  const inside = new Set(
    stops
      .filter((s) => s.stop_lat >= minLat && s.stop_lat <= maxLat && s.stop_lon >= minLon && s.stop_lon <= maxLon)
      .map((s) => s.stop_id),
  );
  const byTrip = new Map<string, GtfsStopTime[]>();
  for (const st of stopTimes) {
    const rows = byTrip.get(st.trip_id);
    if (rows) rows.push(st);
    else byTrip.set(st.trip_id, [st]);
  }
  const keptTrips: GtfsTrip[] = [];
  const keptStopTimes: GtfsStopTime[] = [];
  for (const t of trips) {
    const rows = byTrip.get(t.trip_id);
    if (!rows) continue;
    rows.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const first = rows.findIndex((st) => inside.has(st.stop_id));
    if (first < 0) continue;
    let last = rows.length - 1;
    while (!inside.has(rows[last].stop_id)) last--;
    if (last - first + 1 < 2) continue;
    const run = rows.slice(first, last + 1);
    if (!run.every((st) => inside.has(st.stop_id))) {
      throw new Error(`ktm trip ${t.trip_id}: in-bbox stop_times are not contiguous in stop_sequence`);
    }
    keptTrips.push(t);
    keptStopTimes.push(...run);
  }
  const served = new Set(keptStopTimes.map((st) => st.stop_id));
  return { stops: stops.filter((s) => served.has(s.stop_id)), trips: keptTrips, stopTimes: keptStopTimes };
}

/**
 * The dates the trips' services run between: the earliest calendar
 * start_date, and the latest calendar end_date or added calendar_dates day.
 */
function validity(
  calendar: readonly GtfsCalendar[],
  calendarDates: readonly GtfsCalendarDate[],
  trips: readonly GtfsTrip[],
): { validFrom: string; validUntil: string } {
  const services = new Set(trips.map((t) => t.service_id));
  let validFrom = "";
  let validUntil = "";
  for (const c of calendar) {
    if (!services.has(c.service_id)) continue;
    if (c.start_date && (!validFrom || c.start_date < validFrom)) validFrom = c.start_date;
    if (c.end_date > validUntil) validUntil = c.end_date;
  }
  for (const d of calendarDates) {
    if (d.exception_type === 1 && services.has(d.service_id) && d.date > validUntil) validUntil = d.date;
  }
  return { validFrom, validUntil };
}
