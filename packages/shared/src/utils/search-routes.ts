import { Unzip, UnzipInflate } from "fflate";

import type { GtfsRoute } from "../types/gtfs.js";
import {
  BUS_CATEGORY_INFO,
  namespaceId,
  routeCodeOf,
  routeKeyFor,
  type BusCategory,
} from "./categories.js";
import { scanCsvColumnsSteps, type ParsedGtfs } from "./gtfs-parser.js";

export interface RouteSearchHit {
  /**
   * Route key to follow the route by — the bare code for Klang Valley routes
   * ("T816", "400"), suffixed elsewhere ("401 Penang"). See `routeKeyFor`.
   */
  code: string;
  long_name?: string;
  /** Feed the route comes from, when the index was built with a category. */
  category?: BusCategory;
  /** Operator label for `category` ("Rapid KL"). */
  network?: string;
  /** First stop along a representative trip for this route. */
  origin?: string;
  /** Last stop along a representative trip for this route. */
  destination?: string;
  /**
   * Stop near the middle of a representative trip. Useful for circular routes
   * where origin and destination collapse to the same stop — the UI can fall
   * back to "via {midpoint}" instead of a confusing "to {same origin}".
   * Only populated when the midpoint is distinct from origin and destination.
   */
  midpoint?: string;
  matchedStops?: { stop_id: string; stop_name: string }[];
}

interface IndexedRoute {
  route_id: string;
  code: string;
  long_name?: string;
  shortN: string;
  longN: string;
  /** Normalised route key, so "401 penang" finds the Penang 401. */
  keyN: string;
  origin?: string;
  destination?: string;
  midpoint?: string;
}

/**
 * Everything route search needs from one feed, without the feed's
 * stop_times. Building it costs one pass over stop_times; afterwards the
 * parsed feed can be dropped, so searching several feeds doesn't keep them
 * all in memory.
 */
export interface RouteSearchIndex {
  category?: BusCategory;
  routes: IndexedRoute[];
  stops: { stop_id: string; stop_name: string; nameN: string }[];
  /** stop_id → route_ids serving it, in first-seen order. */
  routesByStop: Map<string, string[]>;
}

function normalize(s: string | undefined): string {
  return (s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "");
}

/** What the index needs from a feed besides stop_times, which are folded in one by one. */
interface IndexSource {
  routes: readonly Pick<GtfsRoute, "route_id" | "route_short_name" | "route_long_name">[];
  stops: readonly { stop_id: string; stop_name: string }[];
  trips: readonly { trip_id: string; route_id: string }[];
}

export function buildRouteSearchIndex(
  parsed: ParsedGtfs,
  category?: BusCategory,
): RouteSearchIndex {
  const builder = indexBuilder(parsed, category);
  for (const st of parsed.stopTimes) builder.add(st.trip_id, st.stop_id, st.stop_sequence);
  return builder.finish();
}

const INDEX_FILES = new Set(["routes.txt", "stops.txt", "trips.txt", "stop_times.txt"]);

export interface BuildIndexFromZipOptions {
  /**
   * Work per slice before pausing for a macrotask, so input and renders get
   * the JS thread in between. Default 8 ms, half a frame.
   */
  sliceMs?: number;
}

/**
 * The search index straight from a feed zip, never parsing it whole: only
 * the four files it reads are inflated (shapes, often the biggest, are
 * skipped), and stop_times.txt is decoded and scanned 64 KB at a time
 * without making an object per row. The work runs in slices of
 * `sliceMs`, so a cold build on the JS thread doesn't freeze typing. Ids
 * come out namespaced for `category`, the same as
 * {@link buildRouteSearchIndex} over a namespaced feed.
 */
export function buildRouteSearchIndexFromZip(
  zip: Uint8Array,
  category?: BusCategory,
  opts: BuildIndexFromZipOptions = {},
): Promise<RouteSearchIndex> {
  return runInSlices(indexFromZipSteps(zip, category), opts.sliceMs ?? 8);
}

