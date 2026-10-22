import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { RAIL_INTERCHANGES, type Interchange } from "../../data/rail-interchanges.js";
import { haversineMeters } from "../../utils/outlier.js";
import { compileNetworkSync, type CompileFeeds } from "../compile.js";
import { readFeed, type NormalisedFeed } from "../feeds.js";
import { FEED_IDS, TRANSFER_KIND, type FeedId, type TransitNetwork } from "../network.js";
import {
  buildTransfers,
  DETOUR_FACTOR,
  FIND_STOP_SECONDS,
  PROXIMITY_METERS,
  STATION_CHANGE_SECONDS,
  transferPriority,
  walkSeconds,
} from "../transfers.js";

const WED = "20261028";
/** Metres per degree of latitude at the haversine's Earth radius. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

/** A synthetic feed holding only `stops` (`id,name,lat,lon` rows); no trips. */
function stopsFeed(feed: FeedId, stops: string): NormalisedFeed {
  const files: Record<string, string> = {
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n",
    "routes.txt": "route_id,route_short_name,route_long_name\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n" + stops,
    "trips.txt": "route_id,service_id,trip_id\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n",
  };
  return readFeed(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))), feed);
}

function feedsOf(list: readonly NormalisedFeed[]): CompileFeeds {
  const out: CompileFeeds = {};
  for (const data of list) {
    out[data.feed] = { data, meta: { fetchedAt: 1, hash: "h", validUntil: data.validUntil, included: true } };
  }
  return out;
}

/** Compiles `list`, then rebuilds its transfers from `curated` (none by default). */
function synthetic(list: readonly NormalisedFeed[], curated: readonly Interchange[] = []): TransitNetwork {
  const net = compileNetworkSync(feedsOf(list), WED, { builtAt: 0 });
  net.transfers = buildTransfers(net, curated);
  return net;
}

/** The `from → to` transfer, by stop id, or undefined. */
function transfer(net: TransitNetwork, from: string, to: string): { seconds: number; kind: number } | undefined {
  const i = net.stops.id.indexOf(from);
  const j = net.stops.id.indexOf(to);
  assert.ok(i >= 0 && j >= 0, `${from} / ${to} in network`);
  const t = net.transfers;
  for (let k = t.start[i]; k < t.start[i] + t.len[i]; k++) {
    if (t.to[k] === j) return { seconds: t.seconds[k], kind: t.kind[k] };
  }
  return undefined;
}

function distance(net: TransitNetwork, i: number, j: number): number {
  return haversineMeters({ lat: net.stops.lat[i], lng: net.stops.lon[i] }, { lat: net.stops.lat[j], lng: net.stops.lon[j] });
}

/** A latitude `m` metres north of `lat`. */
const north = (lat: number, m: number) => (lat + m / M_PER_DEG).toFixed(7);

test("walkSeconds is ceil(m × 1.25 / walk speed) + 60", () => {
  assert.equal(walkSeconds(100), Math.ceil((100 * 1.25) / (80 / 60)) + 60);
  assert.equal(walkSeconds(0), FIND_STOP_SECONDS);
  assert.equal(walkSeconds(100, 60), Math.ceil(100 * DETOUR_FACTOR) + 60);
});

test("transferPriority: curated > station > walk", () => {
  assert.equal(transferPriority(TRANSFER_KIND.interchangeVerified), transferPriority(TRANSFER_KIND.interchange));
  assert.ok(transferPriority(TRANSFER_KIND.interchange) > transferPriority(TRANSFER_KIND.station));
  assert.ok(transferPriority(TRANSFER_KIND.station) > transferPriority(TRANSFER_KIND.walk));
});

test("same-station beats proximity", (t) => {
  t.mock.method(console, "warn", () => {}); // the tiny rail feed lacks the curated ids
  // KJ15 and MR1 share the KL Sentral station in RAIL_STATIONS; no curated table.
  const net = synthetic([stopsFeed("rail", `KJ15,KL SENTRAL,3.1340000,101.6860000\nMR1,KL SENTRAL,${north(3.134, 50)},101.6860000\n`)]);
  assert.equal(net.stops.station[0], net.stops.station[1]);
  assert.deepEqual(transfer(net, "rail:KJ15", "rail:MR1"), { seconds: STATION_CHANGE_SECONDS, kind: TRANSFER_KIND.station });
  assert.deepEqual(transfer(net, "rail:MR1", "rail:KJ15"), { seconds: STATION_CHANGE_SECONDS, kind: TRANSFER_KIND.station });
});

