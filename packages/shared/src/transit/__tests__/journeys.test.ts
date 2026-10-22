import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { secondsToClockHHMM, toMalaysiaParts } from "../../utils/gtfs-time.js";
import { decodeFeed, getFeedMessage } from "../../utils/protobuf.js";
import { entitiesToPositions } from "../../utils/realtime.js";
import { CATCH_MARGIN_MS, liveNow, plannerRealtimeRoutes } from "../live.js";
import type { TransitNetwork } from "../network.js";
import { planSync, type Itinerary, type ItineraryWarning, type Leg, type LiveSnapshot, type PlanQuery, type PlanResult } from "../plan.js";
import { CHANGE_SEC } from "../raptor.js";
import { retime } from "../retime.js";
import { toServiceSeconds } from "../time.js";
import { GOLDENS, type Golden } from "./goldens.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";
import { outline, outlineMatches } from "./helpers/outline.js";

const WARNINGS: ReadonlySet<string> = new Set<ItineraryWarning>(["last-service", "long-wait", "missed-connection"]);
const REPORT = process.env.GOLDEN_REPORT === "1";

const clock = (net: TransitNetwork, ms: number) => secondsToClockHHMM(toServiceSeconds(net, ms));
const hhmmSec = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(3, 5)) * 60;

/** Step 3's review line: `name | outline | depart | arrive | rides | walk m | tags | warnings`. */
function reportLine(net: TransitNetwork, name: string, it: Itinerary): string {
  return [name, outline(it), clock(net, it.departAt), clock(net, it.arriveAt), it.rides, `${it.walkMeters} m`, it.tags.join(",") || "-", it.warnings.join(",") || "-"].join(" | ");
}

function run(g: Golden, report = false): { net: TransitNetwork; res: PlanResult } {
  const net = fixtureNetwork({ exclude: g.exclude });
  const res = planSync(net, g.query);
  if (report) {
    console.log(`# ${g.name} | excludedFeeds ${JSON.stringify(res.excludedFeeds)}`);
    for (const it of res.itineraries) console.log(reportLine(net, g.name, it));
  }
  return { net, res };
}

for (const g of GOLDENS) {
  test(`golden: ${g.name}`, () => {
    const { net, res } = run(g, REPORT);
    const its = res.itineraries;
    const outlines = its.map(outline);
    const where = `${g.name}: ${JSON.stringify(its.map((it) => `${outline(it)} ${clock(net, it.departAt)}→${clock(net, it.arriveAt)}`))}`;

    assert.deepEqual(res.excludedFeeds, g.expect.excludedFeeds ?? [], where);
    assert.ok(its.length >= Math.max(1, g.expect.minItineraries ?? 1) && its.length <= 5, where);
    if (g.expect.outlines.length > 0) {
      const matching = its.filter((it, i) => g.expect.outlines.some((p) => outlineMatches(p, outlines[i])));
      assert.ok(matching.length > 0, `no outline in ${JSON.stringify(g.expect.outlines)}, ${where}`);
      if (g.expect.arrive !== null) {
        const want = hhmmSec(g.expect.arrive);
        assert.ok(
          matching.some((it) => Math.abs(toServiceSeconds(net, it.arriveAt) - want) <= 5 * 60),
          `no matching itinerary arrives at ${g.expect.arrive} ± 5 min, ${where}`,
        );
      }
    }
    if (g.expect.first !== undefined) {
      assert.equal(outlines[0], g.expect.first, where);
      assert.equal(its[0].tags[0], "fastest", where);
    }
    if (g.expect.allowedModes) {
      const modes = new Set(g.expect.allowedModes);
      for (const it of its) for (const l of it.legs) if (l.kind === "ride") assert.ok(modes.has(l.mode), `${l.label} is ${l.mode}, ${where}`);
    }
    // Feed expiry is PlanResult.excludedFeeds, never a warning.
    for (const it of its) for (const w of it.warnings) assert.ok(WARNINGS.has(w), `warning ${w}, ${where}`);
  });
}

test("golden ids are stable across retime", () => {
  for (const g of GOLDENS) {
    const { net, res } = run(g);
    const out = retime(res.itineraries, { byCategory: {} }, net, { to: g.query.to, walkMetersPerMin: 80, modes: g.query.modes });
    assert.deepEqual(out.map((it) => it.id), res.itineraries.map((it) => it.id), g.name);
  }
});

