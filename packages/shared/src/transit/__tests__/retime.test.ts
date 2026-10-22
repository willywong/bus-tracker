import assert from "node:assert/strict";
import test from "node:test";

import type { VehiclePosition } from "../../types/bus.js";
import { rawGtfsId } from "../../utils/categories.js";
import { itineraryId } from "../ids.js";
import { CATCH_MARGIN_MS, LIVE_HORIZON_MS, liveNow, plannerRealtimeRoutes, UPDATED_MIN_SHIFT_MS } from "../live.js";
import type { Mode, TransitNetwork } from "../network.js";
import { planSync, type Itinerary, type Leg, type LiveSnapshot, type Place, type PlanQuery } from "../plan.js";
import { CHANGE_SEC } from "../raptor.js";
import { retime } from "../retime.js";
import { toEpochMs } from "../time.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";
import { tinyNetwork } from "./helpers/tiny-network.js";

type Ride = Extract<Leg, { kind: "ride" }>;
const ridesOf = (it: Itinerary) => it.legs.filter((l): l is Ride => l.kind === "ride");

/** 2026-10-28 08:00 MYT. */
const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);
const LISA: Place = { kind: "stop", name: "Hotel Lisa De Inn", lat: 3.118231, lng: 101.63065, ref: "12000759" };
const KLCC: Place = { kind: "station", name: "KLCC", lat: 3.158935, lng: 101.713287, ref: "klcc" };
/** No Rapid KL buses, so the fastest Lisa → KLCC option is T816 → MRT → LRT. */
const FEEDER_RAIL: readonly Mode[] = ["feeder", "lrt", "mrt", "monorail"];

function stopAt(net: TransitNetwork, id: string): number {
  const s = net.stops.id.indexOf(id);
  assert.ok(s >= 0, `stop ${id}`);
  return s;
}

/** Initial bearing from stop `a` to stop `b`, degrees clockwise from north. */
function bearing(net: TransitNetwork, a: number, b: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const [la, lb, dl] = [rad(net.stops.lat[a]), rad(net.stops.lat[b]), rad(net.stops.lon[b] - net.stops.lon[a])];
  const y = Math.sin(dl) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A bus parked on stop `at`, heading for stop `toward`. */
function busAt(net: TransitNetwork, at: string, toward: string, observedAt: number, routeId: string, vehicleId = "WMG1234"): VehiclePosition {
  const a = stopAt(net, at);
  return { vehicleId, tripId: "trip", routeId, lat: net.stops.lat[a], lng: net.stops.lon[a], bearing: bearing(net, a, stopAt(net, toward)), observedAt };
}

const snapshot = (category: string, asOf: number, positions: VehiclePosition[]): LiveSnapshot => ({ byCategory: { [category]: { asOf, positions } } });

/** Lisa → KLCC, feeder and rail only: T816 08:24:44 → walk → MRT KG (headway) → walk → LRT KJ (headway). */
function t816Itinerary(): { net: TransitNetwork; it: Itinerary; ctx: Pick<PlanQuery, "to" | "walkMetersPerMin" | "modes"> } {
  const net = fixtureNetwork();
  const ctx = { to: KLCC, walkMetersPerMin: 80, modes: FEEDER_RAIL };
  const res = planSync(net, { from: LISA, departAt: AT_0800, ...ctx });
  const it = res.itineraries[0];
  assert.deepEqual(it.legs.map((l) => (l.kind === "ride" ? `${l.label}:${l.timing.kind}` : "walk")), ["T816:scheduled", "walk", "KG:headway", "walk", "KJ:headway"]);
  assert.equal(net.stops.id[it.legs[0].from.stop!], "12000759");
  return { net, it, ctx };
}

/** T816 two stops upstream of Lisa (JEJANTAS SS2/24, heading for KOMERSIAL SS19/8), fixed `now`. */
function t816Live(net: TransitNetwork, now: number, observedAt = now): LiveSnapshot {
  return snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "12000757", "12000762", observedAt, "T816")]);
}

test("liveNow is the newest asOf, null when the snapshot is empty", () => {
  assert.equal(liveNow({ byCategory: {} }), null);
  assert.equal(liveNow({ byCategory: { a: { asOf: 5, positions: [] }, b: { asOf: 9, positions: [] } } }), 9);
});

test("empty snapshot → itineraries deep-equal the input", () => {
  const { net, it, ctx } = t816Itinerary();
  const before = structuredClone(it);
  const out = retime([it], { byCategory: {} }, net, ctx);
  assert.deepEqual(out, [before]);
});