test("same priority keeps the smaller time", () => {
  const feed = stopsFeed("feeder", `A,Stop A,3.1000000,101.6000000\nB,Stop B,${north(3.1, 2000)},101.6000000\n`);
  const entry = (a: string, b: string, seconds: number, verified = false): Interchange => ({ a, b, seconds, note: "", verified });
  // Two curated candidates for one pair, larger first, one written b → a.
  const net = synthetic([feed], [entry("A", "B", 400), entry("B", "A", 250), entry("A", "B", 300, true)]);
  assert.deepEqual(transfer(net, "A", "B"), { seconds: 250, kind: TRANSFER_KIND.interchange });
  assert.deepEqual(transfer(net, "B", "A"), { seconds: 250, kind: TRANSFER_KIND.interchange });
});

test("proximity pairs are within 250 m and exclude self", () => {
  const net = synthetic([
    stopsFeed(
      "feeder",
      `A,Stop A,3.1000000,101.6000000\nB,Stop B,${north(3.1, 200)},101.6000000\nC,Stop C,${north(3.1, 300)},101.6000000\n`,
    ),
  ]);
  const [a, b, c] = [0, 1, 2];
  assert.deepEqual(transfer(net, "A", "B"), { seconds: walkSeconds(distance(net, a, b)), kind: TRANSFER_KIND.walk });
  assert.deepEqual(transfer(net, "B", "C"), { seconds: walkSeconds(distance(net, b, c)), kind: TRANSFER_KIND.walk });
  assert.equal(transfer(net, "A", "C"), undefined);
  assert.ok(distance(net, a, c) > PROXIMITY_METERS);
  for (const s of ["A", "B", "C"]) assert.equal(transfer(net, s, s), undefined);
  assert.deepEqual(Array.from(net.transfers.len), [1, 2, 1]);
});

test("stops in different feeds link by proximity", (t) => {
  t.mock.method(console, "warn", () => {});
  const net = synthetic([
    stopsFeed("rail", "KJ1,GOMBAK,3.2310000,101.7240000\n"),
    stopsFeed("feeder", `F1,Gombak bus stop,${north(3.231, 120)},101.7240000\n`),
  ]);
  const link = transfer(net, "rail:KJ1", "F1");
  assert.ok(link);
  assert.equal(link.kind, TRANSFER_KIND.walk);
  assert.equal(link.seconds, walkSeconds(distance(net, 0, 1)));
  assert.deepEqual(transfer(net, "F1", "rail:KJ1"), link);
});

test("verified curated entries get kind interchangeVerified", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const net = synthetic(
    [stopsFeed("rail", "KJ1,GOMBAK,3.2310000,101.7240000\n"), stopsFeed("feeder", "F1,Far stop,3.3000000,101.7000000\n")],
    [
      { a: "rail:KJ1", b: "F1", seconds: 600, note: "Walk", verified: true },
      { a: "rail:KJ1", b: "rail:GONE", seconds: 60, note: "Walk", verified: false },
    ],
  );
  assert.deepEqual(transfer(net, "rail:KJ1", "F1"), { seconds: 600, kind: TRANSFER_KIND.interchangeVerified });
  assert.deepEqual(transfer(net, "F1", "rail:KJ1"), { seconds: 600, kind: TRANSFER_KIND.interchangeVerified });
  // The unresolved id is skipped with a warning, not a crash.
  assert.equal(net.transfers.to.length, 2);
  assert.match(String(warn.mock.calls.at(-1)?.arguments[0]), /skipped: rail:GONE$/);
});

// ---------------------------------------------------------------------------
// Fixture feeds, captured 2026-10-23
// ---------------------------------------------------------------------------

