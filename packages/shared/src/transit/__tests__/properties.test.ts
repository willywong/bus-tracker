import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { TransitNetwork } from "../network.js";
import { planSync, type Itinerary, type Leg, type Place, type PlanQuery, type PlanResult } from "../plan.js";
import { CHANGE_SEC } from "../raptor.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";

/** Seeded uniform [0, 1) (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2026-10-28 00:00 MYT. */
const DAY_0000 = Date.UTC(2026, 9, 27, 16, 0);
/** Spec §3.1's bbox. */
const BBOX = { lat: [2.7, 3.45], lng: [101.25, 101.95] } as const;
const TAGS = new Set(["fastest", "fewer-changes", "less-walking"]);
/** Access walks: 1,000 m straight line × 1.25 detour. */
const END_WALK_MAX = 1000 * 1.25 + 1;
/** 14/04: an egress walk can absorb a transfer walk (longest fixture transfer 498 m walked). */
const LAST_WALK_MAX = 1000 * 1.25 + 500;
const WALK_ONLY_MAX = 2000;

/** Plan 14/06 step 5: 100 bbox pairs, then 100 pairs near random stops (±0.003°). */
function queries(net: TransitNetwork): PlanQuery[] {
  const rand = mulberry32(20261028);
  const between = ([lo, hi]: readonly [number, number]) => lo + rand() * (hi - lo);
  const place = (lat: number, lng: number): Place => ({ kind: "place", name: "p", lat, lng });
  const inBox = () => place(between(BBOX.lat), between(BBOX.lng));
  const nearStop = () => {
    const s = Math.floor(rand() * net.stops.count);
    return place(net.stops.lat[s] + (rand() * 2 - 1) * 0.003, net.stops.lon[s] + (rand() * 2 - 1) * 0.003);
  };
  const out: PlanQuery[] = [];
  for (let i = 0; i < 200; i++) {
    const end = i < 100 ? inBox : nearStop;
    const from = end();
    const to = end();
    // 06:00–21:00, whole minutes.
    const departAt = DAY_0000 + (6 * 60 + Math.floor(rand() * (15 * 60 + 1))) * 60_000;
    const walkMetersPerMin = [60, 80, 100][Math.floor(rand() * 3)];
    out.push({ from, to, departAt, walkMetersPerMin });
  }
  return out;
}

const samePoint = (a: Leg["to"], b: Leg["from"]) =>
  a.stop !== undefined || b.stop !== undefined ? a.stop === b.stop : a.lat === b.lat && a.lng === b.lng;

/** Properties 2–5 on one itinerary. */
function checkItinerary(q: PlanQuery, it: Itinerary): void {
  const legs = it.legs;
  assert.ok(legs.length >= 1, "at least one leg");
  assert.ok(it.rides <= 4, "≤ 4 rides");
  assert.equal(it.rides, legs.filter((l) => l.kind === "ride").length, "rides counts ride legs");
  // 2. Monotonic times.
  assert.equal(it.departAt, legs[0].from.time, "departAt is the first leg's start");
  assert.equal(it.arriveAt, legs.at(-1)!.to.time, "arriveAt is the last leg's end");
  assert.ok(it.departAt >= q.departAt, "leaves no earlier than asked");
  assert.ok(it.arriveAt > it.departAt, "arrives after it leaves");
  for (const [j, l] of legs.entries()) {
    assert.ok(l.from.time <= l.to.time, `leg ${j} ends before it starts`);
    if (l.kind === "ride") {
      let prev = l.from.time;
      for (const v of l.via) {
        assert.ok(v.time >= prev && v.time <= l.to.time, `leg ${j} via out of order`);
        prev = v.time;
      }
    }
    if (j === 0) continue;
    const p = legs[j - 1];
    assert.ok(p.to.time <= l.from.time, `leg ${j} starts before leg ${j - 1} ends`);
    // 3. Continuity.
    assert.ok(samePoint(p.to, l.from), `legs ${j - 1} and ${j} do not meet`);
    // 5. Never two walks in a row.
    assert.ok(!(p.kind === "walk" && l.kind === "walk"), `two walks in a row at ${j}`);
  }
  // 4. Transfers: the walks between two rides fit, and a same-stop change keeps CHANGE_SEC.
  let lastRide = -1;
  for (const [j, l] of legs.entries()) {
    if (l.kind !== "ride") continue;
    if (lastRide >= 0) {
      const prev = legs[lastRide];
      const between = legs.slice(lastRide + 1, j);
      const walkSec = between.reduce((s, w) => s + (w.kind === "walk" ? w.seconds : 0), 0);
      assert.ok(l.from.time >= prev.to.time + walkSec * 1000, `transfer into leg ${j} is too short for its walk`);
      if (between.length === 0) {
        assert.equal(l.from.stop, prev.to.stop, `same-stop change at ${j}`);
        assert.ok(l.from.time >= prev.to.time + CHANGE_SEC * 1000, `change into leg ${j} under CHANGE_SEC`);
      }
    }
    lastRide = j;
  }
  // 5. Walk limits.
  const first = legs[0];
  const last = legs.at(-1)!;
  if (it.rides === 0) {
    assert.equal(legs.length, 1, "walk-only is one leg");
    assert.ok(first.kind === "walk" && first.meters < WALK_ONLY_MAX, `walk-only ${first.kind === "walk" ? first.meters : "?"} m`);
  } else {
    if (first.kind === "walk") assert.ok(first.meters <= END_WALK_MAX, `first walk ${first.meters} m`);
    if (last.kind === "walk") assert.ok(last.meters <= LAST_WALK_MAX, `last walk ${last.meters} m`);
  }
}

