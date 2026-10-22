import { RAIL_INTERCHANGES, type Interchange } from "../data/rail-interchanges.js";
import { haversineMeters } from "../utils/outlier.js";
import { WALKING_METERS_PER_MINUTE } from "../utils/rail.js";
import { stopsNear } from "./compile.js";
import { FEED_IDS, feedOfStopId, TRANSFER_KIND, type TransitNetwork } from "./network.js";

/** Stops this close (straight line) get a walking transfer. */
export const PROXIMITY_METERS = 250;
/** A platform change between two stops of one merged station. */
export const STATION_CHANGE_SECONDS = 180;
/** Added to every proximity walk: finding the stop. */
export const FIND_STOP_SECONDS = 60;
/** Streets are longer than the straight line. */
export const DETOUR_FACTOR = 1.25;

/**
 * Stops scanned for neighbours between yields. A dense-city stop costs ~4 µs
 * on Node, so a step stays ~0.3 ms there and a few ms on Hermes.
 */
const NEAR_STOPS_PER_YIELD = 64;
/** Pairs written into the CSR, or stops whose run is sorted, between yields. */
const PAIRS_PER_YIELD = 8192;

type Transfers = TransitNetwork["transfers"];
interface Candidate { seconds: number; kind: number }

/** Spec §3.4: `ceil(meters × 1.25 / walk speed) + 60` seconds. */
export function walkSeconds(meters: number, metersPerMin = WALKING_METERS_PER_MINUTE): number {
  return Math.ceil((meters * DETOUR_FACTOR) / (metersPerMin / 60)) + FIND_STOP_SECONDS;
}

/** Which source wins a pair: curated (2) over same station (1) over proximity (0). */
export function transferPriority(kind: number): number {
  if (kind === TRANSFER_KIND.interchange || kind === TRANSFER_KIND.interchangeVerified) return 2;
  return kind === TRANSFER_KIND.station ? 1 : 0;
}

/**
 * Builds `net.transfers` (CSR by from-stop) from proximity, same-station and
 * the curated table, as a generator. Pairs are symmetric. When a pair has
 * more than one source the most specific wins, even if it is slower; within
 * one source the shorter time wins. Each stop's transfers are sorted by
 * seconds, then by `to`.
 */
export function* buildTransfersSteps(
  net: TransitNetwork,
  curated: readonly Interchange[] = RAIL_INTERCHANGES,
): Generator<void, Transfers, void> {
  const { count: n, lat, lon, station, id } = net.stops;
  const pairs = new Map<number, Candidate>();
  const put = (from: number, to: number, seconds: number, kind: number) => {
    for (const key of [from * n + to, to * n + from]) {
      const old = pairs.get(key);
      const p = transferPriority(kind);
      const q = old ? transferPriority(old.kind) : -1;
      if (p > q || (p === q && seconds < old!.seconds)) pairs.set(key, { seconds, kind });
    }
  };

  // Proximity. Each pair is found from both ends; take it once.
  for (let i = 0; i < n; i++) {
    if ((i + 1) % NEAR_STOPS_PER_YIELD === 0) yield;
    const here = { lat: lat[i], lng: lon[i] };
    for (const j of stopsNear(net, lat[i], lon[i], PROXIMITY_METERS)) {
      if (j <= i) continue;
      put(i, j, walkSeconds(haversineMeters(here, { lat: lat[j], lng: lon[j] })), TRANSFER_KIND.walk);
    }
  }

  // Same station.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (station[i] < 0) continue;
    const list = members.get(station[i]);
    if (list) list.push(i);
    else members.set(station[i], [i]);
  }
  for (const list of members.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) put(list[x], list[y], STATION_CHANGE_SECONDS, TRANSFER_KIND.station);
    }
  }

  // Curated. An id missing from an included feed is a feed change, not a crash;
  // one from an excluded feed is expected.
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(id[i], i);
  const feedsIn = new Set<number>(net.stops.feed);
  const missing = new Set<string>();
  for (const x of curated) {
    const a = index.get(x.a);
    const b = index.get(x.b);
    if (a === undefined || b === undefined) {
      for (const s of [x.a, x.b]) {
        if (!index.has(s) && feedsIn.has(FEED_IDS.indexOf(feedOfStopId(s)))) missing.add(s);
      }
      continue;
    }
    if (a === b) continue;
    put(a, b, x.seconds, x.verified ? TRANSFER_KIND.interchangeVerified : TRANSFER_KIND.interchange);
  }
  if (missing.size) {
    console.warn(`buildTransfers: curated interchange ids not in the network, skipped: ${[...missing].join(", ")}`);
  }

  // CSR: count per from-stop, place, then sort each stop's run.
  const start = new Int32Array(n);
  const len = new Int32Array(n);
  for (const key of pairs.keys()) len[Math.floor(key / n)]++;
  for (let i = 1; i < n; i++) start[i] = start[i - 1] + len[i - 1];
  const to = new Int32Array(pairs.size);
  const seconds = new Int32Array(pairs.size);
  const kind = new Uint8Array(pairs.size);
  const fill = new Int32Array(n);
  let work = 0;
  for (const [key, c] of pairs) {
    if (++work % PAIRS_PER_YIELD === 0) yield;
    const from = Math.floor(key / n);
    const at = start[from] + fill[from]++;
    to[at] = key - from * n;
    seconds[at] = c.seconds;
    kind[at] = c.kind;
  }
  for (let i = 0; i < n; i++) {
    if ((i + 1) % PAIRS_PER_YIELD === 0) yield;
    sortRun(to, seconds, kind, start[i], start[i] + len[i]);
  }
  return { start, len, to, seconds, kind };
}

/** Drains {@link buildTransfersSteps} in one go, for tests and scripts. */
export function buildTransfers(net: TransitNetwork, curated?: readonly Interchange[]): Transfers {
  const steps = buildTransfersSteps(net, curated);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Insertion sort of `[lo, hi)` by seconds, then `to`; runs are short (one stop's neighbours). */
function sortRun(to: Int32Array, seconds: Int32Array, kind: Uint8Array, lo: number, hi: number): void {
  for (let k = lo + 1; k < hi; k++) {
    const t = to[k];
    const s = seconds[k];
    const d = kind[k];
    let m = k - 1;
    while (m >= lo && (seconds[m] > s || (seconds[m] === s && to[m] > t))) {
      to[m + 1] = to[m];
      seconds[m + 1] = seconds[m];
      kind[m + 1] = kind[m];
      m--;
    }
    to[m + 1] = t;
    seconds[m + 1] = s;
    kind[m + 1] = d;
  }
}