/** Runs `steps` to the end, pausing for a macrotask whenever a slice has run `sliceMs`. */
async function runInSlices<T>(steps: Generator<void, T, void>, sliceMs: number): Promise<T> {
  let sliceStart = Date.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - sliceStart >= sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      sliceStart = Date.now();
    }
  }
}

/** A trimmed field as `parseCsv` gives it: undefined when the column is absent. */
function cell(row: string[], i: number): string {
  return (i < 0 ? undefined : (row[i] ?? "").trim()) as string;
}

function* indexFromZipSteps(
  zip: Uint8Array,
  category?: BusCategory,
): Generator<void, RouteSearchIndex, void> {
  const files = yield* unzipSteps(zip, INDEX_FILES);
  const scan = (
    name: string,
    columns: readonly string[],
    onRow: (row: string[], col: readonly number[]) => void,
  ) => {
    const chunks = files.get(name) ?? [];
    files.delete(name);
    return scanCsvColumnsSteps(drain(chunks), columns, onRow);
  };
  const src: { [K in keyof IndexSource]: IndexSource[K][number][] } = {
    routes: [],
    stops: [],
    trips: [],
  };
  yield* scan("routes.txt", ["route_id", "route_short_name", "route_long_name"], (r, [id, s, l]) => {
    src.routes.push({
      route_id: cell(r, id),
      route_short_name: cell(r, s),
      route_long_name: cell(r, l) || undefined,
    });
  });
  yield* scan("stops.txt", ["stop_id", "stop_name"], (r, [id, name]) => {
    src.stops.push({ stop_id: cell(r, id), stop_name: cell(r, name) });
  });
  yield* scan("trips.txt", ["trip_id", "route_id"], (r, [id, route]) => {
    src.trips.push({ trip_id: cell(r, id), route_id: cell(r, route) });
  });
  const builder = indexBuilder(src, category);
  yield* scan("stop_times.txt", ["trip_id", "stop_id", "stop_sequence"], (r, [t, st, q]) => {
    builder.add((r[t] ?? "").trim(), (r[st] ?? "").trim(), Number(r[q]) || 0);
  });
  const index = builder.finish();
  return category && BUS_CATEGORY_INFO[category].idPrefix ? namespaceIndex(index, category) : index;
}

/** Compressed bytes pushed through the inflater per step: a few ms on Hermes. */
const UNZIP_STEP_BYTES = 16 * 1024;

/**
 * Inflates just the `names` files of a zip, as a generator that yields after
 * every 16 KB of it. Each file comes out as the chunks it inflated in.
 */