// Step 4: retime on a vehicle-position protobuf, through decodeFeed → entitiesToPositions → retime.

type Ride = Extract<Leg, { kind: "ride" }>;
const FEEDER = "rapid-bus-mrtfeeder";
const CAPTURE = new URL("../__fixtures__/2026-10-23/rt-feeder-0800.pb", import.meta.url);
const LISA_KLCC = GOLDENS[0];
const LISA_KLCC_FEEDER = GOLDENS[5];

/** When you can be at `legs[i]`'s stop: retime's rule (an access walk starts no earlier than `now`). */
function reachAt(legs: readonly Leg[], i: number, now: number): number {
  if (i === 0) return now;
  const prev = legs[i - 1];
  if (i === 1 && prev.kind === "walk") return Math.max(now, prev.from.time) + prev.seconds * 1000;
  return prev.to.time;
}

const rideSignature = (it: Itinerary) => it.legs.flatMap((l) => (l.kind === "ride" ? [`${l.label}:${l.from.stop}>${l.to.stop}`] : [])).join("|");

/**
 * Criterion 4/5 on a real or encoded snapshot: same count and order, ids kept
 * unless a tail re-plan changed the rides, live legs caught with the margin,
 * and every itinerary without `missed-connection` still consistent.
 */
function assertRetimed(before: Itinerary[], after: Itinerary[], now: number): number {
  assert.equal(after.length, before.length);
  let live = 0;
  for (const [k, it] of after.entries()) {
    const was = before[k];
    const where = `${k}: ${outline(was)} → ${outline(it)}`;
    if (rideSignature(it) === rideSignature(was)) assert.equal(it.id, was.id, `id changed without a re-plan, ${where}`);
    assert.deepEqual(it.tags, was.tags, where);
    for (const w of it.warnings) assert.ok(WARNINGS.has(w), where);
    for (const [i, l] of it.legs.entries()) {
      if (l.kind !== "ride" || l.timing.kind !== "live") continue;
      live++;
      assert.ok(l.from.time >= reachAt(it.legs, i, now) + CATCH_MARGIN_MS, `live leg ${i} boards too soon, ${where}`);
    }
    if (it.warnings.includes("missed-connection")) continue;
    for (const [i, l] of it.legs.entries()) {
      assert.ok(l.from.time <= l.to.time, where);
      if (i === 0) continue;
      const p = it.legs[i - 1];
      const change = p.kind === "ride" && l.kind === "ride" ? CHANGE_SEC * 1000 : 0;
      assert.ok(l.from.time >= p.to.time + change, `leg ${i} starts before leg ${i - 1} ends, ${where}`);
    }
  }
  return live;
}

/** A GTFS-RT FeedMessage, encoded as the feed would send it. */
function encodeFeed(timestampSec: number, entity: unknown[]): Uint8Array {
  const FeedMessage = getFeedMessage();
  const obj = { header: { gtfs_realtime_version: "2.0", incrementality: 0, timestamp: timestampSec }, entity };
  const err = FeedMessage.verify(obj);
  if (err) throw new Error(`verify: ${err}`);
  return FeedMessage.encode(FeedMessage.create(obj)).finish();
}

function stopAt(net: TransitNetwork, id: string): { lat: number; lng: number } {
  const s = net.stops.id.indexOf(id);
  assert.ok(s >= 0, `stop ${id}`);
  return { lat: net.stops.lat[s], lng: net.stops.lon[s] };
}

/** Initial bearing from a to b, degrees clockwise from north. */
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A feeder vehicle entity parked on stop `at`, heading for `toward`. */
function vehicle(net: TransitNetwork, id: string, routeId: string, at: string, toward: string, timestampSec: number, extra: object = {}) {
  const a = stopAt(net, at);
  return {
    id,
    vehicle: {
      trip: { trip_id: `${routeId}-trip`, route_id: routeId },
      vehicle: { id, label: id },
      position: { latitude: a.lat, longitude: a.lng, bearing: bearing(a, stopAt(net, toward)), speed: 20 },
      timestamp: timestampSec,
    },
    ...extra,
  };
}

