import { count, createTestDb } from "@/db/__tests__/nodeDb";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { strToU8, zipSync } from "fflate";

import { readFeedSteps, runSteps, type FeedId } from "@bus-tracker/shared";
import type { StoredFeed } from "@/db/networkStore";
import { decodeRailCoords, encodeRailCoords, loadRailShapes, loadRailShapesHash } from "@/db/railShapesStore";
import { railShapesSteps, refreshRailShapes } from "../railShapes";
import { refreshTransitNetwork, type NetworkDeps } from "../transitNetwork";

const FIXTURES = new URL("../../../../packages/shared/src/transit/__fixtures__/2026-10-23/", import.meta.url);
const RAIL_ZIP = new Uint8Array(readFileSync(new URL("rapid-rail-kl.zip", FIXTURES)));

/** 2026-10-23 10:00 MYT. */
const START = Date.UTC(2026, 9, 23, 2, 0, 0);

const drain = <T>(g: Generator<void, T, void>): T => {
  for (;;) {
    const s = g.next();
    if (s.done) return s.value;
  }
};

/** Steps of `g`, with the longest single step in ms. */
function timedDrain<T>(g: Generator<void, T, void>): { value: T; longestMs: number; steps: number } {
  let longestMs = 0;
  let steps = 0;
  for (;;) {
    const t = performance.now();
    const s = g.next();
    longestMs = Math.max(longestMs, performance.now() - t);
    steps++;
    if (s.done) return { value: s.value, longestMs, steps };
  }
}

function stored(hash: string, zip = RAIL_ZIP): StoredFeed {
  return { feed: "rail", hash, fetchedAt: START, validFrom: "20260101", validUntil: "20271231", zip };
}

beforeEach(() => {
  mock.method(console, "warn", () => {});
});
afterEach(() => mock.restoreAll());

test("railShapesSteps: one simplified shape per rail line, keyed like the network", () => {
  const feed = drain(readFeedSteps(RAIL_ZIP, "rail", { shapes: true }));
  const { value: rows, longestMs } = timedDrain(railShapesSteps(feed));
  assert.deepEqual(rows.map((r) => r.routeId).sort(), [
    "rail:AG",
    "rail:BRT",
    "rail:KGL",
    "rail:KJ",
    "rail:MR",
    "rail:PH",
    "rail:PYL",
    "rail:SA",
  ]);
  const kj = rows.find((r) => r.routeId === "rail:KJ")!;
  assert.equal(kj.shapeId, "rail:shp_KJ_0");
  const raw = feed.parsed.shapes.filter((p) => p.shape_id === "rail:shp_KJ_0").length;
  const kept = kj.coords.length / 2;
  assert.ok(kept >= 20 && kept < raw, `KJ kept ${kept} of ${raw}`);
  for (const r of rows) {
    // lat/lng the right way round, inside the Klang Valley.
    for (let i = 0; i < r.coords.length; i += 2) {
      assert.ok(r.coords[i] > 2.7 && r.coords[i] < 3.45, `${r.routeId} lat ${r.coords[i]}`);
      assert.ok(r.coords[i + 1] > 101.25 && r.coords[i + 1] < 101.95, `${r.routeId} lng ${r.coords[i + 1]}`);
    }
  }
  // Each step is a route or 2k shape rows: far inside a 12 ms slice even at
  // Hermes' ~8× Node.
  assert.ok(longestMs < 10, `longest step ${longestMs.toFixed(1)} ms`);
});

test("rail coords survive the BLOB round trip, from an unaligned buffer too", () => {
  const coords = Float32Array.from([3.1, 101.6, 3.2, 101.7]);
  const bytes = encodeRailCoords(coords);
  assert.deepEqual(decodeRailCoords(bytes), coords);
  const unaligned = new Uint8Array(bytes.length + 1).subarray(1);
  unaligned.set(bytes);
  assert.deepEqual(decodeRailCoords(unaligned), coords);
});

