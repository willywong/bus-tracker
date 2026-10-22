/**
 * Plan 14/00 step 3: times `planSync` (plan 14/04: access and egress, range
 * RAPTOR, ranking and itinerary reconstruction) end to end on the fixture
 * network for the five golden queries (see raptor-queries.ts), then prints
 * each query's itineraries. For comparison it also times `rankedRange` (the
 * range and ranking alone on precomputed access and egress, 14/02) at
 * `--window`, and `queryEnds` (14/03) as `ends ms`.
 *
 *   pnpm --filter @bus-tracker/shared exec tsx scripts/bench-raptor.ts [--window 2400|1200] [--step 120] [--rides 4]
 *
 * `planSync` always uses `PLAN_WINDOW_SEC` and the 2-min step; `--window` and
 * `--step` only change the `rankedRange` columns. Add `--expose-gc` after
 * `tsx` to collect the feed-parse garbage before the timed runs; without it a
 * GC pause can land in one query's max (~10 ms).
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { FEED_IDS, type FeedId, type TransitNetwork } from "../src/transit/network.js";
import { PLAN_WINDOW_SEC, planSync, type Leg, type LegPoint, type PlanResult } from "../src/transit/plan.js";
import { toServiceSeconds } from "../src/transit/time.js";
import {
  clock,
  compileFixtures,
  engineBytes,
  FIXTURE_ZIPS,
  networkBytes,
  percentiles,
  prepareQueries,
  queryEnds,
  rankedRange,
  readFixtureFeeds,
  type RankedResult,
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
console.log(`plan window ${PLAN_WINDOW_SEC} s; range columns at window ${opts.windowSec} s`);
console.log(
  "query                 | access | egress | ends ms | arrive | pareto | its | runs | rounds | plan p50 | plan p95 | plan max | range p50 | range p95",
);
const results: PlanResult[] = [];
for (const q of queries) {
  const plan = { ...q.plan, maxRides: opts.maxRides };
  const qOpts = { ...opts, walk: q.walk, same: q.same };
  const endSamples: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const s = performance.now();
    queryEnds(q.net, q.query, q.t0);
    if (i >= WARMUP) endSamples.push(performance.now() - s);
  }
  for (let i = 0; i < WARMUP; i++) planSync(q.net, plan);
  const samples: number[] = [];
  let result = planSync(q.net, plan);
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    result = planSync(q.net, plan);
    samples.push(performance.now() - s);
  }
  results.push(result);
  for (let i = 0; i < WARMUP; i++) rankedRange(q.net, q.access, q.egress, q.t0, qOpts);
  const rangeSamples: number[] = [];
  let ranked: RankedResult = rankedRange(q.net, q.access, q.egress, q.t0, qOpts);
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    ranked = rankedRange(q.net, q.access, q.egress, q.t0, qOpts);
    rangeSamples.push(performance.now() - s);
  }
  const p = percentiles(samples);
  const r = percentiles(rangeSamples);
  const first = result.itineraries[0];
  console.log(
    [
      q.query.name.padEnd(21),
      String(q.access.length).padStart(6),
      String(q.egress.length).padStart(6),
      percentiles(endSamples).p50.toFixed(2).padStart(7),
      clock(first ? toServiceSeconds(q.net, first.arriveAt) : Infinity).padStart(6),
      String(ranked.journeys.length).padStart(6),
      String(result.itineraries.length).padStart(3),
      String(ranked.runs).padStart(4),
      String(ranked.rounds).padStart(6),
      p.p50.toFixed(2).padStart(8),
      p.p95.toFixed(2).padStart(8),
      p.max.toFixed(2).padStart(8),
      r.p50.toFixed(2).padStart(9),
      r.p95.toFixed(2).padStart(9),
    ].join(" | "),
  );
}
const heapAfter = process.memoryUsage().heapUsed;
console.log(`heapUsed before ${mb(heapBefore)}, after ${mb(heapAfter)}`);

/** One leg as text: `walk 240 m 4 min`, `T816 HOTEL LISA 08:07 → … 08:20 (12 stops)`, `~` for a headway time. */
function legText(net: TransitNetwork, l: Leg): string {
  const hm = (p: LegPoint) => clock(toServiceSeconds(net, p.time));
  if (l.kind === "walk") return `walk ${l.meters} m ${Math.round(l.seconds / 60)} min`;
  const how = l.timing.kind === "headway" ? "~" : "";
  return `${l.label} ${l.from.name} ${how}${hm(l.from)} → ${l.to.name} ${how}${hm(l.to)} (${l.via.length + 1} stops)`;
}

for (const [i, q] of queries.entries()) {
  const res = results[i];
  console.log(`\n${q.query.name}: ${res.itineraries.length} itineraries, excludedFeeds ${JSON.stringify(res.excludedFeeds)}`);
  for (const it of res.itineraries) {
    const at = (ms: number) => clock(toServiceSeconds(q.net, ms));
    console.log(
      `  ${it.id} ${at(it.departAt)}→${at(it.arriveAt)} ${it.rides} rides, walk ${it.walkMeters} m` +
        `${it.tags.length ? ` [${it.tags.join(", ")}]` : ""}${it.warnings.length ? ` !${it.warnings.join(", ")}` : ""}\n` +
        `    ${it.legs.map((l) => legText(q.net, l)).join(" · ")}`,
    );
  }
}
