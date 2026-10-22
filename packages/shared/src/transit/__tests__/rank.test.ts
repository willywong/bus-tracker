import assert from "node:assert/strict";
import test from "node:test";

import { journeySignature, paretoFilter, rankCandidates, scoreOf, summarize, type Candidate } from "../rank.js";
import type { RawJourney } from "../range.js";
import { tinyNetwork } from "./helpers/tiny-network.js";

const T0 = 8 * 3600;
const min = (m: number) => T0 + m * 60;

/** A candidate leaving at t0 with one ride and no walking, overridden by `c`. */
function cand(name: string, c: Partial<Candidate> = {}): Candidate {
  return { raw: null, leave: T0, arrive: min(30), rides: 1, walkSec: 0, walkMeters: 0, firstWaitSec: 0, signature: name, ...c };
}
const names = (r: { cand: Candidate }[]) => r.map((x) => x.cand.signature);
const tagsOf = (r: { cand: Candidate; tags: string[] }[]) => Object.fromEntries(r.map((x) => [x.cand.signature, x.tags.join(",")]));

test("pareto drops dominated", () => {
  const a = cand("a", { leave: min(0), arrive: min(30), rides: 2 });
  const b = cand("b", { leave: min(5), arrive: min(30), rides: 2 }); // leaves later: dominates a
  const c = cand("c", { leave: min(0), arrive: min(40), rides: 1 }); // fewer rides: kept
  const d = cand("d", { leave: min(5), arrive: min(30), rides: 2 }); // identical to b: both kept
  const e = cand("e", { leave: min(10), arrive: min(25), rides: 3 }); // later, earlier, more rides: kept
  assert.deepEqual(
    paretoFilter([a, b, c, d, e]).map((x) => x.signature),
    ["b", "c", "d", "e"],
  );
});

test("drops arrivals more than 30 min after the fastest", () => {
  const r = rankCandidates(
    [
      cand("fast", { arrive: min(20), rides: 3 }),
      cand("edge", { arrive: min(50), rides: 2 }),
      cand("late", { arrive: min(50) + 1, rides: 1 }),
    ],
    T0,
  );
  assert.deepEqual(names(r), ["fast", "edge"]);
});

test("score formula matches spec §4.2", () => {
  // Arrival only: minutes after t0.
  assert.equal(scoreOf(cand("a", { arrive: min(30), rides: 1 }), T0), 30);
  // 3 min per transfer (rides − 1); a walk-only option (0 rides) has none.
  assert.equal(scoreOf(cand("b", { arrive: min(30), rides: 3 }), T0), 36);
  assert.equal(scoreOf(cand("w", { arrive: min(30), rides: 0 }), T0), 30);
  // 1.5 × walk minutes beyond 5.
  assert.equal(scoreOf(cand("c", { arrive: min(30), walkSec: 5 * 60 }), T0), 30);
  assert.equal(scoreOf(cand("d", { arrive: min(30), walkSec: 9 * 60 }), T0), 36);
  // 2 min if the first wait is over 15 min.
  assert.equal(scoreOf(cand("e", { arrive: min(30), firstWaitSec: 900 }), T0), 30);
  assert.equal(scoreOf(cand("f", { arrive: min(30), firstWaitSec: 901 }), T0), 32);
  // All at once.
  assert.equal(scoreOf(cand("g", { arrive: min(45), rides: 2, walkSec: 7 * 60, firstWaitSec: 1200 }), T0), 45 + 3 + 3 + 2);
});

test("fastest is always first", () => {
  // The fastest arrives first but scores worst (lots of walking and changes).
  const fastest = cand("fastest", { arrive: min(20), rides: 4, walkSec: 20 * 60, walkMeters: 1600 });
  const r = rankCandidates(
    [fastest, cand("a", { arrive: min(25), rides: 1, leave: min(1) }), cand("b", { arrive: min(26), rides: 2, leave: min(2) })],
    T0,
  );
  assert.deepEqual(names(r), ["fastest", "a", "b"]);
  assert.ok(scoreOf(fastest, T0) > r[1].score);
  assert.equal(r[0].tags[0], "fastest");
  // Even when its score would not make the top `limit`.
  assert.deepEqual(names(rankCandidates([fastest, cand("a", { arrive: min(25), leave: min(1) })], T0, 1)), ["fastest"]);
});