test("refreshRailShapes writes once per feed version and never deletes", async () => {
  const db = createTestDb();
  const deps = { db, runSteps };
  assert.equal(await refreshRailShapes(deps, undefined, undefined, 12), null);
  assert.equal(count(db, "rail_shapes"), 0);

  // An empty table is filled from the stored zip.
  assert.equal(await refreshRailShapes(deps, stored("h1"), undefined, 12), 8);
  assert.equal(count(db, "rail_shapes"), 8);
  assert.equal(await loadRailShapesHash(db), "h1");
  const shapes = await loadRailShapes(db);
  assert.equal(shapes.size, 8);
  assert.ok(shapes.get("rail:KJ")!.length >= 40);

  // Same feed version: nothing to do.
  assert.equal(await refreshRailShapes(deps, stored("h1"), undefined, 12), null);

  // A newer feed with only the KJ line replaces KJ and keeps the rest.
  const kjOnly = zipSync({
    "routes.txt": strToU8("route_id,route_short_name,route_long_name\nKJ,KJL,Kelana Jaya Line\n"),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nKJ1,GOMBAK,3.231,101.724\nKJ2,TAMAN MELATI,3.219,101.722\n"),
    "trips.txt": strToU8("route_id,service_id,trip_id,direction_id,shape_id\nKJ,WK,KJ_0,0,S\n"),
    "stop_times.txt": strToU8(
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nKJ_0,KJ1,1,06:00:00,06:00:00\nKJ_0,KJ2,2,06:02:00,06:02:00\n",
    ),
    "shapes.txt": strToU8("shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS,3.231,101.724,1\nS,3.219,101.722,2\n"),
    "calendar.txt": strToU8(
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,1,1,20260101,20271231\n",
    ),
  });
  const read = drain(readFeedSteps(kjOnly, "rail", { shapes: true }));
  assert.equal(await refreshRailShapes(deps, stored("h2", kjOnly), read, 12), 1);
  const after = await loadRailShapes(db);
  assert.equal(after.size, 8);
  assert.deepEqual(Array.from(after.get("rail:KJ")!), Array.from(Float32Array.from([3.231, 101.724, 3.219, 101.722])));
  assert.equal(await loadRailShapesHash(db), "h2");
});

test("refreshTransitNetwork fills rail_shapes from the rail feed", async () => {
  const db = createTestDb();
  const bus = (p: string) =>
    zipSync({
      "routes.txt": strToU8(`route_id,route_short_name,route_long_name\n${p}R,${p}1,${p} line\n`),
      "stops.txt": strToU8(`stop_id,stop_name,stop_lat,stop_lon\n${p}A,Stop A,3.10,101.60\n${p}B,Stop B,3.11,101.61\n`),
      "trips.txt": strToU8(`route_id,service_id,trip_id\n${p}R,WK,${p}T\n`),
      "stop_times.txt": strToU8(
        `trip_id,stop_id,stop_sequence,arrival_time,departure_time\n${p}T,${p}A,1,07:00:00,07:00:00\n${p}T,${p}B,2,07:10:00,07:10:00\n`,
      ),
      "calendar.txt": strToU8(
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,1,1,20260101,20271231\n",
      ),
    });
  const zips: Record<FeedId, Uint8Array> = { rail: RAIL_ZIP, "bus-kl": bus("K"), feeder: bus("F"), ktm: bus("T") };
  const deps: NetworkDeps = {
    db,
    now: () => START,
    download: async (feeds) => ({ ok: feeds.map((feed) => ({ feed, bytes: zips[feed] })), failed: [] }),
    runSteps,
  };
  await refreshTransitNetwork(deps);
  assert.equal(count(db, "rail_shapes"), 8);
  const kj = (await loadRailShapes(db)).get("rail:KJ")!;
  assert.ok(kj.length >= 40);
  const hash = await loadRailShapesHash(db);
  assert.match(hash ?? "", /^[0-9a-f]{8}$/);
});
