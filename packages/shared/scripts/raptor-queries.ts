/**
 * Plan 14/00: the five golden queries (plan 14/06) and timing helpers shared
 * by the Node bench (bench-raptor.ts) and the throwaway device harness
 * (apps/mobile/app/dev-planner.tsx). Access and egress are every stop within
 * 1,000 m, nearest 25, walked at 80 m/min × 1.25 (spec §4.1).
 */
import { compileNetworkSync, stopsNear, type CompileFeeds } from "../src/transit/compile.js";
import { readFeed, type NormalisedFeed } from "../src/transit/feeds.js";
import { FEED_IDS, type FeedId, type TransitNetwork } from "../src/transit/network.js";
import { INF, type StopTime } from "../src/transit/raptor.js";
import { DETOUR_FACTOR } from "../src/transit/transfers.js";
import { secondsToClockHHMM, toMalaysiaParts } from "../src/utils/gtfs-time.js";
import { haversineMeters } from "../src/utils/outlier.js";
import { WALKING_METERS_PER_MINUTE } from "../src/utils/rail.js";

export const SERVICE_DATE = "20261028";
/** 2026-10-28 08:00 MYT. */
export const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);
export const ACCESS_RADIUS_M = 1000;
export const ACCESS_CAP = 25;

/** Fixture zip per feed, in `__fixtures__/2026-10-23/`. */
export const FIXTURE_ZIPS: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};

export interface BenchQuery {
  name: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  departAt: number;
  exclude?: readonly FeedId[];
}

/** Plan 14/06 step 2's goldens, by coordinates. */
export const GOLDEN_QUERIES: readonly BenchQuery[] = [
  { name: "Q1 Lisa→KLCC", from: { lat: 3.118231, lng: 101.63065 }, to: { lat: 3.158935, lng: 101.713287 }, departAt: AT_0800 },
  { name: "Q2 PJ14→KL Sentral", from: { lat: 3.110474, lng: 101.636336 }, to: { lat: 3.133636, lng: 101.687034 }, departAt: AT_0800 },
  { name: "Q3 SJ→Bukit Bintang", from: { lat: 3.083, lng: 101.589 }, to: { lat: 3.146262, lng: 101.711224 }, departAt: AT_0800 },
  { name: "Q4 300 m walk", from: { lat: 3.118231, lng: 101.63065 }, to: { lat: 3.120929, lng: 101.63065 }, departAt: AT_0800 },
  {
    name: "Q5 rail expired",
    from: { lat: 3.118231, lng: 101.63065 },
    to: { lat: 3.158935, lng: 101.713287 },
    departAt: AT_0800,
    exclude: ["rail"],
  },
];

/** Reads every fixture zip once. */
export function readFixtureFeeds(zips: Record<FeedId, Uint8Array>): NormalisedFeed[] {
  return FEED_IDS.map((f) => readFeed(zips[f], f));
}

/** Compiles the fixture feeds for {@link SERVICE_DATE}, with `exclude` marked not included. */
export function compileFixtures(feeds: readonly NormalisedFeed[], exclude: readonly FeedId[] = []): TransitNetwork {
  const out: CompileFeeds = {};
  for (const data of feeds) {
    out[data.feed] = {
      data,
      meta: { fetchedAt: 1, hash: `h-${data.feed}`, validUntil: data.validUntil, included: !exclude.includes(data.feed) },
    };
  }
  return compileNetworkSync(out, SERVICE_DATE, { builtAt: 0 });
}

/** Stops within 1,000 m of a point, nearest {@link ACCESS_CAP}, with their walk. */
export function accessStops(
  net: TransitNetwork,
  at: { lat: number; lng: number },
  walkMetersPerMin = WALKING_METERS_PER_MINUTE,
): StopTime[] {
  const out: StopTime[] = [];
  for (const stop of stopsNear(net, at.lat, at.lng, ACCESS_RADIUS_M)) {
    const meters = haversineMeters(at, { lat: net.stops.lat[stop], lng: net.stops.lon[stop] });
    out.push({ stop, meters, seconds: Math.ceil((meters * DETOUR_FACTOR) / (walkMetersPerMin / 60)) });
  }
  return out.sort((a, b) => a.meters - b.meters || a.stop - b.stop).slice(0, ACCESS_CAP);
}

export interface PreparedQuery {
  query: BenchQuery;
  net: TransitNetwork;
  access: StopTime[];
  egress: StopTime[];
  /** Departure, seconds after the service day's midnight. */
  t0: number;
}

/** Access, egress and `t0` for each golden, on `full` or (rail excluded) `noRail`. */
export function prepareQueries(full: TransitNetwork, noRail: TransitNetwork): PreparedQuery[] {
  return GOLDEN_QUERIES.map((query) => {
    const net = query.exclude?.includes("rail") ? noRail : full;
    const parts = toMalaysiaParts(new Date(query.departAt));
    if (parts.ymd !== net.meta.serviceDate) throw new Error(`${query.name}: departs on ${parts.ymd}, not ${net.meta.serviceDate}`);
    return { query, net, access: accessStops(net, query.from), egress: accessStops(net, query.to), t0: parts.secSinceMidnight };
  });
}

export interface Percentiles { p50: number; p95: number; max: number }

/** Nearest-rank p50 / p95 and the max of `samples` (ms). */
export function percentiles(samples: readonly number[]): Percentiles {
  const s = [...samples].sort((a, b) => a - b);
  const rank = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  return { p50: rank(0.5), p95: rank(0.95), max: s[s.length - 1] };
}

/** Bytes in every typed array of the network (the grid's cells included). */
export function networkBytes(net: TransitNetwork): number {
  let bytes = 0;
  const add = (o: object) => {
    for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) bytes += v.byteLength;
  };
  add(net.stops);
  add(net.patterns);
  add(net.stopRoutes);
  add(net.transfers);
  for (const cell of net.grid.cells.values()) bytes += cell.byteLength;
  return bytes;
}

/** Bytes `raptorProto` allocates per call (mirrors its `State`). */
export function engineBytes(net: TransitNetwork, maxRides: number): number {
  const n = net.stops.count;
  const perRound = (maxRides + 1) * n * (4 + 1 + 4); // tau, rode, rideTau
  const perStop = n * (4 + 1 + 4 + 4 + 1 + 4); // tauStar, marked, markedList, rideStar, footMarked, footList
  return perRound + perStop + net.patterns.count * 8; // queuePos, queueList
}

/** `HH:MM` of an arrival, or `—` when unreached. */
export function clock(seconds: number): string {
  return seconds >= INF ? "—" : secondsToClockHHMM(seconds);
}