test("fastest stays first when a better-scoring option shares its signature", () => {
  const r = rankCandidates(
    [
      cand("T816", { leave: min(0), arrive: min(30), walkSec: 10 * 60 }), // 30 + 7.5
      cand("T816", { leave: min(5), arrive: min(31) }), // 31: better score, arrives later
    ],
    T0,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].cand.arrive, min(30));
});

test("fewer-changes is guaranteed a slot when it differs", () => {
  // Five fast 3–4 ride options outscore the single direct bus, which arrives 25 min later.
  const many = [0, 1, 2, 3, 4].map((i) => cand(`m${i}`, { arrive: min(20 + i), rides: i === 0 ? 4 : 3, leave: min(i) }));
  const direct = cand("direct", { arrive: min(45), rides: 1 });
  assert.ok(scoreOf(direct, T0) > scoreOf(many[4], T0));
  const r = rankCandidates([...many, direct], T0);
  assert.equal(r.length, 5);
  assert.equal(r[0].cand.signature, "m0");
  assert.ok(names(r).includes("direct"));
  assert.ok(!names(r).includes("m4"), "replaces the last non-guaranteed pick");
  assert.deepEqual(tagsOf(r), { m0: "fastest", m1: "", m2: "", m3: "", direct: "fewer-changes" });
  // Score order after index 0.
  for (let i = 2; i < r.length; i++) assert.ok(r[i - 1].score <= r[i].score);
  // Not tagged when the fastest already has as few rides.
  const same = rankCandidates([cand("a", { arrive: min(20), rides: 1 }), cand("b", { arrive: min(25), rides: 1, leave: min(1) })], T0);
  assert.deepEqual(tagsOf(same), { a: "fastest", b: "" });
});

test("less-walking needs ≥ 100 m less", () => {
  const fastest = cand("fastest", { arrive: min(20), walkMeters: 800, walkSec: 600 });
  const near = cand("near", { arrive: min(22), walkMeters: 701, leave: min(1) });
  assert.deepEqual(tagsOf(rankCandidates([fastest, near], T0)), { fastest: "fastest", near: "" });
  const far = cand("far", { arrive: min(22), walkMeters: 700, leave: min(1) });
  assert.deepEqual(tagsOf(rankCandidates([fastest, far], T0)), { fastest: "fastest", far: "less-walking" });
  // Guaranteed a slot, like fewer-changes.
  const many = [1, 2, 3, 4, 5].map((i) => cand(`m${i}`, { arrive: min(20 + i), walkMeters: 800, leave: min(i) }));
  const lessWalk = cand("lw", { arrive: min(40), walkMeters: 100, leave: min(6) });
  const r = rankCandidates([fastest, ...many, lessWalk], T0);
  assert.equal(r.length, 5);
  assert.ok(names(r).includes("lw"));
  assert.ok(r.find((x) => x.cand.signature === "lw")!.tags.includes("less-walking"));
});

test("both guaranteed picks keep their slots", () => {
  const fastest = cand("fastest", { arrive: min(20), rides: 3, walkMeters: 900 });
  const many = [1, 2, 3, 4, 5].map((i) => cand(`m${i}`, { arrive: min(20 + i), rides: 3, walkMeters: 900, leave: min(i) }));
  const fewer = cand("fewer", { arrive: min(45), rides: 1, walkMeters: 900, leave: min(6) });
  const lessWalk = cand("lw", { arrive: min(46), rides: 2, walkMeters: 100, leave: min(7) });
  const r = rankCandidates([fastest, ...many, fewer, lessWalk], T0);
  assert.deepEqual(names(r), ["fastest", "m1", "m2", "fewer", "lw"]);
  assert.deepEqual(tagsOf(r), { fastest: "fastest", m1: "", m2: "", fewer: "fewer-changes", lw: "less-walking" });
});