test("T816 bus two stops upstream of Hotel Lisa De Inn makes the first leg live and shifts downstream", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 60_000;
  const [out] = retime([it], t816Live(net, now), net, ctx);
  const ride = out.legs[0] as Ride;
  assert.equal(ride.timing.kind, "live");
  assert.ok(ride.timing.kind === "live");
  const delta = ride.timing.deltaSec * 1000;
  assert.equal(ride.timing.vehicleId, "WMG1234");
  assert.equal(ride.timing.asOf, now);
  assert.ok(delta > 0, `bus about 3 min out boards after 08:24:44 (delta ${delta} ms)`);
  assert.equal(ride.from.time, it.legs[0].from.time + delta);
  assert.ok(ride.from.time >= now + CATCH_MARGIN_MS);
  // Every downstream time moves by delta: the walks follow the bus, and both headway rides re-board inside their windows.
  for (const [j, l] of out.legs.entries()) {
    assert.equal(l.from.time, it.legs[j].from.time + delta, `leg ${j} from`);
    assert.equal(l.to.time, it.legs[j].to.time + delta, `leg ${j} to`);
  }
  assert.deepEqual(ride.via.map((v) => v.time), (it.legs[0] as Ride).via.map((v) => v.time + delta));
  // Rail stays headway: never live.
  assert.deepEqual(ridesOf(out).slice(1).map((r) => r.timing.kind), ["headway", "headway"]);
  assert.equal(out.id, it.id);
  assert.equal(out.departAt, it.departAt + delta);
  assert.equal(out.arriveAt, it.arriveAt + delta);
  assert.equal(out.previousArriveAt, it.arriveAt);
  assert.deepEqual(out.tags, it.tags);
  // The input is untouched.
  assert.equal((it.legs[0] as Ride).timing.kind, "scheduled");
});

test("headway rail leg after the live bus re-boards at the new arrival", () => {
  const { net, it, ctx } = t816Itinerary();
  const [out] = retime([it], t816Live(net, it.legs[0].from.time - 60_000), net, ctx);
  const walk = out.legs[1];
  const mrt = out.legs[2] as Ride;
  assert.equal(walk.from.time, out.legs[0].to.time);
  // Turn-up-and-go: half the 6-min headway after reaching the platform.
  assert.deepEqual(mrt.timing, { kind: "headway", headwaySec: 360 });
  assert.equal(mrt.from.time, walk.to.time + 180_000);
  assert.ok(mrt.via.every((v, k) => v.time >= (k === 0 ? mrt.from.time : mrt.via[k - 1].time)));
});

test("bus that arrives before you can reach the stop is ignored", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 60_000;
  // One stop out (KOMERSIAL SS19/8 → Lisa): under a minute away, so not catchable from a standing start.
  const near = snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "12000762", "12000759", now, "T816", "NEAR")]);
  assert.deepEqual(retime([it], near, net, ctx), [it]);
  // The bus behind it is the one you catch.
  const both = snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "12000762", "12000759", now, "T816", "NEAR"), busAt(net, "12000757", "12000762", now, "T816", "BEHIND")]);
  const timing = (retime([it], both, net, ctx)[0].legs[0] as Ride).timing;
  assert.ok(timing.kind === "live");
  assert.equal(timing.vehicleId, "BEHIND");
});

test("an access walk counts toward reaching the stop", () => {
  const net = fixtureNetwork();
  const ctx = { to: KLCC, walkMetersPerMin: 80, modes: FEEDER_RAIL };
  const it = planSync(net, { from: LISA, departAt: AT_0800, ...ctx }).itineraries[1];
  // Walk 287 m to KOMERSIAL SS19/8, then T816.
  assert.equal(it.legs[0].kind, "walk");
  const ride = it.legs[1] as Ride;
  assert.equal(net.stops.id[ride.from.stop!], "12000762");
  const walkStart = it.legs[0].from.time;
  const probe = (now: number, at: string, toward: string) =>
    retime([it], snapshot("rapid-bus-mrtfeeder", now, [busAt(net, at, toward, now, "T816")]), net, ctx)[0];
  // Two stops upstream it is about 3 min out; setting off a minute late, the walk gets you there after it.
  assert.equal(probe(walkStart + 60_000, "12003263", "12000757"), it);
  // Four stops upstream (BOMBA SS2) it is several minutes out: caught after the 3.6-min walk.
  const out = probe(walkStart, "12000752", "12000833");
  const live = out.legs[1] as Ride;
  assert.equal(live.timing.kind, "live");
  assert.ok(live.from.time >= walkStart + (it.legs[0] as Extract<Leg, { kind: "walk" }>).seconds * 1000 + CATCH_MARGIN_MS);
  assert.deepEqual(out.legs[0], it.legs[0], "legs before the live bus stay");
});