const FIXTURES = new URL("../__fixtures__/2026-10-23/", import.meta.url);
const ZIP: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};
let fixtureNet: TransitNetwork | null = null;
function fixtureNetwork(): TransitNetwork {
  fixtureNet ??= compileNetworkSync(
    feedsOf(FEED_IDS.map((f) => readFeed(new Uint8Array(readFileSync(new URL(ZIP[f], FIXTURES))), f))),
    WED,
    { builtAt: 0 },
  );
  return fixtureNet;
}

test("every curated interchange id exists in the fixture network", () => {
  const ids = new Set(fixtureNetwork().stops.id);
  for (const id of ["ktm:19100", "ktm:19000", "ktm:18900", "ktm:53700", "ktm:53600", "ktm:52700"]) {
    assert.ok(RAIL_INTERCHANGES.some((x) => x.a === id || x.b === id), `${id} is curated`);
  }
  for (const { a, b } of RAIL_INTERCHANGES) {
    assert.ok(ids.has(a), `${a} resolves`);
    assert.ok(ids.has(b), `${b} resolves`);
  }
  assert.ok(RAIL_INTERCHANGES.every((x) => !x.verified));
});

test("transfers are symmetric", () => {
  const net = fixtureNetwork();
  const t = net.transfers;
  for (let i = 0; i < net.stops.count; i++) {
    for (let k = t.start[i]; k < t.start[i] + t.len[i]; k++) {
      const back = transfer(net, net.stops.id[t.to[k]], net.stops.id[i]);
      assert.deepEqual(back, { seconds: t.seconds[k], kind: t.kind[k] }, `${net.stops.id[i]} ↔ ${net.stops.id[t.to[k]]}`);
    }
  }
});

test("curated overrides same-station even when slower", () => {
  const net = fixtureNetwork();
  const kj15 = net.stops.id.indexOf("rail:KJ15");
  assert.equal(net.stops.station[kj15], net.stops.station[net.stops.id.indexOf("rail:MR1")]);
  assert.deepEqual(transfer(net, "rail:KJ15", "rail:MR1"), { seconds: 480, kind: TRANSFER_KIND.interchange });
  assert.deepEqual(transfer(net, "rail:MR1", "rail:KJ15"), { seconds: 480, kind: TRANSFER_KIND.interchange });
});

test("curated overrides same-station when faster", () => {
  const net = fixtureNetwork();
  assert.deepEqual(transfer(net, "rail:KJ37", "rail:SP31"), { seconds: 60, kind: TRANSFER_KIND.interchange });
});

test("curated Pasar Seni KJ14 → KG16 is 240 s, not the 180 s station default", () => {
  const net = fixtureNetwork();
  assert.deepEqual(transfer(net, "rail:KJ14", "rail:KG16"), { seconds: 240, kind: TRANSFER_KIND.interchange });
});

test("CSR is sorted and lengths sum to the pair count", () => {
  const net = fixtureNetwork();
  const t = net.transfers;
  assert.equal(t.start.length, net.stops.count);
  assert.equal(t.len.length, net.stops.count);
  let sum = 0;
  const byKind = [0, 0, 0, 0];
  for (let i = 0; i < net.stops.count; i++) {
    assert.equal(t.start[i], sum, `start[${i}]`);
    sum += t.len[i];
    for (let k = t.start[i]; k < t.start[i] + t.len[i]; k++) {
      byKind[t.kind[k]]++;
      assert.notEqual(t.to[k], i);
      if (k > t.start[i]) {
        assert.ok(t.seconds[k - 1] < t.seconds[k] || (t.seconds[k - 1] === t.seconds[k] && t.to[k - 1] < t.to[k]), `order at ${i}`);
      }
    }
  }
  assert.equal(sum, t.to.length);
  assert.equal(t.seconds.length, sum);
  assert.equal(t.kind.length, sum);
  assert.ok(sum > 10_000, `${sum} pairs`);
  console.log(
    `transfers ${WED}: ${sum} pairs, average degree ${(sum / net.stops.count).toFixed(2)}; ` +
      `walk ${byKind[TRANSFER_KIND.walk]}, station ${byKind[TRANSFER_KIND.station]}, ` +
      `interchange ${byKind[TRANSFER_KIND.interchange]}, verified ${byKind[TRANSFER_KIND.interchangeVerified]}`,
  );
});
