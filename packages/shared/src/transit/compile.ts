import { RAIL_LINES, RAIL_STATIONS } from "../data/rail-stations.js";
import type { GtfsCalendar, GtfsCalendarDate, GtfsFrequency, GtfsTrip } from "../types/gtfs.js";
import { gtfsTimeToSeconds } from "../utils/gtfs-time.js";
import { haversineMeters } from "../utils/outlier.js";
import type { RailLine, RailStation } from "../utils/rail.js";
import { frequencyInstanceId } from "../utils/t816-bundle.js";
import type { NormalisedFeed } from "./feeds.js";
import { slug } from "./names.js";
import { FEED_IDS, MODES, namespaceFeedId, NETWORK_VERSION, type FeedId, type TransitNetwork } from "./network.js";
import { buildTransfersSteps } from "./transfers.js";

export interface FeedMeta { fetchedAt: number; hash: string; validUntil: string; included: boolean }
export type CompileFeeds = Partial<Record<FeedId, { data: NormalisedFeed; meta: FeedMeta }>>;
export interface CompileOptions {
  /** `meta.builtAt`; defaults to now. */
  builtAt?: number;
  /** Bus windows with a headway up to this stay turn-up-and-go. Never applied to rail. */
  busHeadwayCutoffSec?: number;
  /** Units of work (a stop_time row, a trip, a stop event, a grid insert) between yields. */
  yieldEvery?: number;
}

/** Spec §3.3: a bus window with a headway up to 12 min is turn-up-and-go; a longer one is expanded. */
export const BUS_HEADWAY_CUTOFF_SEC = 720;
/** Grid cell size for {@link stopsNear}: about 550 m. */
export const GRID_CELL_DEG = 0.005;
/**
 * Units of work between yields. A unit is at most a few µs on Node, so a step
 * stays a few ms on Hermes (~7–8× slower, task 00).
 */
export const DEFAULT_YIELD_EVERY = 2048;
/** Templates on one pattern share a freq-window pattern if their run times agree this closely. */
const RUN_OFFSET_TOLERANCE_SEC = 60;
/** Metres per degree of latitude, rounded down so {@link stopsNear} never scans too few cells. */
const METERS_PER_DEG = 110_000;

const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/**
 * Whether a frequency window stays a turn-up-and-go window (spec §3.3):
 * every rail window, whatever its headway, and bus windows up to `cutoff`.
 */
export function isTurnUpAndGo(feed: FeedId, headwaySec: number, cutoff = BUS_HEADWAY_CUTOFF_SEC): boolean {
  return feed === "rail" || headwaySec <= cutoff;
}

/**
 * Service ids running on `ymd` ('YYYYMMDD'): calendar rows whose weekday flag
 * is set and whose date range holds `ymd`, then that day's calendar_dates
 * (2 removes, 1 adds). The pure form of `getActiveServiceIdsForDate`.
 */
export function activeServiceIds(
  cal: readonly GtfsCalendar[],
  dates: readonly GtfsCalendarDate[],
  ymd: string,
): Set<string> {
  const dow = DOW[new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)))).getUTCDay()];
  const active = new Set<string>();
  for (const c of cal) {
    if (c[dow] && c.start_date <= ymd && c.end_date >= ymd) active.add(c.service_id);
  }
  for (const d of dates) {
    if (d.date !== ymd) continue;
    if (d.exception_type === 2) active.delete(d.service_id);
    else if (d.exception_type === 1) active.add(d.service_id);
  }
  return active;
}

/** Grid cell key of a point: `latCell * 1_000_000 + lonCell`. */
export function gridKey(lat: number, lon: number, cellDeg = GRID_CELL_DEG): number {
  return Math.floor((lat + 90) / cellDeg) * 1_000_000 + Math.floor((lon + 180) / cellDeg);
}

/** Index into `patterns.arr` / `dep` of trip `t`'s stop `s` on pattern `p`. The only way to read trip times. */
export function ev(net: TransitNetwork, p: number, t: number, s: number): number {
  return net.patterns.timeStart[p] + t * net.patterns.stopLen[p] + s;
}