/** The feeder snapshot for `its`, decoded from `buf` with the planner's route aliases. */
function snapshotOf(net: TransitNetwork, its: Itinerary[], buf: Uint8Array, asOf: number): LiveSnapshot {
  const feed = decodeFeed(buf);
  const aliases = new Map<string, string>();
  for (const r of plannerRealtimeRoutes(its, net, asOf)) if (r.category === FEEDER) for (const [k, v] of r.aliases) aliases.set(k, v);
  const positions = entitiesToPositions(feed, new Map(), asOf, aliases);
  return { byCategory: { [FEEDER]: { asOf, positions } } };
}

test("live snapshot (encoded protobuf): T816 two stops out shifts Lisa → KLCC by exactly its delay; distractors are ignored", () => {
  const net = fixtureNetwork();
  const ctx = (q: PlanQuery) => ({ to: q.to, walkMetersPerMin: q.walkMetersPerMin, modes: q.modes });
  const feederOnly = planSync(net, LISA_KLCC_FEEDER.query).itineraries;
  const allModes = planSync(net, LISA_KLCC.query).itineraries;
  // The fix is a minute before T816's 08:24:44 board at Lisa.
  const now = feederOnly[0].legs[0].from.time - 60_000;
  const sec = now / 1000;
  const buf = encodeFeed(sec, [
    vehicle(net, "WMG1234", "T816", "12000757", "12000762", sec),
    // One stop out: reaches Lisa in under a minute, so not catchable.
    vehicle(net, "NEAR", "T816", "12000762", "12000759", sec),
    // A route no itinerary rides, a deleted entity, and one without a trip: all dropped by entitiesToPositions.
    vehicle(net, "OTHER", "T999", "12000757", "12000762", sec),
    vehicle(net, "GONE", "T816", "12000757", "12000762", sec, { is_deleted: true }),
    { id: "NOTRIP", vehicle: { position: { latitude: 3.12, longitude: 101.63 }, timestamp: sec } },
  ]);
  const live = snapshotOf(net, [...feederOnly, ...allModes], buf, now);
  assert.deepEqual(live.byCategory[FEEDER].positions.map((p) => p.vehicleId).sort(), ["NEAR", "WMG1234"]);
  assert.equal(liveNow(live), now);

  const out = retime(feederOnly, live, net, ctx(LISA_KLCC_FEEDER.query));
  assert.ok(assertRetimed(feederOnly, out, now) >= 1);
  const ride = out[0].legs[0] as Ride;
  assert.deepEqual(ride.timing, { kind: "live", vehicleId: "WMG1234", asOf: now, deltaSec: 120 });
  for (const [j, l] of out[0].legs.entries()) {
    assert.equal(l.from.time, feederOnly[0].legs[j].from.time + 120_000, `leg ${j} from`);
    assert.equal(l.to.time, feederOnly[0].legs[j].to.time + 120_000, `leg ${j} to`);
  }
  assert.equal(out[0].id, feederOnly[0].id);
  assert.equal(out[0].previousArriveAt, feederOnly[0].arriveAt);

  // Every mode: the first bus legs are other routes (or too far ahead), so nothing may break.
  assertRetimed(allModes, retime(allModes, live, net, ctx(LISA_KLCC.query)), now);
});

test("live snapshot (captured rt-feeder-0800.pb): golden 1 retimes without breaking its invariants", { skip: existsSync(CAPTURE) ? false : "rt-feeder-0800.pb not captured yet (plan 14/06 step 4)" }, () => {
  const buf = new Uint8Array(readFileSync(CAPTURE));
  const header = decodeFeed(buf).header.timestamp;
  assert.ok(header, "the capture has a header timestamp");
  const capturedAt = header * 1000;
  const net = fixtureNetwork({ serviceDate: toMalaysiaParts(new Date(capturedAt)).ymd });
  let live = 0;
  for (const g of [LISA_KLCC, LISA_KLCC_FEEDER]) {
    const q = { ...g.query, departAt: capturedAt };
    const its = planSync(net, q).itineraries;
    const snap = snapshotOf(net, its, buf, capturedAt);
    const out = retime(its, snap, net, { to: q.to, walkMetersPerMin: q.walkMetersPerMin, modes: q.modes });
    live += assertRetimed(its, out, capturedAt);
  }
  console.log(`live capture ${new Date(capturedAt).toISOString()}: ${live} live legs`);
});
