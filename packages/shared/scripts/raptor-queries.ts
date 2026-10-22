/**
 * Plan 14/00: the five golden queries (plan 14/06) and timing helpers shared
 * by the Node bench (bench-raptor.ts) and the throwaway device harness
 * (apps/mobile/app/dev-planner.tsx). Since 14/03 access and egress are the
 * engine's `accessStops` (≤ 25 stops within 1,000 m, coverage-pruned, walked
 * at 80 m/min × 1.25, spec §4.1), and the walk-only option is ranked too.
 * Since 14/02 the bench times {@link rankedRange} (`rangeRaptor` +
 * `rankCandidates`); the device harness still times {@link rangeArrival}, the
 * 14/01 earliest-arrival stand-in, until 14/04's `planSync`.
 */
import { accessStops, egressStops } from "../src/transit/access.js";
import { compileNetworkSync, type CompileFeeds } from "../src/transit/compile.js";
import { readFeed, type NormalisedFeed } from "../src/transit/feeds.js";
import { FEED_IDS, type FeedId, type TransitNetwork } from "../src/transit/network.js";
import { INF, MAX_RIDES, runRounds, startDeparture, type StopTime } from "../src/transit/raptor.js";
import { RANGE_STEP_SEC, RANGE_WINDOW_SEC, rangeRaptor, type RawJourney } from "../src/transit/range.js";
import { patternMask } from "../src/transit/modes.js";
import type { Place } from "../src/transit/plan.js";
import { rankCandidates, summarize, type Candidate, type Ranked } from "../src/transit/rank.js";
import { sameSpot, walkOnlyCandidate } from "../src/transit/walk.js";
import { resetWorkspace, workspaceFor } from "../src/transit/workspace.js";
import { secondsToClockHHMM, toMalaysiaParts } from "../src/utils/gtfs-time.js";
import { WALKING_METERS_PER_MINUTE } from "../src/utils/rail.js";

export const SERVICE_DATE = "20261028";
/** 2026-10-28 08:00 MYT. */
export const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);

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

/** A golden end as a coordinate {@link Place}. */
const placeOf = (name: string, at: { lat: number; lng: number }): Place => ({ kind: "place", name, lat: at.lat, lng: at.lng });

/** 14/03's access, egress and walk-only option for one golden, every pattern allowed, 80 m/min. */
export function queryEnds(net: TransitNetwork, query: BenchQuery, t0: number): Pick<PreparedQuery, "access" | "egress" | "walk" | "same"> {
  const from = placeOf(query.name, query.from);
  const to = placeOf(query.name, query.to);
  const o = { walkMetersPerMin: WALKING_METERS_PER_MINUTE, allowed: patternMask(net) };
  const access = accessStops(net, from, o);
  const egress = egressStops(net, to, o);
  return { access, egress, walk: walkOnlyCandidate(from, to, t0, WALKING_METERS_PER_MINUTE), same: sameSpot(access, egress, { from, to }) };
}

export interface PreparedQuery {
  query: BenchQuery;
  net: TransitNetwork;
  access: StopTime[];
  egress: StopTime[];
  /** The walk-only option, or `null` from 2 km walked. */
  walk: Candidate | null;
  /** Both ends one spot (14/03 step 6): walk-only, no RAPTOR. */
  same: boolean;
  /** Departure, seconds after the service day's midnight. */
  t0: number;
}

