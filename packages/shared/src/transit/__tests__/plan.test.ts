import assert from "node:assert/strict";
import test from "node:test";

import { egressStops, accessStops } from "../access.js";
import { patternMask } from "../modes.js";
import type { TransitNetwork } from "../network.js";
import { plan, planSync, type Itinerary, type PlanQuery, type PlanResult } from "../plan.js";
import { CHANGE_SEC } from "../raptor.js";
import { rangeRaptor } from "../range.js";
import { rankCandidates, summarize } from "../rank.js";
import { toItinerary } from "../reconstruct.js";
import { toEpochMs, toServiceSeconds } from "../time.js";
import { walkOnlyCandidate } from "../walk.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";

/** 2026-10-28 08:00 MYT. */
const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);
const LISA_TO_KLCC: PlanQuery = {
  from: { kind: "stop", name: "Hotel Lisa De Inn", lat: 3.118231, lng: 101.63065, ref: "12000759" },
  to: { kind: "station", name: "KLCC", lat: 3.158935, lng: 101.713287, ref: "klcc" },
  departAt: AT_0800,
  walkMetersPerMin: 80,
};
const WARNINGS = new Set(["last-service", "long-wait", "missed-connection"]);
const RAIL_MODES = new Set(["lrt", "mrt", "monorail", "brt"]);

/** README criterion 2 on one result: monotonic, continuous, CHANGE_SEC kept, walks within limits, fastest first. */
function assertConsistent(net: TransitNetwork, q: PlanQuery, res: PlanResult): void {
  const its = res.itineraries;
  assert.ok(its.length <= 5);
  assert.equal(new Set(its.map((it) => it.id)).size, its.length, "ids unique");
  for (const [i, it] of its.entries()) {
    const where = `${i}: ${JSON.stringify(it.legs.map((l) => [l.kind, l.from.name, l.to.name]))}`;
    assert.ok(it.legs.length >= 1, where);
    assert.ok(it.rides <= 4, where);
    assert.equal(it.tags.includes("fastest"), i === 0, where);
    assert.ok(it.warnings.every((w) => WARNINGS.has(w)), where);
    assert.ok(it.departAt >= q.departAt, where);
    assert.ok(it.arriveAt > it.departAt, where);
    assert.equal(it.departAt, it.legs[0].from.time);
    assert.equal(it.arriveAt, it.legs.at(-1)!.to.time);
    for (const [j, l] of it.legs.entries()) {
      assert.ok(l.from.time <= l.to.time, where);
      if (l.kind === "ride") {
        let prev = l.from.time;
        for (const v of l.via) {
          assert.ok(v.time >= prev && v.time <= l.to.time, where);
          prev = v.time;
        }
      }
      if (j === 0) continue;
      const p = it.legs[j - 1];
      assert.ok(p.to.time <= l.from.time, where);
      assert.equal(p.to.stop, l.from.stop, where);
      assert.ok(!(p.kind === "walk" && l.kind === "walk"), `two walks in a row, ${where}`);
      if (p.kind === "ride" && l.kind === "ride") assert.ok(l.from.time >= p.to.time + CHANGE_SEC * 1000, where);
    }
    const first = it.legs[0];
    const last = it.legs.at(-1)!;
    if (it.rides === 0) {
      assert.ok(first.kind === "walk" && first.meters < 2000, where);
    } else {
      if (first.kind === "walk") assert.ok(first.meters <= 1000 * 1.25 + 1, where);
      // A transfer walk merged into the egress walk adds up to ~500 m (the longest fixture transfer, ktm:19000 → rail:KJ14).
      if (last.kind === "walk") assert.ok(last.meters <= 1000 * 1.25 + 500, `${last.meters} m ${where}`);
    }
  }
  const fastest = Math.min(...its.map((it) => it.arriveAt));
  if (its.length > 0) assert.equal(its[0].arriveAt, fastest);
}

test("plan() yields, and planSync returns ≤ 5 itineraries whose first is tagged fastest, with excludedFeeds = []", () => {
  const net = fixtureNetwork();
  const g = plan(net, LISA_TO_KLCC);
  let yields = 0;
  let res: PlanResult;
  for (;;) {
    const step = g.next();
    if (step.done) {
      res = step.value;
      break;
    }
    yields++;
  }
  assert.ok(yields > 0);
  assert.deepEqual(res.excludedFeeds, []);
  assert.ok(res.itineraries.length >= 1 && res.itineraries.length <= 5);
  assert.deepEqual(res.itineraries[0].tags.slice(0, 1), ["fastest"]);
  assert.deepEqual(planSync(net, LISA_TO_KLCC), res, "planSync drains the same answer");
  assertConsistent(net, LISA_TO_KLCC, res);
  // KLCC is a snapped station: every option ends on a rail ride into it, with no egress walk.
  for (const it of res.itineraries) {
    const last = it.legs.at(-1)!;
    assert.ok(last.kind === "ride" && RAIL_MODES.has(last.mode), JSON.stringify(last));
    assert.equal(last.to.name, "KLCC");
  }
});