test("identical signatures dedupe to the better score", () => {
  const r = rankCandidates(
    [
      cand("fast", { arrive: min(10), rides: 2 }),
      cand("T816", { leave: min(4), arrive: min(30), walkSec: 10 * 60 }), // 30 + 7.5
      cand("T816", { leave: min(5), arrive: min(31) }), // 31
      cand("KJ", { leave: min(6), arrive: min(33), firstWaitSec: 1000 }), // 33 + 2
      cand("KJ", { leave: min(7), arrive: min(35) }), // 35 too, leaves later
    ],
    T0,
  );
  assert.deepEqual(
    r.map((x) => [x.cand.signature, x.cand.leave]),
    [
      ["fast", T0],
      ["T816", min(5)],
      ["KJ", min(7)],
    ],
  );
});

test("walk-only never gets fewer-changes", () => {
  const walk = cand("walk", { rides: 0, arrive: min(25), walkSec: 25 * 60, walkMeters: 1900 });
  const r = rankCandidates([cand("bus", { arrive: min(15), rides: 2, walkMeters: 2000, leave: min(3) }), walk], T0);
  assert.deepEqual(names(r), ["bus", "walk"]);
  assert.deepEqual(tagsOf(r), { bus: "fastest", walk: "less-walking" });
  // The one-ride option takes the tag, not the walk.
  const direct = cand("direct", { arrive: min(30), rides: 1, walkMeters: 2000, leave: min(1) });
  assert.deepEqual(tagsOf(rankCandidates([cand("bus", { arrive: min(15), rides: 2, walkMeters: 2000, leave: min(3) }), walk, direct], T0)), {
    bus: "fastest",
    walk: "less-walking",
    direct: "fewer-changes",
  });
});

test("returns at most 5", () => {
  const cs = Array.from({ length: 12 }, (_, i) => cand(`c${i}`, { arrive: min(20 + i), leave: min(i), rides: 1 }));
  assert.equal(rankCandidates(cs, T0).length, 5);
  assert.equal(rankCandidates(cs, T0, 3).length, 3);
  assert.deepEqual(rankCandidates([], T0), []);
});

test("journeySignature: ride legs only, by route label and stop ids", () => {
  const at = (h: number, m = 0) => h * 3600 + m * 60;
  const net = tinyNetwork({
    stops: ["A", "B", "C", "D"].map((id, i) => ({ id, lat: 3.1, lon: 101.6 + i * 0.001 })),
    patterns: [
      { route: "T816", stops: ["A", "B"], trips: [[at(8), at(8, 5)]] },
      { route: "KJ", mode: "lrt", stops: ["C", "D"], trips: [[at(8, 10), at(8, 20)]] },
    ],
    transfers: [{ a: "B", b: "C", seconds: 150 }],
  });
  const raw: RawJourney = {
    legs: [
      { kind: "access", stop: 0, seconds: 120, meters: 160 },
      { kind: "ride", pattern: 0, boardPos: 0, alightPos: 1, trip: 0, window: -1, boardTime: at(8) },
      { kind: "walk", from: 1, to: 2, seconds: 150, transferKind: 0 },
      { kind: "ride", pattern: 1, boardPos: 0, alightPos: 1, trip: 0, window: -1, boardTime: at(8, 10) },
    ],
    rides: 2,
    run: at(7, 50),
    arrive: at(8, 21),
    egress: { stop: 3, seconds: 60, meters: 80 },
  };
  assert.equal(journeySignature(net, raw), "T816:A>B|KJ:C>D");
  assert.equal(journeySignature(net, null), "walk");
  const c = summarize(net, raw, at(7, 50));
  assert.equal(c.signature, "T816:A>B|KJ:C>D");
  assert.equal(c.leave, at(7, 57), "08:00 − 120 s − 60 s");
  assert.equal(c.arrive, at(8, 21));
  assert.equal(c.rides, 2);
  assert.equal(c.walkSec, 120 + 150 + 60);
  const transfer = Math.round(
    1.25 * 6_371_000 * 2 * Math.asin(Math.sqrt(Math.cos((3.1 * Math.PI) / 180) ** 2 * Math.sin((0.001 * Math.PI) / 360) ** 2)),
  );
  assert.ok(Math.abs(c.walkMeters - (160 + transfer + 80)) <= 1, `${c.walkMeters}`);
  assert.equal(c.firstWaitSec, at(8) - (at(7, 50) + 120));
  assert.equal(c.raw, raw);
});