test("stale category (asOf > 10 min) is ignored", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 60_000;
  const live: LiveSnapshot = {
    byCategory: {
      // The category's last poll is 11 min old, even though its one fix would still pass on its own.
      "rapid-bus-mrtfeeder": { asOf: now - 11 * 60_000, positions: [busAt(net, "12000757", "12000762", now, "T816")] },
      "rapid-bus-kl": { asOf: now, positions: [] },
    },
  };
  assert.deepEqual(retime([it], live, net, ctx), [it]);
});

test("|delta| > 20 min on a timetabled leg is ignored", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 25 * 60_000;
  assert.deepEqual(retime([it], t816Live(net, now), net, ctx), [it]);
  // …and a first bus leg beyond the 60-min horizon is not looked at.
  const far = it.legs[0].from.time - LIVE_HORIZON_MS - 60_000;
  assert.deepEqual(retime([it], t816Live(net, far), net, ctx), [it]);
});

test("vehicles match by resolved label or raw GTFS route id, not other routes", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 60_000;
  const raw = rawGtfsId(net.routes.id[(it.legs[0] as Ride).route]);
  const byRaw = snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "12000757", "12000762", now, raw)]);
  assert.equal((retime([it], byRaw, net, ctx)[0].legs[0] as Ride).timing.kind, "live");
  const other = snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "12000757", "12000762", now, "T815")]);
  assert.deepEqual(retime([it], other, net, ctx), [it]);
  // Right route, wrong category: the feeder leg reads only the feeder feed.
  const wrongFeed = snapshot("rapid-bus-kl", now, [busAt(net, "12000757", "12000762", now, "T816")]);
  assert.deepEqual(retime([it], wrongFeed, net, ctx), [it]);
});

test("id unchanged when legs unchanged; previousArriveAt unset when arrival moves < 60 s", () => {
  const { net, it, ctx } = t816Itinerary();
  const now = it.legs[0].from.time - 60_000;
  const first = retime([it], t816Live(net, now), net, ctx)[0];
  const d0 = (first.legs[0] as Ride).timing.kind === "live" ? ((first.legs[0] as Ride).timing as { deltaSec: number }).deltaSec : NaN;
  // Same bus, fix 30 s older relative to the plan: board moves 30 s after the timetable.
  const obs = now - (d0 - 30) * 1000;
  const [out] = retime([it], t816Live(net, now, obs), net, ctx);
  const ride = out.legs[0] as Ride;
  assert.ok(ride.timing.kind === "live");
  assert.equal(ride.timing.deltaSec, 30);
  assert.equal(out.arriveAt - it.arriveAt, 30_000);
  assert.ok(out.arriveAt - it.arriveAt < UPDATED_MIN_SHIFT_MS);
  assert.equal(out.previousArriveAt, undefined);
  assert.equal(out.id, it.id);
  assert.equal(out.id, itineraryId(net, out.legs));
});

test("rail legs are never live", () => {
  const net = fixtureNetwork();
  const ctx = { to: KLCC, walkMetersPerMin: 80, modes: ["lrt", "mrt", "monorail"] as Mode[] };
  const from: Place = { kind: "station", name: "Asia Jaya", lat: 3.104343, lng: 101.637695, ref: "asia-jaya" };
  const its = planSync(net, { from, departAt: AT_0800, ...ctx }).itineraries;
  assert.ok(its.length > 0);
  const now = its[0].departAt;
  // Every route's label and raw id, in both categories.
  const everything: VehiclePosition[] = [];
  for (const it of its) for (const r of ridesOf(it)) everything.push({ vehicleId: r.label, tripId: "t", routeId: r.label, lat: r.from.lat, lng: r.from.lng, observedAt: now });
  const live: LiveSnapshot = { byCategory: { "rapid-bus-mrtfeeder": { asOf: now, positions: everything }, "rapid-bus-kl": { asOf: now, positions: everything } } };
  const out = retime(its, live, net, ctx);
  assert.deepEqual(out, its);
  assert.ok(out.flatMap(ridesOf).every((r) => r.timing.kind !== "live"));
  assert.deepEqual(plannerRealtimeRoutes(its, net, now), []);
});

