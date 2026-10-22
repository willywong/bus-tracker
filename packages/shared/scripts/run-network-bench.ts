/**
 * Node run of the plan 12/00 network bench (see network-bench.ts):
 *
 *   pnpm -C packages/shared exec tsx scripts/run-network-bench.ts <fixture dir> <YYYYMMDD>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_FEEDS, formatTimings, runInSlicesMeasured, runSyncPass, slicedPassSteps } from "./network-bench.js";

const [dir, ymd] = process.argv.slice(2);
const zips = BENCH_FEEDS.map((feed) => ({ feed, zip: new Uint8Array(readFileSync(join(dir, feed.file))) }));
console.log(formatTimings("sync pass (Node)", runSyncPass(zips, ymd)));
const stages: Array<[string, number]> = [];
const { value, stats } = await runInSlicesMeasured(slicedPassSteps(zips, ymd, stages), 8);
console.log(formatTimings("sliced pass (Node, 8 ms slices)", { stages, net: value }));
console.log(
  `  wall ${stats.wallMs.toFixed(0)} ms, busy ${stats.busyMs.toFixed(0)} ms, ${stats.slices} slices, longest ${stats.longestSliceMs.toFixed(1)} ms`,
);