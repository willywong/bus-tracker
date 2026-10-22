import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compileNetworkSync, GRID_CELL_DEG, gridKey, type CompileFeeds } from "../compile.js";
import { readFeed, type NormalisedFeed } from "../feeds.js";
import { FEED_IDS, NETWORK_VERSION, type FeedId, type TransitNetwork } from "../network.js";
import {
  decodeNetwork,
  encodeNetwork,
  NETWORK_FORMAT_VERSION,
  NETWORK_MAGIC,
  NetworkFormatError,
} from "../serialize.js";

const WED = "20261028";

/** A hand-built two-stop, one-route network covering every field. */
function synthetic(stopName = "Stesen Ñ — 中文"): TransitNetwork {
  const lat = new Float32Array([3.1, 3.105]);
  const lon = new Float32Array([101.6, 101.61]);
  const cells = new Map<number, Int32Array>();
  // Inserted in descending key order, so the encoder has to sort.
  const keys = [gridKey(lat[1], lon[1]), gridKey(lat[0], lon[0])];
  cells.set(keys[0], new Int32Array([1]));
  cells.set(keys[1], new Int32Array([0]));
  return {
    meta: {
      version: NETWORK_VERSION,
      serviceDate: WED,
      builtAt: 1_761_000_000_000,
      feeds: {
        rail: { fetchedAt: 5, hash: "abc", validUntil: "20261231", included: true },
        "bus-kl": { fetchedAt: 0, hash: "", validUntil: "", included: false },
        feeder: { fetchedAt: 0, hash: "", validUntil: "", included: false },
        ktm: { fetchedAt: 0, hash: "", validUntil: "", included: false },
      },
    },
    stops: {
      count: 2,
      id: ["rail:KJ15", "rail:MR1"],
      name: [stopName, ""],
      lat,
      lon,
      feed: new Uint8Array([0, 0]),
      station: new Int32Array([0, -1]),
    },
    stations: [
      {
        id: "kl-sentral",
        name: "KL Sentral",
        lat: 3.134,
        lng: 101.686,
        stopIds: ["KJ15"],
        lines: [{ code: "LRT KJ", mode: "LRT", name: "LRT Kelana Jaya Line", color: "#E0115F", textColor: "#FFFFFF" }],
      },
    ],
    routes: {
      count: 1,
      id: ["rail:KJ"],
      label: ["KJ"],
      longName: ["LRT Kelana Jaya Line"],
      mode: new Uint8Array([2]),
      color: ["#E0115F"],
      textColor: ["#FFFFFF"],
      feed: new Uint8Array([0]),
      shapeId: [""],
    },
    patterns: {
      count: 1,
      route: new Int32Array([0]),
      headsign: ["Gombak"],
      stopStart: new Int32Array([0]),
      stopLen: new Int32Array([2]),
      stops: new Int32Array([0, 1]),
      tripStart: new Int32Array([0]),
      tripLen: new Int32Array([1]),
      timeStart: new Int32Array([0]),
      arr: new Int32Array([90_000, 90_120]),
      dep: new Int32Array([90_030, 90_120]),
      tripKey: ["T1@25:00"],
      freqStart: new Int32Array([0]),
      freqLen: new Int32Array([1]),
      fStart: new Int32Array([21_600]),
      fEnd: new Int32Array([86_400]),
      fHeadway: new Int32Array([240]),
      runOffset: new Int32Array([0, 120]),
    },
    stopRoutes: {
      start: new Int32Array([0, 1]),
      len: new Int32Array([1, 1]),
      pattern: new Int32Array([0, 0]),
      pos: new Int32Array([0, 1]),
    },
    transfers: {
      start: new Int32Array([0, 1]),
      len: new Int32Array([1, 1]),
      to: new Int32Array([1, 0]),
      seconds: new Int32Array([480, 480]),
      kind: new Uint8Array([2, 2]),
    },
    grid: { cellDeg: GRID_CELL_DEG, cells },
  };
}

/** Every field as plain data: typed arrays as arrays, the grid as sorted entries. */
function plain(net: TransitNetwork): unknown {
  const conv = (v: unknown): unknown => {
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
    if (v instanceof Map) {
      return [...v.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => [k, Array.from(c as Int32Array)]);
    }
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
    return v;
  };
  return conv(net);
}

function assertRejects(bytes: Uint8Array, re?: RegExp): void {
  assert.throws(
    () => decodeNetwork(bytes),
    (e: unknown) => e instanceof NetworkFormatError && e.name === "NetworkFormatError" && (!re || re.test(e.message)),
  );
}

test("round-trips a synthetic network byte-identically", () => {
  const bytes = encodeNetwork(synthetic());
  assert.deepEqual(encodeNetwork(decodeNetwork(bytes)), bytes);
});

test("decoded network equals the original", () => {
  const net = synthetic();
  const back = decodeNetwork(encodeNetwork(net));
  assert.deepEqual(plain(back), plain(net));
  assert.ok(back.stops.lat instanceof Float32Array);
  assert.ok(back.stops.feed instanceof Uint8Array);
  assert.ok(back.patterns.arr instanceof Int32Array);
  assert.ok(back.grid.cells instanceof Map);
});