/** Access, egress and `t0` for each golden, on `full` or (rail excluded) `noRail`. */
export function prepareQueries(full: TransitNetwork, noRail: TransitNetwork): PreparedQuery[] {
  return GOLDEN_QUERIES.map((query) => {
    const net = query.exclude?.includes("rail") ? noRail : full;
    const parts = toMalaysiaParts(new Date(query.departAt));
    if (parts.ymd !== net.meta.serviceDate) throw new Error(`${query.name}: departs on ${parts.ymd}, not ${net.meta.serviceDate}`);
    const t0 = parts.secSinceMidnight;
    return { query, net, ...queryEnds(net, query, t0), t0 };
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

/** Bytes in the network's engine workspace (allocated once per network, see `workspaceFor`). */
export function engineBytes(net: TransitNetwork): number {
  let bytes = 0;
  for (const v of Object.values(workspaceFor(net))) if (ArrayBuffer.isView(v)) bytes += v.byteLength;
  return bytes;
}

export interface RangeOptions {
  /** Range width after `t0` (default 2400 s, the 40-min window). */
  windowSec?: number;
  /** Gap between range departures (default 120 s). */
  stepSec?: number;
  /** Rounds, one per ride (default and cap {@link MAX_RIDES}). */
  maxRides?: number;
}

export interface RangeResult {
  /** Best egress arrival over the range, seconds after service-day midnight; `INF` if none. */
  arrive: number;
  /** Rounds scanned, summed over every range departure. */
  rounds: number;
  /** Range departures run. */
  runs: number;
}

/**
 * The benchmark's query until 14/02's `plan()`: `runRounds` at `t0 +
 * windowSec`, then every `stepSec` earlier down to `t0`, keeping labels
 * between departures (rRAPTOR), every pattern allowed, 80 m/min. Yields after
 * each round (drive it with `runSteps`).
 */
export function* rangeArrivalSteps(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts: RangeOptions = {},
): Generator<void, RangeResult, void> {
  const windowSec = opts.windowSec ?? 2400;
  const stepSec = Math.max(1, opts.stepSec ?? 120);
  const maxRides = Math.min(opts.maxRides ?? MAX_RIDES, MAX_RIDES);
  const allowed = patternMask(net);
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  const input = { egress, maxRides, allowed, walkMetersPerMin: WALKING_METERS_PER_MINUTE };
  let rounds = 0;
  let runs = 0;
  for (let dep = t0 + windowSec; dep >= t0; dep -= stepSec) {
    runs++;
    startDeparture(ws, access, dep);
    const steps = runRounds(net, ws, input);
    while (!steps.next().done) {
      rounds++;
      yield;
    }
  }
  return { arrive: ws.destBest[maxRides], rounds, runs };
}

/** {@link rangeArrivalSteps} drained in one go: the JS time of one query. */
export function rangeArrival(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts?: RangeOptions,
): RangeResult {
  const steps = rangeArrivalSteps(net, access, egress, t0, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export interface RankedResult {
  /** `rangeRaptor`'s Pareto set. */
  journeys: RawJourney[];
  /** At most five, the fastest first. */
  ranked: Ranked[];
  /** Rounds scanned, summed over every range departure. */
  rounds: number;
  /** Range departures run. */
  runs: number;
}

export interface RankedOptions extends RangeOptions {
  /** 14/03's walk-only option, ranked with the journeys. */
  walk?: Candidate | null;
  /** Both ends one spot: skip RAPTOR, rank the walk alone. */
  same?: boolean;
}

/**
 * Plan 14/02's query: `rangeRaptor` over the window, then `summarize` and
 * `rankCandidates` with the walk-only option (14/03), every pattern allowed,
 * 80 m/min. Yields wherever `rangeRaptor` does (drive it with `runSteps`).
 */
export function* rankedRangeSteps(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts: RankedOptions = {},
): Generator<void, RankedResult, void> {
  const windowSec = Math.max(0, opts.windowSec ?? RANGE_WINDOW_SEC);
  const stepSec = Math.max(1, opts.stepSec ?? RANGE_STEP_SEC);
  const cands: Candidate[] = opts.walk ? [opts.walk] : [];
  if (opts.same) return { journeys: [], ranked: rankCandidates(cands, t0), rounds: 0, runs: 0 };
  const allowed = patternMask(net);
  const steps = rangeRaptor(net, { access, egress, t0, windowSec, stepSec, maxRides: opts.maxRides, allowed, walkMetersPerMin: WALKING_METERS_PER_MINUTE });
  let yields = 0;
  let journeys: RawJourney[];
  for (;;) {
    const step = steps.next();
    if (step.done) {
      journeys = step.value;
      break;
    }
    yields++;
    yield;
  }
  const runs = Math.floor(windowSec / stepSec) + 1;
  const ranked = rankCandidates([...journeys.map((j) => summarize(net, j, t0)), ...cands], t0);
  // rangeRaptor yields once per round and once per run.
  return { journeys, ranked, rounds: yields - runs, runs };
}

/** {@link rankedRangeSteps} drained in one go: the JS time of one query. */
export function rankedRange(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts?: RankedOptions,
): RankedResult {
  const steps = rankedRangeSteps(net, access, egress, t0, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** `HH:MM` of an arrival, or `—` when unreached. */
export function clock(seconds: number): string {
  return seconds >= INF ? "—" : secondsToClockHHMM(seconds);
}
