/**
 * Plan 14/00 step 3: times the RAPTOR core (`runRounds`, plan 14/01) as an
 * earliest-arrival range query (`rangeArrival`) on the fixture network for
 * the five golden queries (see raptor-queries.ts).
 *
 *   pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts [--window 2400|1200] [--step 120] [--rides 4]
 *
 * Add `--expose-gc` after `tsx` to collect the feed-parse garbage before the
 * timed runs; without it a GC pause can land in one query's max (~10 ms).
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { FEED_IDS, type FeedId } from "../src/transit/network.js";
import {
  clock,
  compileFixtures,
  engineBytes,
  FIXTURE_ZIPS,
  networkBytes,
  percentiles,
  prepareQueries,
  rangeArrival,
  readFixtureFeeds,
} from "./raptor-queries.js";

const WARMUP = 3;
const RUNS = 20;

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const opts = { windowSec: flag("window", 2400), stepSec: flag("step", 120), maxRides: flag("rides", 4) };
const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`;

const dir = new URL("../src/transit/__fixtures__/2026-10-23/", import.meta.url);
const zips = Object.fromEntries(FEED_IDS.map((f) => [f, new Uint8Array(readFileSync(new URL(FIXTURE_ZIPS[f], dir)))])) as Record<
  FeedId,
  Uint8Array
>;
let t = performance.now();
const feeds = readFixtureFeeds(zips);
console.log(`read fixtures: ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
const full = compileFixtures(feeds);
console.log(`compile 20261028: ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
const noRail = compileFixtures(feeds, ["rail"]);
console.log(`compile 20261028 without rail: ${(performance.now() - t).toFixed(0)} ms`);
console.log(
  `network: ${full.stops.count} stops, ${full.patterns.count} patterns; typed arrays ${mb(networkBytes(full))}; ` +
    `engine workspace per network ${mb(engineBytes(full))}`,
);
console.log(`window ${opts.windowSec} s, step ${opts.stepSec} s, ${opts.maxRides} rides; ${WARMUP} warm-up + ${RUNS} timed runs`);

const queries = prepareQueries(full, noRail);
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
console.log("query                 | access | egress | arrive | runs | rounds | p50 ms | p95 ms | max ms");
for (const q of queries) {
  for (let i = 0; i < WARMUP; i++) rangeArrival(q.net, q.access, q.egress, q.t0, opts);
  const samples: number[] = [];
  let result = rangeArrival(q.net, q.access, q.egress, q.t0, opts);
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    result = rangeArrival(q.net, q.access, q.egress, q.t0, opts);
    samples.push(performance.now() - s);
  }
  const p = percentiles(samples);
  console.log(
    [
      q.query.name.padEnd(21),
      String(q.access.length).padStart(6),
      String(q.egress.length).padStart(6),
      clock(result.arrive).padStart(6),
      String(result.runs).padStart(4),
      String(result.rounds).padStart(6),
      p.p50.toFixed(2).padStart(6),
      p.p95.toFixed(2).padStart(6),
      p.max.toFixed(2).padStart(6),
    ].join(" | "),
  );
}
const heapAfter = process.memoryUsage().heapUsed;
console.log(`heapUsed before ${mb(heapBefore)}, after ${mb(heapAfter)}`);