test("plannerRealtimeRoutes returns ≤ 2 categories with rawGtfsId aliases", () => {
  const { net, it } = t816Itinerary();
  const kl = planSync(net, { from: LISA, to: KLCC, departAt: AT_0800, walkMetersPerMin: 80 }).itineraries;
  const now = AT_0800;
  const out = plannerRealtimeRoutes([it, ...kl, it], net, now);
  assert.ok(out.length <= 2);
  assert.deepEqual(out.map((f) => f.category), ["rapid-bus-mrtfeeder", "rapid-bus-kl"]);
  assert.deepEqual(out[0].routes, ["T816"]);
  const t816 = (it.legs[0] as Ride).route;
  assert.equal(out[0].aliases.get(rawGtfsId(net.routes.id[t816])), "T816");
  assert.equal(out[0].aliases.get("T816"), "T816");
  // Rapid KL: the GTFS route_id without "kl:" (what its realtime feed sends) → label.
  const firstBus = kl.map((x) => ridesOf(x).find((r) => r.mode === "bus")!);
  assert.deepEqual(out[1].routes, [...new Set(firstBus.map((r) => r.label))]);
  for (const r of firstBus) {
    const id = net.routes.id[r.route];
    assert.ok(id.startsWith("kl:"));
    assert.equal(out[1].aliases.get(id.slice(3)), r.label);
  }
  // Beyond the horizon nothing is needed.
  assert.deepEqual(plannerRealtimeRoutes([it], net, it.legs[0].from.time - LIVE_HORIZON_MS - 1), []);
});

// --- Broken transfers on a tiny network -----------------------------------------------------------

const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;
/** P0 … P5 about 1.1 km apart along a parallel: further than an access walk, so every hop is a ride. */
const LINE = ["P0", "P1", "P2", "P3", "P4", "P5"].map((id, i) => ({ id, lat: 3.1, lon: 101.6 + i * 0.01 }));
const P2: Place = { kind: "stop", name: "P2", lat: 3.1, lng: 101.62, ref: "P2" };
const P5: Place = { kind: "stop", name: "P5", lat: 3.1, lng: 101.65, ref: "P5" };

/**
 * Feeder FA P0 → P3 (P2 at 08:04, P3 08:06), then feeder FB P3 → P5 at 08:08
 * (a 2-min connection) and, with `laterB`, 08:30. With `bus`, a Rapid KL bus
 * BX P3 → P5 at 08:20 that `ctx.modes = ['feeder']` leaves out.
 */
function transferNet(opts: { laterB: boolean; bus?: boolean }): TransitNetwork {
  const fb = [[at(8, 8), at(8, 10), at(8, 12)]];
  if (opts.laterB) fb.push([at(8, 30), at(8, 32), at(8, 34)]);
  return tinyNetwork({
    stops: LINE,
    patterns: [
      { route: "FA", mode: "feeder", stops: ["P0", "P1", "P2", "P3"], trips: [[at(8, 0), at(8, 2), at(8, 4), at(8, 6)]] },
      { route: "FB", mode: "feeder", stops: ["P3", "P4", "P5"], trips: fb },
      ...(opts.bus ? [{ route: "BX", mode: "bus" as const, stops: ["P3", "P5"], trips: [[at(8, 20), at(8, 24)]] }] : []),
    ],
  });
}

function fafb(net: TransitNetwork, modes: readonly Mode[] = ["feeder"]): { it: Itinerary; ctx: Pick<PlanQuery, "to" | "walkMetersPerMin" | "modes"> } {
  const ctx = { to: P5, walkMetersPerMin: 80, modes };
  const its = planSync(net, { from: P2, departAt: toEpochMs(net, at(8, 0)), ...ctx }).itineraries;
  const it = its.find((x) => ridesOf(x).map((r) => r.label).join() === "FA,FB" && x.arriveAt === toEpochMs(net, at(8, 12)));
  assert.ok(it, "FA 08:04 → FB 08:08 planned");
  return { it, ctx };
}