function* unzipSteps(
  zip: Uint8Array,
  names: ReadonlySet<string>,
): Generator<void, Map<string, Uint8Array[]>, void> {
  // The streaming reader would take any bytes (an error page, a cut-off
  // download) as a zip with no files; insist on the central directory end,
  // as unzipSync does.
  if (!hasZipEnd(zip)) throw new Error("invalid zip data");
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

/** Whether `zip` ends with an end-of-central-directory record. */
function hasZipEnd(zip: Uint8Array): boolean {
  // The record is 22 bytes plus a comment of up to 64 KB.
  const last = zip.length - 22;
  for (let i = last; i >= 0 && last - i <= 0xffff; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

/** Hands out `chunks` one by one, letting go of each as it goes. */
function* drain(chunks: Uint8Array[]): Generator<Uint8Array, void, void> {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    chunks[i] = EMPTY;
    yield chunk;
  }
}
const EMPTY = new Uint8Array(0);

/** Rewrites an index built on raw feed ids to the app's namespaced ids. */
function namespaceIndex(index: RouteSearchIndex, category: BusCategory): RouteSearchIndex {
  const ns = (id: string) => namespaceId(category, id);
  const routesByStop = new Map<string, string[]>();
  for (const [stopId, routeIds] of index.routesByStop) routesByStop.set(ns(stopId), routeIds.map(ns));
  return {
    category,
    routes: index.routes.map((r) => ({ ...r, route_id: ns(r.route_id) })),
    stops: index.stops.map((s) => ({ ...s, stop_id: ns(s.stop_id) })),
    routesByStop,
  };
}

/**
 * Builds an index from `src` and the feed's stop_times, `add`ed in file
 * order in a single pass: which routes serve each stop, and the stops of
 * each route's representative trip — the first trip in trips.txt that has
 * stop_times.
 */
function indexBuilder(src: IndexSource, category?: BusCategory) {
  const tripRoute = new Map<string, string>();
  // trip_id → its positions in trips.txt (one, unless the feed repeats it).
  const tripRanks = new Map<string, number[]>();
  src.trips.forEach((t, i) => {
    tripRoute.set(t.trip_id, t.route_id);
    const ranks = tripRanks.get(t.trip_id);
    if (ranks) ranks.push(i);
    else tripRanks.set(t.trip_id, [i]);
  });

  const routesByStop = new Map<string, string[]>();
  // route_id → the best-ranked trip seen with stop_times so far, and its
  // stops. A better-ranked trip showing up later replaces it; the winner
  // has all its rows, since it can only win on its first one.
  const rep = new Map<string, { rank: number; stops: Array<{ seq: number; id: string }> }>();

  function add(tripId: string, stopId: string, seq: number): void {
    const routeId = tripRoute.get(tripId);
    if (routeId) {
      const arr = routesByStop.get(stopId);
      if (!arr) routesByStop.set(stopId, [routeId]);
      else if (!arr.includes(routeId)) arr.push(routeId);
    }
    const ranks = tripRanks.get(tripId);
    if (!ranks) return;
    for (const rank of ranks) {
      const tripRouteId = src.trips[rank].route_id;
      const cur = rep.get(tripRouteId);
      if (!cur || rank < cur.rank) rep.set(tripRouteId, { rank, stops: [{ seq, id: stopId }] });
      else if (rank === cur.rank) cur.stops.push({ seq, id: stopId });
    }
  }

  function finish(): RouteSearchIndex {
    const stopName = new Map<string, string>();
    for (const s of src.stops) stopName.set(s.stop_id, s.stop_name);

    const routes: IndexedRoute[] = [];
    for (const r of src.routes) {
      const display = (r.route_short_name || r.route_long_name || "").trim();
      if (!display) continue;
      const routeId = String(r.route_id);
      const entry: IndexedRoute = {
        route_id: routeId,
        code: category ? routeKeyFor(category, routeCodeOf(r)) : display,
        long_name: r.route_long_name,
        shortN: normalize(r.route_short_name),
        longN: normalize(r.route_long_name),
        keyN: "",
      };
      entry.keyN = normalize(entry.code);
      const stops = rep.get(routeId)?.stops;
      if (stops && stops.length > 0) {
        stops.sort((a, b) => a.seq - b.seq);
        const first = stopName.get(stops[0].id);
        const last = stopName.get(stops[stops.length - 1].id);
        entry.origin = first;
        entry.destination = last;
        // Expose a midpoint only when it adds information — distinct from both
        // endpoints and the trip has enough stops for "middle" to mean something.
        if (stops.length >= 3) {
          const mid = stopName.get(stops[Math.floor(stops.length / 2)].id);
          if (mid && mid !== first && mid !== last) entry.midpoint = mid;
        }
      }
      routes.push(entry);
    }

    return {
      category,
      routes,
      stops: src.stops.map((s) => ({
        stop_id: s.stop_id,
        stop_name: s.stop_name,
        nameN: normalize(s.stop_name),
      })),
      routesByStop,
    };
  }

  return { add, finish };
}

/** Version of {@link SerializedRouteSearchIndex}; bump when its shape changes. */
export const ROUTE_SEARCH_INDEX_VERSION = 1;

/**
 * A search index as plain JSON, for caching on disk: routes as they are
 * (a few hundred at most), stops as [id, name] pairs (the normalised name is
 * rebuilt on load) and the stop → routes map as entries.
 */
export interface SerializedRouteSearchIndex {
  v: number;
  category?: BusCategory;
  routes: IndexedRoute[];
  stops: [string, string][];
  routesByStop: [string, string[]][];
}

export function serializeRouteSearchIndex(index: RouteSearchIndex): SerializedRouteSearchIndex {
  return {
    v: ROUTE_SEARCH_INDEX_VERSION,
    category: index.category,
    routes: index.routes,
    stops: index.stops.map((s) => [s.stop_id, s.stop_name]),
    routesByStop: Array.from(index.routesByStop),
  };
}

/** Null when the data is from another version or malformed. */
export function deserializeRouteSearchIndex(data: unknown): RouteSearchIndex | null {
  const d = data as Partial<SerializedRouteSearchIndex> | null;
  if (!d || d.v !== ROUTE_SEARCH_INDEX_VERSION) return null;
  if (!Array.isArray(d.routes) || !Array.isArray(d.stops) || !Array.isArray(d.routesByStop)) {
    return null;
  }
  return {
    category: d.category,
    routes: d.routes,
    stops: d.stops.map(([stop_id, stop_name]) => ({ stop_id, stop_name, nameN: normalize(stop_name) })),
    routesByStop: new Map(d.routesByStop),
  };
}

interface RankedHit {
  hit: RouteSearchHit;
  rank: number;
  order: number;
}

/**
 * Route search across one or more feeds: exact route code first, then a
 * partial code / long-name match, then routes serving a stop whose name
 * matches. Ties sort by code, then by the order of `indexes`.
 */
export function searchRouteIndexes(
  indexes: readonly RouteSearchIndex[],
  query: string,
  limit: number = 25,
): RouteSearchHit[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  const ranked: RankedHit[] = [];
  indexes.forEach((index, order) => {
    const byId = new Map<string, { route: IndexedRoute; rank: number; matchedStops?: RouteSearchHit["matchedStops"] }>();
    for (const r of index.routes) {
      if (r.shortN === q || r.keyN === q || (!r.shortN && r.longN === q)) {
        byId.set(r.route_id, { route: r, rank: 0 });
      } else if (r.shortN.includes(q) || r.longN.includes(q) || r.keyN.includes(q)) {
        byId.set(r.route_id, { route: r, rank: 1 });
      }
    }

    const routeById = new Map(index.routes.map((r) => [r.route_id, r]));
    const stopsByRoute = new Map<string, { stop_id: string; stop_name: string }[]>();
    for (const s of index.stops) {
      if (!s.nameN.includes(q)) continue;
      for (const routeId of index.routesByStop.get(s.stop_id) ?? []) {
        const arr = stopsByRoute.get(routeId) ?? [];
        if (arr.length < 3) arr.push({ stop_id: s.stop_id, stop_name: s.stop_name });
        stopsByRoute.set(routeId, arr);
      }
    }
    for (const [routeId, matchedStops] of stopsByRoute) {
      const existing = byId.get(routeId);
      if (existing) {
        existing.matchedStops ??= matchedStops;
        continue;
      }
      const route = routeById.get(routeId);
      if (route) byId.set(routeId, { route, rank: 2, matchedStops });
    }

    for (const { route, rank, matchedStops } of byId.values()) {
      ranked.push({
        rank,
        order,
        hit: {
          code: route.code,
          long_name: route.long_name,
          ...(index.category
            ? { category: index.category, network: BUS_CATEGORY_INFO[index.category].label }
            : {}),
          origin: route.origin,
          destination: route.destination,
          midpoint: route.midpoint,
          matchedStops,
        },
      });
    }
  });

  ranked.sort(
    (a, b) => a.rank - b.rank || a.hit.code.localeCompare(b.hit.code) || a.order - b.order,
  );
  return ranked.slice(0, limit).map((r) => r.hit);
}

/** Route search over a single parsed feed. */
export function searchRoutes(
  parsed: ParsedGtfs,
  query: string,
  limit: number = 25,
): RouteSearchHit[] {
  return searchRouteIndexes([buildRouteSearchIndex(parsed)], query, limit);
}