/** Property 1 and 6 on one result, then every itinerary. Throws with the query and the offending itinerary. */
function checkResult(q: PlanQuery, res: PlanResult): void {
  const its = res.itineraries;
  const ctx = (msg: string, it?: Itinerary) =>
    `${msg}\nquery ${JSON.stringify(q)}${it ? `\nitinerary ${JSON.stringify(it)}` : ""}`;
  assert.deepEqual(res.excludedFeeds, [], ctx("excludedFeeds on the full network"));
  assert.ok(its.length <= 5, ctx(`${its.length} itineraries`));
  assert.equal(new Set(its.map((it) => it.id)).size, its.length, ctx("ids not unique"));
  for (const [i, it] of its.entries()) {
    try {
      assert.ok(it.tags.every((t) => TAGS.has(t)), `tags ${it.tags}`);
      assert.equal(it.tags.includes("fastest"), i === 0, `fastest on index ${i}`);
      // 6. Index 0 has the minimum arriveAt.
      assert.ok(its[0].arriveAt <= it.arriveAt, `index ${i} arrives before index 0`);
      checkItinerary(q, it);
    } catch (e) {
      throw new assert.AssertionError({ message: ctx(`itinerary ${i}: ${(e as Error).message}`, it) });
    }
  }
}

const quantile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

test("200 seeded random queries: every itinerary is internally consistent (README criterion 2)", () => {
  const net = fixtureNetwork();
  const qs = queries(net);
  planSync(net, qs[100]); // warm-up
  const ms: number[] = [];
  let withTransit = 0;
  let walkOnly = 0;
  let total = 0;
  for (const q of qs) {
    const t = performance.now();
    const res = planSync(net, q);
    ms.push(performance.now() - t);
    checkResult(q, res);
    total += res.itineraries.length;
    if (res.itineraries.some((it) => it.rides > 0)) withTransit++;
    if (res.itineraries.some((it) => it.rides === 0)) walkOnly++;
  }
  ms.sort((a, b) => a - b);
  console.log(
    `properties: ${qs.length} queries, ${total} itineraries (${withTransit} with transit, ${walkOnly} with walk-only); ` +
      `planSync p50 ${quantile(ms, 0.5).toFixed(2)} ms, p95 ${quantile(ms, 0.95).toFixed(2)} ms, max ${ms.at(-1)!.toFixed(2)} ms`,
  );
  // The stop-anchored half must exercise the engine, not just the empty bbox corners.
  assert.ok(withTransit >= 50, `only ${withTransit} queries found transit`);
});