/** A snapshot whose FA bus at P0 boards P2 `deltaSec` after 08:04 (probed once, then the fix time is moved). */
function faLive(net: TransitNetwork, it: Itinerary, ctx: Pick<PlanQuery, "to" | "walkMetersPerMin" | "modes">, deltaSec: number): LiveSnapshot {
  const now = toEpochMs(net, at(8, 0));
  const probe = snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "P0", "P1", now, "FA")]);
  const t = (retime([it], probe, net, ctx)[0].legs[0] as Ride).timing;
  assert.ok(t.kind === "live", "probe bus is caught");
  return snapshot("rapid-bus-mrtfeeder", now, [busAt(net, "P0", "P1", now + (deltaSec - t.deltaSec) * 1000, "FA")]);
}

test("a delay that still makes the timetabled transfer stops the shift there", () => {
  const net = transferNet({ laterB: true });
  const { it, ctx } = fafb(net);
  // Arrive P3 08:06:50, ready 08:07:50 ≤ FB 08:08.
  const [out] = retime([it], faLive(net, it, ctx, 50), net, ctx);
  assert.equal(out.legs[0].to.time, it.legs[0].to.time + 50_000);
  assert.deepEqual(out.legs[1], it.legs[1]);
  assert.equal(out.arriveAt, it.arriveAt);
  assert.equal(out.previousArriveAt, undefined);
  assert.deepEqual(out.warnings, it.warnings);
});

test("broken timetabled transfer re-plans the tail once using ctx and sets previousArriveAt", () => {
  const net = transferNet({ laterB: true, bus: true });
  const { it, ctx } = fafb(net);
  // Arrive P3 08:07:30: ready 08:08:30 misses FB 08:08 (CHANGE_SEC at the same stop).
  const live = faLive(net, it, ctx, 90);
  const [out] = retime([it], live, net, ctx);
  assert.equal((out.legs[0] as Ride).timing.kind, "live");
  assert.equal(out.legs[0].to.time, toEpochMs(net, at(8, 7, 30)));
  const tail = out.legs[1] as Ride;
  // ctx.modes = ['feeder'] leaves out the 08:20 bus, so the next FB it is.
  assert.equal(tail.label, "FB");
  assert.equal(tail.from.time, toEpochMs(net, at(8, 30)));
  assert.ok(tail.from.time >= out.legs[0].to.time + CHANGE_SEC * 1000);
  assert.ok(tail.tripKey !== undefined && tail.tripKey !== (it.legs[1] as Ride).tripKey);
  assert.equal(tail.timing.kind, "scheduled");
  assert.equal(out.arriveAt, toEpochMs(net, at(8, 34)));
  assert.equal(out.previousArriveAt, it.arriveAt);
  assert.equal(out.rides, 2);
  assert.equal(out.id, itineraryId(net, out.legs));
  assert.ok(!out.warnings.includes("missed-connection"));

  // Without the mode filter, the tail takes the bus instead: a new leg sequence, so a new id.
  const all = { ...ctx, modes: undefined };
  const [viaBus] = retime([it], live, net, all);
  assert.deepEqual(ridesOf(viaBus).map((r) => r.label), ["FA", "BX"]);
  assert.equal(viaBus.arriveAt, toEpochMs(net, at(8, 24)));
  assert.notEqual(viaBus.id, it.id);
  assert.equal(viaBus.id, itineraryId(net, viaBus.legs));
});

test("no tail found → 'missed-connection'", () => {
  const net = transferNet({ laterB: false });
  const { it, ctx } = fafb(net);
  const [out] = retime([it], faLive(net, it, ctx, 90), net, ctx);
  assert.equal((out.legs[0] as Ride).timing.kind, "live");
  // The rest stays scheduled, as planned.
  assert.deepEqual(out.legs.slice(1), it.legs.slice(1));
  assert.ok(out.warnings.includes("missed-connection"));
  assert.equal(out.id, it.id);
  assert.equal(out.arriveAt, it.arriveAt);
  assert.equal(out.previousArriveAt, undefined);
});

test("retime output keeps order and tags; its input list is not mutated", () => {
  const net = transferNet({ laterB: true });
  const { it, ctx } = fafb(net);
  const other = structuredClone(it);
  other.tags = ["less-walking"];
  const list = [other, it];
  const before = structuredClone(list);
  const out = retime(list, faLive(net, it, ctx, 90), net, ctx);
  assert.deepEqual(list, before);
  assert.deepEqual(out.map((x) => x.tags), [["less-walking"], it.tags]);
  assert.ok(out.every((x) => x.previousArriveAt === it.arriveAt));
});