test("header holds the magic, format version and an 8-byte-aligned section table", () => {
  const bytes = encodeNetwork(synthetic());
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), NETWORK_MAGIC);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint16(4, true), NETWORK_FORMAT_VERSION);
  const n = dv.getUint16(6, true);
  assert.ok(n > 40);
  for (let i = 0; i < n; i++) {
    const off = dv.getUint32(12 + i * 16 + 8, true);
    const len = dv.getUint32(12 + i * 16 + 12, true);
    assert.equal(off % 8, 0);
    assert.ok(off + len <= bytes.byteLength);
  }
  assert.equal(bytes.byteLength % 8, 0);
});

test("non-ASCII names survive", () => {
  const back = decodeNetwork(encodeNetwork(synthetic("Stesen Ñ — 中文 🚆")));
  assert.equal(back.stops.name[0], "Stesen Ñ — 中文 🚆");
  assert.equal(back.stops.name[1], "");
  assert.equal(back.routes.shapeId[0], "");
});

test("an empty network round-trips", () => {
  const net = synthetic();
  net.stops = { count: 0, id: [], name: [], lat: new Float32Array(0), lon: new Float32Array(0), feed: new Uint8Array(0), station: new Int32Array(0) };
  net.grid.cells = new Map();
  const bytes = encodeNetwork(net);
  const back = decodeNetwork(bytes);
  assert.equal(back.stops.count, 0);
  assert.deepEqual(back.stops.id, []);
  assert.equal(back.grid.cells.size, 0);
  assert.deepEqual(encodeNetwork(back), bytes);
});

test("rejects bad magic", () => {
  const bytes = encodeNetwork(synthetic());
  bytes[0] = "X".charCodeAt(0);
  assertRejects(bytes, /magic/);
});

test("rejects unknown format version", () => {
  const bytes = encodeNetwork(synthetic());
  new DataView(bytes.buffer).setUint16(4, NETWORK_FORMAT_VERSION + 1, true);
  assertRejects(bytes, /format/);
});

test("rejects truncated blob", () => {
  const bytes = encodeNetwork(synthetic());
  assertRejects(bytes.subarray(0, 6));
  assertRejects(bytes.subarray(0, 40));
  assertRejects(bytes.subarray(0, bytes.byteLength - 8));
});

test("rejects a network version mismatch", () => {
  const net = synthetic();
  (net.meta as { version: number }).version = NETWORK_VERSION + 1;
  assertRejects(encodeNetwork(net), /version/);
});

test("rejects a misaligned section offset", () => {
  const bytes = encodeNetwork(synthetic());
  const dv = new DataView(bytes.buffer);
  dv.setUint32(12 + 8, dv.getUint32(12 + 8, true) + 4, true);
  assertRejects(bytes);
});

test("decodes from an unaligned view", () => {
  const bytes = encodeNetwork(synthetic());
  const unaligned = new Uint8Array(bytes.byteLength + 1).subarray(1);
  unaligned.set(bytes);
  assert.equal(unaligned.byteOffset % 8, 1);
  const back = decodeNetwork(unaligned);
  assert.deepEqual(plain(back), plain(synthetic()));
  assert.deepEqual(encodeNetwork(back), bytes);
});

test("decoded typed arrays are views over the blob, not copies", () => {
  const bytes = encodeNetwork(synthetic());
  const back = decodeNetwork(bytes);
  assert.equal(back.patterns.arr.buffer, bytes.buffer);
  assert.equal(back.stops.lat.buffer, bytes.buffer);
});

test("string containing NUL is rejected on encode", () => {
  assert.throws(() => encodeNetwork(synthetic("bad\u0000name")), /NUL/);
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
let fixtureFeeds: NormalisedFeed[] | null = null;
function fixtures(): NormalisedFeed[] {
  fixtureFeeds ??= FEED_IDS.map((f) => readFeed(new Uint8Array(readFileSync(new URL(ZIP[f], FIXTURES))), f));
  return fixtureFeeds;
}
function compileFixtures(): TransitNetwork {
  const feeds: CompileFeeds = {};
  for (const data of fixtures()) {
    feeds[data.feed] = { data, meta: { fetchedAt: 1, hash: `h-${data.feed}`, validUntil: data.validUntil, included: true } };
  }
  return compileNetworkSync(feeds, WED, { builtAt: 0 });
}

test("fixture network for 20261028 round-trips and is < 6 MB", () => {
  const net = compileFixtures();
  const bytes = encodeNetwork(net);
  assert.ok(bytes.byteLength < 6 * 1024 * 1024, `${bytes.byteLength} bytes`);
  const back = decodeNetwork(bytes);
  assert.equal(back.stops.count, net.stops.count);
  assert.equal(back.routes.count, net.routes.count);
  assert.equal(back.patterns.count, net.patterns.count);
  assert.deepEqual(plain(back), plain(net));
  assert.deepEqual(encodeNetwork(back), bytes);
});

test("encode is deterministic", () => {
  assert.deepEqual(encodeNetwork(compileFixtures()), encodeNetwork(compileFixtures()));
});