/** Stops within `radiusM` metres (straight line) of a point, by ascending stop index. */
export function stopsNear(net: TransitNetwork, lat: number, lon: number, radiusM: number): number[] {
  const { cellDeg, cells } = net.grid;
  const { lat: stopLat, lon: stopLon } = net.stops;
  const latCell = Math.floor((lat + 90) / cellDeg);
  const lonCell = Math.floor((lon + 180) / cellDeg);
  // The 3×3 block, widened when the radius is longer than a cell.
  const cellM = cellDeg * METERS_PER_DEG;
  const rLat = Math.max(1, Math.ceil(radiusM / cellM));
  const rLon = Math.max(1, Math.ceil(radiusM / (cellM * Math.cos((lat * Math.PI) / 180))));
  const here = { lat, lng: lon };
  const out: number[] = [];
  for (let dy = -rLat; dy <= rLat; dy++) {
    for (let dx = -rLon; dx <= rLon; dx++) {
      const cell = cells.get((latCell + dy) * 1_000_000 + lonCell + dx);
      if (!cell) continue;
      for (let k = 0; k < cell.length; k++) {
        const i = cell[k];
        if (haversineMeters(here, { lat: stopLat[i], lng: stopLon[i] }) <= radiusM) out.push(i);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Work done since the last yield, shared by the compile's stages. */
interface Ticker { work: number; every: number }

/** One timetabled run: a GTFS trip, or one expanded from a headway template. */
interface Instance { key: string; arr: Int32Array; dep: Int32Array }
/** Turn-up-and-go windows of templates whose run times agree (within 60 s). */
interface WindowGroup { offset: Int32Array; windows: Array<{ start: number; end: number; headway: number }> }
/** Everything on one (route, direction, stop sequence) before FIFO splitting. */
interface PatternGroup {
  route: number;
  stops: Int32Array;
  headsign: string;
  instances: Instance[];
  windowGroups: WindowGroup[];
}

type Stops = TransitNetwork["stops"];

/**
 * Builds one service day's {@link TransitNetwork} from the included feeds, as
 * a generator that yields every `yieldEvery` units of work (drive it with
 * `runSteps`). Feeds go in `FEED_IDS` order so indices are deterministic.
 * Transfers come last, from {@link buildTransfersSteps}.
 */
export function* compileNetwork(
  feeds: CompileFeeds,
  serviceDate: string,
  opts: CompileOptions = {},
): Generator<void, TransitNetwork, void> {
  const cutoff = opts.busHeadwayCutoffSec ?? BUS_HEADWAY_CUTOFF_SEC;
  const tick: Ticker = { work: 0, every: Math.max(1, Math.floor(opts.yieldEvery ?? DEFAULT_YIELD_EVERY)) };
  const included: Array<[FeedId, NormalisedFeed]> = [];
  for (const f of FEED_IDS) {
    const entry = feeds[f];
    if (entry && entry.meta.included) included.push([f, entry.data]);
  }

  const { stops, idToIndex } = yield* buildStops(included, tick);
  const { routes, routeIndex } = yield* buildRoutes(included, tick);
  const groups = new Map<string, PatternGroup>();
  for (const [feed, data] of included) {
    yield* collectTrips(feed, data, serviceDate, idToIndex, routeIndex, stops.name, cutoff, groups, tick);
  }
  const patterns = yield* flattenPatterns(groups, tick);
  const stations = yield* buildStations(included, stops, idToIndex, tick);
  const stopRoutes = yield* buildStopRoutes(patterns, stops.count, tick);
  const grid = yield* buildGrid(stops, tick);

  const metaFeeds = {} as TransitNetwork["meta"]["feeds"];
  for (const f of FEED_IDS) {
    const m = feeds[f]?.meta;
    metaFeeds[f] = m
      ? { fetchedAt: m.fetchedAt, hash: m.hash, validUntil: m.validUntil, included: m.included }
      : { fetchedAt: 0, hash: "", validUntil: "", included: false };
  }
  const net: TransitNetwork = {
    meta: { version: NETWORK_VERSION, serviceDate, builtAt: opts.builtAt ?? Date.now(), feeds: metaFeeds },
    stops,
    stations,
    routes,
    patterns,
    stopRoutes,
    transfers: {
      start: new Int32Array(stops.count),
      len: new Int32Array(stops.count),
      to: new Int32Array(0),
      seconds: new Int32Array(0),
      kind: new Uint8Array(0),
    },
    grid,
  };
  net.transfers = yield* buildTransfersSteps(net);
  return net;
}

/** Drains {@link compileNetwork} in one go, for tests and scripts. */
export function compileNetworkSync(feeds: CompileFeeds, serviceDate: string, opts?: CompileOptions): TransitNetwork {
  const steps = compileNetwork(feeds, serviceDate, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Every stop of every included feed, in feed order then file order. */
function* buildStops(
  included: ReadonlyArray<[FeedId, NormalisedFeed]>,
  tick: Ticker,
): Generator<void, { stops: Stops; idToIndex: Map<string, number> }, void> {
  let count = 0;
  for (const [, data] of included) count += data.parsed.stops.length;
  const id: string[] = [];
  const name: string[] = [];
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  const feedOf = new Uint8Array(count);
  const idToIndex = new Map<string, number>();
  for (const [feed, data] of included) {
    const f = FEED_IDS.indexOf(feed);
    for (const s of data.parsed.stops) {
      if (++tick.work % tick.every === 0) yield;
      if (idToIndex.has(s.stop_id)) continue; // a duplicate row; the first wins
      const i = id.length;
      idToIndex.set(s.stop_id, i);
      id.push(s.stop_id);
      name.push(data.stopNames.get(s.stop_id) ?? s.stop_name);
      lat[i] = s.stop_lat;
      lon[i] = s.stop_lon;
      feedOf[i] = f;
    }
  }
  const n = id.length;
  return {
    stops: {
      count: n,
      id,
      name,
      lat: n === count ? lat : lat.slice(0, n),
      lon: n === count ? lon : lon.slice(0, n),
      feed: n === count ? feedOf : feedOf.slice(0, n),
      station: new Int32Array(n).fill(-1),
    },
    idToIndex,
  };
}

/** One route per route_id with metadata, in feed order then file order. */
function* buildRoutes(
  included: ReadonlyArray<[FeedId, NormalisedFeed]>,
  tick: Ticker,
): Generator<void, { routes: TransitNetwork["routes"]; routeIndex: Map<string, number> }, void> {
  const id: string[] = [];
  const label: string[] = [];
  const longName: string[] = [];
  const mode: number[] = [];
  const color: string[] = [];
  const textColor: string[] = [];
  const feedOf: number[] = [];
  const shapeId: string[] = [];
  const routeIndex = new Map<string, number>();
  for (const [feed, data] of included) {
    const firstShape = new Map<string, string>();
    for (const t of data.parsed.trips) {
      if (++tick.work % tick.every === 0) yield;
      if (!firstShape.has(t.route_id)) firstShape.set(t.route_id, t.shape_id ?? "");
    }
    for (const r of data.parsed.routes) {
      const rid = String(r.route_id);
      const meta = data.routeMeta.get(rid);
      if (!meta || routeIndex.has(rid)) continue;
      routeIndex.set(rid, id.length);
      id.push(rid);
      label.push(meta.label);
      longName.push(meta.longName);
      mode.push(MODES.indexOf(meta.mode));
      color.push(meta.color);
      textColor.push(meta.textColor);
      feedOf.push(FEED_IDS.indexOf(feed));
      // KTM has no shapes.txt; its legs are drawn station to station.
      shapeId.push(feed === "ktm" ? "" : (firstShape.get(rid) ?? ""));
    }
  }
  return {
    routes: {
      count: id.length,
      id,
      label,
      longName,
      mode: Uint8Array.from(mode),
      color,
      textColor,
      feed: Uint8Array.from(feedOf),
      shapeId,
    },
    routeIndex,
  };
}

/**
 * Turns one feed's trips running on `ymd` into pattern instances and
 * turn-up-and-go windows, grouped by (route, direction, stop sequence).
 */
function* collectTrips(
  feed: FeedId,
  data: NormalisedFeed,
  ymd: string,
  idToIndex: ReadonlyMap<string, number>,
  routeIndex: ReadonlyMap<string, number>,
  stopNames: readonly string[],
  cutoff: number,
  groups: Map<string, PatternGroup>,
  tick: Ticker,
): Generator<void, void, void> {
  const { parsed } = data;
  const active = activeServiceIds(parsed.calendar, parsed.calendarDates, ymd);
  const trips = new Map<string, GtfsTrip>();
  for (const t of parsed.trips) {
    if (++tick.work % tick.every === 0) yield;
    if (active.has(t.service_id) && routeIndex.has(t.route_id)) trips.set(t.trip_id, t);
  }

  // The hot loop: stop_times come grouped by trip, so only the first row of
  // each run is looked up, and a trip's rows are kept as [start, end) runs.
  const st = parsed.stopTimes;
  const runs = new Map<string, number[]>();
  let runTrip: string | null = null;
  let runStart = 0;
  let runRows: number[] | undefined;
  for (let i = 0; i < st.length; i++) {
    if (++tick.work % tick.every === 0) yield;
    const tripId = st[i].trip_id;
    if (tripId === runTrip) continue;
    runRows?.push(runStart, i);
    runTrip = tripId;
    runStart = i;
    runRows = undefined;
    if (trips.has(tripId)) {
      runRows = runs.get(tripId);
      if (!runRows) runs.set(tripId, (runRows = []));
    }
  }
  runRows?.push(runStart, st.length);

  const windowsByTrip = new Map<string, GtfsFrequency[]>();
  for (const f of parsed.frequencies) {
    if (!trips.has(f.trip_id)) continue;
    const list = windowsByTrip.get(f.trip_id);
    if (list) list.push(f);
    else windowsByTrip.set(f.trip_id, [f]);
  }

  for (const trip of trips.values()) {
    if (++tick.work % tick.every === 0) yield;
    const r = runs.get(trip.trip_id);
    if (!r) continue;
    let n = 0;
    for (let k = 0; k < r.length; k += 2) n += r[k + 1] - r[k];
    if (n < 2) continue;
    // Row indices in stop_sequence order.
    const order = new Int32Array(n);
    let sorted = true;
    for (let k = 0, o = 0; k < r.length; k += 2) {
      for (let i = r[k]; i < r[k + 1]; i++, o++) {
        order[o] = i;
        if (o > 0 && st[i].stop_sequence < st[order[o - 1]].stop_sequence) sorted = false;
      }
    }
    if (!sorted) order.sort((a, b) => st[a].stop_sequence - st[b].stop_sequence);

    const stops = new Int32Array(n);
    const arr = new Int32Array(n);
    const dep = new Int32Array(n);
    let ok = true;
    for (let s = 0; s < n; s++) {
      if (++tick.work % tick.every === 0) yield;
      const row = st[order[s]];
      const stop = idToIndex.get(row.stop_id);
      const a = timeOf(row.arrival_time);
      const d = timeOf(row.departure_time);
      // A missing time takes the other; a malformed one sinks the trip.
      if (stop === undefined || a === BAD_TIME || d === BAD_TIME || (a === NO_TIME && d === NO_TIME)) {
        ok = false;
        break;
      }
      stops[s] = stop;
      arr[s] = a === NO_TIME ? d : a;
      dep[s] = d === NO_TIME ? a : d;
    }
    if (!ok) continue;

    const key = `${trip.route_id}|${trip.direction_id ?? ""}|${stops.join(",")}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        route: routeIndex.get(trip.route_id)!,
        stops,
        headsign: trip.trip_headsign ?? stopNames[stops[n - 1]],
        instances: [],
        windowGroups: [],
      };
      groups.set(key, group);
    }

    const windows = windowsByTrip.get(trip.trip_id);
    if (!windows) {
      group.instances.push({ key: trip.trip_id, arr, dep });
      continue;
    }
    const base = dep[0];
    const offset = new Int32Array(n);
    for (let s = 0; s < n; s++) offset[s] = dep[s] - base;
    // Starts of the long windows: deduplicated and sorted, inclusive ends,
    // as expandFrequencies lays them out.
    const starts = new Set<number>();
    for (const w of windows) {
      const start = gtfsTimeToSeconds(w.start_time);
      const end = gtfsTimeToSeconds(w.end_time);
      if (start === null || end === null || end < start || w.headway_secs <= 0) continue;
      if (isTurnUpAndGo(feed, w.headway_secs, cutoff)) {
        windowGroupFor(group, offset).windows.push({ start, end, headway: w.headway_secs });
      } else {
        for (let t = start; t <= end; t += w.headway_secs) starts.add(t);
      }
    }
    for (const start of [...starts].sort((x, y) => x - y)) {
      const ea = new Int32Array(n);
      const ed = new Int32Array(n);
      for (let s = 0; s < n; s++) {
        if (++tick.work % tick.every === 0) yield;
        ea[s] = start + arr[s] - base;
        ed[s] = start + dep[s] - base;
      }
      group.instances.push({ key: frequencyInstanceId(trip.trip_id, start), arr: ea, dep: ed });
    }
  }
}

const NO_TIME = -1;
const BAD_TIME = -2;

/**
 * {@link gtfsTimeToSeconds} for the stop_times loop, without the regex and
 * its allocations: the same `H:MM:SS` to `HHH:MM:SS` grammar, giving
 * {@link NO_TIME} for a missing time and {@link BAD_TIME} for a malformed one.
 */
function timeOf(t: string | undefined): number {
  if (!t) return NO_TIME;
  const h = t.length - 6;
  if (h < 1 || h > 3) return BAD_TIME;
  let hours = 0;
  for (let i = 0; i < h; i++) {
    const c = t.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return BAD_TIME;
    hours = hours * 10 + c;
  }
  if (t.charCodeAt(h) !== 58 || t.charCodeAt(h + 3) !== 58) return BAD_TIME; // ':'
  const m1 = t.charCodeAt(h + 1) - 48;
  const m2 = t.charCodeAt(h + 2) - 48;
  const s1 = t.charCodeAt(h + 4) - 48;
  const s2 = t.charCodeAt(h + 5) - 48;
  if (m1 < 0 || m1 > 5 || m2 < 0 || m2 > 9 || s1 < 0 || s1 > 5 || s2 < 0 || s2 > 9) return BAD_TIME;
  return hours * 3600 + (m1 * 10 + m2) * 60 + s1 * 10 + s2;
}

/** The group's window group whose run offsets agree with `offset`, or a new one. */
function windowGroupFor(group: PatternGroup, offset: Int32Array): WindowGroup {
  for (const g of group.windowGroups) {
    let agree = true;
    for (let s = 0; s < offset.length && agree; s++) {
      agree = Math.abs(g.offset[s] - offset[s]) <= RUN_OFFSET_TOLERANCE_SEC;
    }
    if (agree) return g;
  }
  const g: WindowGroup = { offset, windows: [] };
  group.windowGroups.push(g);
  return g;
}

/** Whether `b` (departing no earlier) never overtakes `a` at any stop. */
function keepsOrder(a: Instance, b: Instance): boolean {
  for (let s = 0; s < a.dep.length; s++) {
    if (b.dep[s] < a.dep[s] || b.arr[s] < a.arr[s]) return false;
  }
  return true;
}

/**
 * Splits each group into FIFO sub-patterns and flattens everything into the
 * network's typed arrays. Sub-pattern `i` carries window group `i`, so a
 * group becomes max(sub-patterns, window groups) patterns.
 */
function* flattenPatterns(
  groups: ReadonlyMap<string, PatternGroup>,
  tick: Ticker,
): Generator<void, TransitNetwork["patterns"], void> {
  const list: Array<{ group: PatternGroup; instances: Instance[]; windows: WindowGroup | null }> = [];
  for (const group of groups.values()) {
    // Array#sort is stable, so equal first departures keep file order.
    group.instances.sort((a, b) => a.dep[0] - b.dep[0]);
    const subs: Instance[][] = [];
    for (const inst of group.instances) {
      if (++tick.work % tick.every === 0) yield;
      const sub = subs.find((x) => keepsOrder(x[x.length - 1], inst));
      if (sub) sub.push(inst);
      else subs.push([inst]);
    }
    const m = Math.max(subs.length, group.windowGroups.length);
    for (let i = 0; i < m; i++) list.push({ group, instances: subs[i] ?? [], windows: group.windowGroups[i] ?? null });
  }

  const count = list.length;
  let slots = 0;
  let trips = 0;
  let events = 0;
  let windowCount = 0;
  for (const p of list) {
    slots += p.group.stops.length;
    trips += p.instances.length;
    events += p.instances.length * p.group.stops.length;
    windowCount += p.windows?.windows.length ?? 0;
  }
  const route = new Int32Array(count);
  const headsign: string[] = [];
  const stopStart = new Int32Array(count);
  const stopLen = new Int32Array(count);
  const stops = new Int32Array(slots);
  const tripStart = new Int32Array(count);
  const tripLen = new Int32Array(count);
  const timeStart = new Int32Array(count);
  const arr = new Int32Array(events);
  const dep = new Int32Array(events);
  const tripKey: string[] = [];
  const freqStart = new Int32Array(count);
  const freqLen = new Int32Array(count);
  const fStart = new Int32Array(windowCount);
  const fEnd = new Int32Array(windowCount);
  const fHeadway = new Int32Array(windowCount);
  const runOffset = new Int32Array(slots);

  let slot = 0;
  let trip = 0;
  let event = 0;
  let w = 0;
  for (let p = 0; p < count; p++) {
    const { group, instances, windows } = list[p];
    const len = group.stops.length;
    route[p] = group.route;
    headsign.push(group.headsign);
    stopStart[p] = slot;
    stopLen[p] = len;
    stops.set(group.stops, slot);
    if (windows) runOffset.set(windows.offset, slot);
    slot += len;

    tripStart[p] = trip;
    tripLen[p] = instances.length;
    timeStart[p] = event;
    trip += instances.length;
    for (const inst of instances) {
      tripKey.push(inst.key);
      for (let s = 0; s < len; s++) {
        if (++tick.work % tick.every === 0) yield;
        arr[event] = inst.arr[s];
        dep[event] = inst.dep[s];
        event++;
      }
    }

    freqStart[p] = w;
    const ws = windows ? [...windows.windows].sort((a, b) => a.start - b.start || a.end - b.end || a.headway - b.headway) : [];
    freqLen[p] = ws.length;
    for (const x of ws) {
      fStart[w] = x.start;
      fEnd[w] = x.end;
      fHeadway[w] = x.headway;
      w++;
    }
  }
  return {
    count,
    route,
    headsign,
    stopStart,
    stopLen,
    stops,
    tripStart,
    tripLen,
    timeStart,
    arr,
    dep,
    tripKey,
    freqStart,
    freqLen,
    fStart,
    fEnd,
    fHeadway,
    runOffset,
  };
}

/**
 * `RAIL_STATIONS` (ids namespaced), a single-stop station for any rail stop
 * it lacks, and one station per KTM stop. Fills `stops.station`.
 */
function* buildStations(
  included: ReadonlyArray<[FeedId, NormalisedFeed]>,
  stops: Stops,
  idToIndex: ReadonlyMap<string, number>,
  tick: Ticker,
): Generator<void, RailStation[], void> {
  const stations: RailStation[] = [];
  const add = (station: RailStation) => {
    const at = stations.length;
    stations.push(station);
    for (const id of station.stopIds) {
      const i = idToIndex.get(id);
      if (i !== undefined) stops.station[i] = at;
    }
  };
  const taken = new Set<string>();
  for (const [feed, data] of included) {
    if (feed !== "rail" && feed !== "ktm") continue;
    if (feed === "rail") {
      for (const s of RAIL_STATIONS) {
        taken.add(s.id);
        add({ ...s, stopIds: s.stopIds.map((id) => namespaceFeedId("rail", id)) });
      }
    }
    const linesByStop = routesByStop(data);
    for (const s of data.parsed.stops) {
      if (++tick.work % tick.every === 0) yield;
      const i = idToIndex.get(s.stop_id);
      if (i === undefined || stops.station[i] !== -1) continue;
      const name = stops.name[i];
      const routeIds = linesByStop.get(s.stop_id) ?? [];
      let lines: RailLine[];
      let id: string;
      if (feed === "ktm") {
        id = `ktm-${slug(name)}`;
        lines = routeIds.flatMap((rid) => {
          const meta = data.routeMeta.get(rid);
          return meta ? [{ code: "KTM", mode: "KTM" as const, name: meta.longName, color: meta.color, textColor: meta.textColor }] : [];
        });
      } else {
        console.warn(`compileNetwork: rail stop ${s.stop_id} (${name}) is not in RAIL_STATIONS; regenerate rail-stations.ts`);
        id = slug(name);
        lines = routeIds.flatMap((rid) => {
          const meta = data.routeMeta.get(rid);
          const line = meta && RAIL_LINES.find((l) => l.name === meta.longName);
          return line ? [line] : [];
        });
      }
      if (taken.has(id)) id = `${id}-${slug(s.stop_id)}`;
      taken.add(id);
      add({ id, name, lat: s.stop_lat, lng: s.stop_lon, stopIds: [s.stop_id], lines });
    }
  }
  return stations;
}

/** route_ids calling at each stop on any day, in routes.txt order. Small feeds only (rail, KTM). */
function routesByStop(data: NormalisedFeed): Map<string, string[]> {
  const { parsed } = data;
  const tripRoute = new Map(parsed.trips.map((t) => [t.trip_id, t.route_id]));
  const seen = new Map<string, Set<string>>();
  for (const st of parsed.stopTimes) {
    const rid = tripRoute.get(st.trip_id);
    if (!rid) continue;
    let set = seen.get(st.stop_id);
    if (!set) seen.set(st.stop_id, (set = new Set()));
    set.add(rid);
  }
  const out = new Map<string, string[]>();
  for (const [stop, set] of seen) {
    out.set(stop, parsed.routes.map((r) => String(r.route_id)).filter((rid) => set.has(rid)));
  }
  return out;
}

/** CSR by stop of every (pattern, pos) calling there; a loop gets one entry per visit. */
function* buildStopRoutes(
  patterns: TransitNetwork["patterns"],
  stopCount: number,
  tick: Ticker,
): Generator<void, TransitNetwork["stopRoutes"], void> {
  const { count, stopStart, stopLen, stops } = patterns;
  const start = new Int32Array(stopCount);
  const len = new Int32Array(stopCount);
  for (let k = 0; k < stops.length; k++) len[stops[k]]++;
  for (let i = 1; i < stopCount; i++) start[i] = start[i - 1] + len[i - 1];
  const pattern = new Int32Array(stops.length);
  const pos = new Int32Array(stops.length);
  const fill = new Int32Array(stopCount);
  for (let p = 0; p < count; p++) {
    for (let s = 0; s < stopLen[p]; s++) {
      if (++tick.work % tick.every === 0) yield;
      const stop = stops[stopStart[p] + s];
      const at = start[stop] + fill[stop]++;
      pattern[at] = p;
      pos[at] = s;
    }
  }
  return { start, len, pattern, pos };
}

/** Stops bucketed by {@link gridKey} cell, ascending within each cell. */
function* buildGrid(stops: Stops, tick: Ticker): Generator<void, TransitNetwork["grid"], void> {
  const keys = new Float64Array(stops.count);
  const sizes = new Map<number, number>();
  for (let i = 0; i < stops.count; i++) {
    if (++tick.work % tick.every === 0) yield;
    const key = gridKey(stops.lat[i], stops.lon[i], GRID_CELL_DEG);
    keys[i] = key;
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const cells = new Map<number, Int32Array>();
  const fill = new Map<number, number>();
  for (const [key, size] of sizes) {
    cells.set(key, new Int32Array(size));
    fill.set(key, 0);
  }
  for (let i = 0; i < stops.count; i++) {
    if (++tick.work % tick.every === 0) yield;
    const at = fill.get(keys[i])!;
    cells.get(keys[i])![at] = i;
    fill.set(keys[i], at + 1);
  }
  return { cellDeg: GRID_CELL_DEG, cells };
}