test("plan() on fixtureNetwork({ exclude: ['rail'] }) returns excludedFeeds ['rail'], no rail legs, and no feed strings in any warnings", () => {
  const net = fixtureNetwork({ exclude: ["rail"] });
  const q: PlanQuery = { ...LISA_TO_KLCC, to: { kind: "place", name: "KLCC", lat: 3.158935, lng: 101.713287 } };
  const res = planSync(net, q);
  assert.deepEqual(res.excludedFeeds, ["rail"]);
  assert.ok(res.itineraries.length >= 1);
  for (const it of res.itineraries) {
    for (const l of it.legs) if (l.kind === "ride") assert.ok(!RAIL_MODES.has(l.mode), `${l.label} is rail`);
    for (const w of it.warnings) assert.ok(WARNINGS.has(w) && !/rail|ktm|feed|expired/.test(w), w);
  }
  assertConsistent(net, q, res);
});

test("excludedFeeds is returned even when itineraries is empty", () => {
  const net = fixtureNetwork({ exclude: ["rail"] });
  const res = planSync(net, {
    from: { kind: "place", name: "Sea A", lat: 2.5, lng: 100.5 },
    to: { kind: "place", name: "Sea B", lat: 2.6, lng: 100.6 },
    departAt: AT_0800,
    walkMetersPerMin: 80,
  });
  assert.deepEqual(res, { itineraries: [], excludedFeeds: ["rail"] });
});

test("modes and maxRides narrow the answer", () => {
  const net = fixtureNetwork();
  const busOnly = planSync(net, { ...LISA_TO_KLCC, modes: ["bus", "feeder"] });
  assert.ok(busOnly.itineraries.length >= 1);
  for (const it of busOnly.itineraries) for (const l of it.legs) if (l.kind === "ride") assert.ok(l.mode === "bus" || l.mode === "feeder");
  const oneRide = planSync(net, { ...LISA_TO_KLCC, maxRides: 1 });
  for (const it of oneRide.itineraries) assert.ok(it.rides <= 1);
});

test("a pace of 0 falls back to 80 m/min; a nearby place offers walking", () => {
  const net = fixtureNetwork();
  const q: PlanQuery = {
    from: { kind: "place", name: "a", lat: 3.118231, lng: 101.63065 },
    to: { kind: "place", name: "b", lat: 3.120929, lng: 101.63065 },
    departAt: AT_0800,
    walkMetersPerMin: 0,
  };
  const res = planSync(net, q);
  assert.deepEqual(res, planSync(net, { ...q, walkMetersPerMin: 80 }));
  assert.ok(res.itineraries.some((it) => it.rides === 0));
  assertConsistent(net, q, res);
});

/** Seeded uniform [0, 1) (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("every Pareto candidate reconstructs without the engine-bug check (goldens + 40 seeded queries)", () => {
  const full = fixtureNetwork();
  const noRail = fixtureNetwork({ exclude: ["rail"] });
  const at = (lat: number, lng: number): PlanQuery["from"] => ({ kind: "place", name: "p", lat, lng });
  const queries: [TransitNetwork, PlanQuery][] = [];
  const goldens = [
    [3.118231, 101.63065, 3.158935, 101.713287],
    [3.110474, 101.636336, 3.133636, 101.687034],
    [3.083, 101.589, 3.146262, 101.711224],
  ];
  for (const net of [full, noRail]) {
    for (const [a, b, c, d] of goldens) queries.push([net, { from: at(a, b), to: at(c, d), departAt: AT_0800, walkMetersPerMin: 80 }]);
  }
  const rand = rng(20261028);
  const near = () => {
    const s = Math.floor(rand() * full.stops.count);
    return at(full.stops.lat[s] + (rand() - 0.5) * 0.006, full.stops.lon[s] + (rand() - 0.5) * 0.006);
  };
  for (let i = 0; i < 40; i++) {
    const departAt = AT_0800 + Math.floor((rand() - 0.1) * 12 * 60) * 60_000;
    queries.push([full, { from: near(), to: near(), departAt, walkMetersPerMin: [60, 80, 100][i % 3] }]);
  }

  for (const [net, q] of queries) {
    const t0 = toServiceSeconds(net, q.departAt);
    const o = { walkMetersPerMin: q.walkMetersPerMin, allowed: patternMask(net) };
    const g = rangeRaptor(net, { access: accessStops(net, q.from, o), egress: egressStops(net, q.to, o), t0, allowed: o.allowed, walkMetersPerMin: q.walkMetersPerMin });
    let step = g.next();
    while (!step.done) step = g.next();
    const cands = step.value.map((r) => summarize(net, r, t0));
    const walk = walkOnlyCandidate(q.from, q.to, t0, q.walkMetersPerMin);
    if (walk) cands.push(walk);
    // Every candidate that survives ranking, not just the top 5; toItinerary throws on a bug.
    const all = rankCandidates(cands, t0, cands.length);
    const its: Itinerary[] = all.map((r) => toItinerary(net, q, r));
    assert.deepEqual(
      its.map((it) => [it.arriveAt, it.walkMeters, it.rides]),
      all.map((r) => [toEpochMs(net, r.cand.arrive), r.cand.walkMeters, r.cand.rides]),
    );
    assertConsistent(net, q, { itineraries: its.slice(0, 5), excludedFeeds: [] });
  }
});
