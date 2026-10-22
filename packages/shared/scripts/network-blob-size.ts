/**
 * Plan 12/05: compile the four fixture feeds for one service date, encode
 * the network and print the blob size, per section and gzipped (the spec
 * §3.5 fallback's download size), plus encode/decode times on Node.
 *
 *   pnpm -C packages/shared exec tsx scripts/network-blob-size.ts <fixturesDir> <YYYYMMDD>
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "fflate";
import { compileNetworkSync, type CompileFeeds } from "../src/transit/compile.js";
import { readFeed } from "../src/transit/feeds.js";
import { FEED_IDS, type FeedId } from "../src/transit/network.js";
import { decodeNetwork, encodeNetwork } from "../src/transit/serialize.js";

const ZIP: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};
const RUNS = 5;

const [dir, ymd] = process.argv.slice(2);
if (!dir || !/^\d{8}$/.test(ymd ?? "")) {
  console.error("usage: network-blob-size.ts <fixturesDir> <YYYYMMDD>");
  process.exit(1);
}

// `pnpm -C packages/shared` runs from the package, so a repo-relative dir is tried from the repo root too.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const root = [resolve(dir), resolve(repoRoot, dir)].find((d) => existsSync(d)) ?? resolve(dir);
const feeds: CompileFeeds = {};
for (const f of FEED_IDS) {
  const data = readFeed(new Uint8Array(readFileSync(resolve(root, ZIP[f]))), f);
  feeds[f] = { data, meta: { fetchedAt: 0, hash: "", validUntil: data.validUntil, included: true } };
}
const net = compileNetworkSync(feeds, ymd, { builtAt: 0 });

function median(fn: () => void): number {
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    fn();
    ms.push(performance.now() - t);
  }
  return ms.sort((a, b) => a - b)[RUNS >> 1];
}

const bytes = encodeNetwork(net);
const encodeMs = median(() => encodeNetwork(net));
const decodeMs = median(() => decodeNetwork(bytes));
const gz = gzipSync(bytes);

const kb = (n: number): string => `${(n / 1024).toFixed(1).padStart(8)} KB`;
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`;
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const KINDS = ["", "i32", "f32", "u8", "str", "json"];

console.log(`network ${ymd}: ${net.stops.count} stops, ${net.routes.count} routes, ${net.patterns.count} patterns, ${net.patterns.arr.length} stop events`);
console.log("section  kind      bytes");
let typed = 0;
for (let i = 0; i < dv.getUint16(6, true); i++) {
  const e = 12 + i * 16;
  const tag = String.fromCharCode(...bytes.subarray(e, e + 4));
  const kind = bytes[e + 4];
  const len = dv.getUint32(e + 12, true);
  if (kind <= 3) typed += len;
  console.log(`${tag}     ${KINDS[kind].padEnd(4)} ${kb(len)}`);
}
console.log(`typed arrays   ${kb(typed)}`);
console.log(`total          ${kb(bytes.byteLength)}  (${mb(bytes.byteLength)})`);
console.log(`gzip           ${kb(gz.byteLength)}  (${mb(gz.byteLength)})`);
console.log(`encode ${encodeMs.toFixed(1)} ms, decode ${decodeMs.toFixed(1)} ms (Node, median of ${RUNS})`);
