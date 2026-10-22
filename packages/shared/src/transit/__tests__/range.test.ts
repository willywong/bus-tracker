import assert from "node:assert/strict";
import test from "node:test";

import { earliestBoardInto, type BoardOut } from "../boarding.js";
import { stopsNear } from "../compile.js";
import type { TransitNetwork } from "../network.js";
import { MAX_RIDES, runRounds, startDeparture, type RawLeg, type StopTime } from "../raptor.js";
import { rangeRaptor, type RangeInput, type RawJourney } from "../range.js";
import { latestLeave, rankCandidates, summarize } from "../rank.js";
import { DETOUR_FACTOR } from "../transfers.js";
import { haversineMeters } from "../../utils/outlier.js";
import { resetWorkspace, workspaceFor } from "../workspace.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";
import { replay } from "./helpers/replay.js";
import { tinyNetwork } from "./helpers/tiny-network.js";

const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

/** Stops `S0`, `S1`, … about 100 m apart along a parallel. */
const stopsOf = (...ids: string[]) => ids.map((id, i) => ({ id, lat: 3.1, lon: 101.6 + i * 0.001 }));
const idx = (net: TransitNetwork, id: string) => {
  const i = net.stops.id.indexOf(id);
  assert.ok(i >= 0, `stop ${id}`);
  return i;
};
const allPatterns = (net: TransitNetwork) => new Uint8Array(net.patterns.count).fill(1);
const stopTime = (net: TransitNetwork, id: string, seconds = 0): StopTime[] => [{ stop: idx(net, id), seconds, meters: seconds }];
const rides = (j: RawJourney) => j.legs.filter((l): l is Extract<RawLeg, { kind: "ride" }> => l.kind === "ride");

/** {@link rangeRaptor} drained, with the number of yields. */
function drain(net: TransitNetwork, inp: Partial<RangeInput> & Pick<RangeInput, "access" | "egress" | "t0">): { out: RawJourney[]; yields: number } {
  const g = rangeRaptor(net, { allowed: allPatterns(net), walkMetersPerMin: 80, ...inp });
  let yields = 0;
  for (;;) {
    const step = g.next();
    if (step.done) return { out: step.value, yields };
    yields++;
  }
}

/** Patterns queued by one fresh departure. */
function freshScans(net: TransitNetwork, access: StopTime[], egress: StopTime[], dep: number): number {
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  startDeparture(ws, access, dep);
  const r = runRounds(net, ws, { egress, maxRides: MAX_RIDES, allowed: allPatterns(net), walkMetersPerMin: 80 });
  while (!r.next().done);
  return ws.scans;
}

/** A → B → C every 10 min from 08:00 to 08:20, 5 min a hop. */
function oneLine(): TransitNetwork {
  return tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [{ route: "L", stops: ["A", "B", "C"], trips: [0, 10, 20].map((m) => [at(8, m), at(8, m + 5), at(8, m + 10)]) }],
  });
}

test("latest run first: a later departure with the same arrival dominates", () => {
  const net = oneLine();
  // Runs 08:00, 07:58, …, 07:52 all catch the 08:00 trip.
  const { out } = drain(net, { access: stopTime(net, "A"), egress: stopTime(net, "C"), t0: at(7, 52), windowSec: 480 });
  assert.equal(out.length, 1);
  assert.equal(out[0].run, at(8));
  assert.equal(out[0].arrive, at(8, 10));
  assert.equal(out[0].rides, 1);
});

test("two rides arriving earlier and one ride arriving later are both kept", () => {
  const net = tinyNetwork({
    stops: stopsOf("O", "X", "D"),
    patterns: [
      { route: "SLOW", stops: ["O", "D"], trips: [[at(8), at(9)]] },
      { route: "F1", stops: ["O", "X"], trips: [[at(8), at(8, 10)]] },
      { route: "F2", stops: ["X", "D"], trips: [[at(8, 15), at(8, 40)]] },
    ],
  });
  const { out } = drain(net, { access: stopTime(net, "O"), egress: stopTime(net, "D", 30), t0: at(8), windowSec: 0 });
  assert.deepEqual(
    out.map((j) => [j.rides, j.arrive, rides(j).map((l) => net.routes.label[net.patterns.route[l.pattern]]).join(">")]),
    [
      [1, at(9, 0, 30), "SLOW"],
      [2, at(8, 40, 30), "F1>F2"],
    ],
  );
  assert.equal(out[1].egress.seconds, 30);
});

test("labels are reused: the second run scans fewer patterns", () => {
  const net = oneLine();
  const access = stopTime(net, "A");
  const egress = stopTime(net, "C");
  const first = freshScans(net, access, egress, at(8));
  const second = freshScans(net, access, egress, at(7, 58));
  assert.equal(second, first, "on its own, 07:58 does the same work as 08:00");
  // 08:00 then 07:58: the second run catches the same trip, improves nothing and stops after round 1.
  drain(net, { access, egress, t0: at(7, 58), windowSec: 120 });
  const reused = workspaceFor(net).scans - first;
  assert.ok(reused < second, `second run queued ${reused} patterns, ${second} from scratch`);
});

test("journeys are backtracked in the run that found them", () => {
  const net = oneLine();
  // Runs 08:10 (trip 1) and 08:00 (trip 0).
  const { out } = drain(net, { access: stopTime(net, "A"), egress: stopTime(net, "C"), t0: at(8), windowSec: 600, stepSec: 600 });
  assert.deepEqual(
    out.map((j) => [j.run, j.arrive, rides(j)[0].trip]),
    [
      [at(8, 10), at(8, 20), 1],
      [at(8), at(8, 10), 0],
    ],
  );
});

test("headway first ride: leave equals the run time", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [{ route: "H", mode: "lrt", stops: ["A", "B", "C"], freq: [{ start: at(8), end: at(9), headway: 600, offsets: [0, 300, 600] }] }],
  });
  const { out } = drain(net, { access: stopTime(net, "A", 60), egress: stopTime(net, "C"), t0: at(8), windowSec: 240 });
  // Ready at run + 60 s, board after half a headway (300 s), 600 s to C.
  assert.deepEqual(
    out.map((j) => [j.run, j.arrive]),
    [at(8, 4), at(8, 2), at(8)].map((d) => [d, d + 60 + 300 + 600]),
  );
  for (const j of out) {
    assert.equal(rides(j)[0].window, 0);
    assert.equal(latestLeave(net, j), j.run);
    assert.equal(summarize(net, j, at(8)).leave, j.run);
  }
});

test("timetabled first ride: leave is the latest that still catches it (≤ 60 s at the stop)", () => {
  const net = oneLine();
  const { out } = drain(net, { access: stopTime(net, "A", 120), egress: stopTime(net, "C"), t0: at(7, 50), windowSec: 0 });
  assert.equal(out.length, 1);
  // Board 08:00 after a 120 s walk: leave 07:57, not the 07:50 run.
  assert.equal(latestLeave(net, out[0]), at(7, 57));
  const c = summarize(net, out[0], at(7, 50));
  assert.equal(c.leave, at(7, 57));
  assert.equal(c.firstWaitSec, at(8) - (at(7, 50) + 120));
});

test("rangeRaptor yields between rounds and between runs", () => {
  const net = oneLine();
  // 08:00: 2 rounds (round 2 rescans from B); 07:58: 1 round (nothing improves). Plus one yield per run.
  const { yields } = drain(net, { access: stopTime(net, "A"), egress: stopTime(net, "C"), t0: at(7, 58), windowSec: 120 });
  assert.equal(yields, 2 + 1 + 1 + 1);
  const g = rangeRaptor(net, { access: stopTime(net, "A"), egress: stopTime(net, "C"), t0: at(7, 58), windowSec: 120, allowed: allPatterns(net), walkMetersPerMin: 80 });
  assert.equal(g.next().done, false, "round 1 of the first run");
  assert.equal(workspaceFor(net).destBest[1], at(8, 10), "the first yield comes after a round");
});

// --- Fixture network ---------------------------------------------------------

/** Stops within 1,000 m of a point, nearest 25, walked × 1.25 at 80 m/min (spec §4.1). */
function nearStops(net: TransitNetwork, lat: number, lng: number): StopTime[] {
  return stopsNear(net, lat, lng, 1000)
    .map((stop) => {
      const meters = haversineMeters({ lat, lng }, { lat: net.stops.lat[stop], lng: net.stops.lon[stop] });
      return { stop, meters: Math.round(meters * DETOUR_FACTOR), seconds: Math.ceil((meters * DETOUR_FACTOR) / (80 / 60)), straight: meters };
    })
    .sort((a, b) => a.straight - b.straight || a.stop - b.stop)
    .slice(0, 25)
    .map(({ stop, meters, seconds }) => ({ stop, meters, seconds }));
}

const HOTEL_LISA = { lat: 3.118231, lng: 101.63065 };
const KLCC = { lat: 3.158935, lng: 101.713287 };
const PJ14 = { lat: 3.110474, lng: 101.636336 };
const KL_SENTRAL = { lat: 3.133636, lng: 101.687034 };
const SUBANG_JAYA = { lat: 3.083, lng: 101.589 };
const BUKIT_BINTANG = { lat: 3.146262, lng: 101.711224 };

test("Hotel Lisa De Inn → KLCC at 08:00 ranks ≥ 2 candidates, the earliest arrival first", () => {
  const net = fixtureNetwork();
  const t0 = at(8);
  const { out } = drain(net, { access: nearStops(net, HOTEL_LISA.lat, HOTEL_LISA.lng), egress: nearStops(net, KLCC.lat, KLCC.lng), t0 });
  const ranked = rankCandidates(
    out.map((j) => summarize(net, j, t0)),
    t0,
  );
  assert.ok(ranked.length >= 2, `${ranked.length} candidates`);
  assert.equal(ranked[0].cand.arrive, Math.min(...ranked.map((r) => r.cand.arrive)));
  assert.ok(ranked[0].tags.includes("fastest"));
});

test("fixture goldens: every journey belongs to its run and replays by its arrival", () => {
  const b: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  for (const [o, d] of [
    [HOTEL_LISA, KLCC],
    [PJ14, KL_SENTRAL],
    [SUBANG_JAYA, BUKIT_BINTANG],
  ]) {
    const net = fixtureNetwork();
    const egress = nearStops(net, d.lat, d.lng);
    const { out } = drain(net, { access: nearStops(net, o.lat, o.lng), egress, t0: at(8) });
    assert.ok(out.length > 0);
    for (const j of out) {
      const access = j.legs[0];
      const first = rides(j)[0];
      assert.equal(access.kind, "access");
      assert.equal(j.rides, rides(j).length);
      assert.ok(j.rides >= 1 && j.rides <= MAX_RIDES);
      // The run's own access label boards the first vehicle: no chain from a later run.
      assert.ok(earliestBoardInto(net, first.pattern, first.boardPos, j.run + (access.kind === "access" ? access.seconds : 0), b));
      assert.deepEqual([b.trip, b.window, b.dep], [first.trip, first.window, first.boardTime], `run ${j.run}`);
      const end = replay(net, j.legs, j.run, j.egress.stop);
      assert.ok(end + j.egress.seconds <= j.arrive, `replays to ${end} + ${j.egress.seconds}, label ${j.arrive}`);
    }
    // Pareto in (run, arrive, rides): no journey is matched or beaten on every axis by a later-run one.
    for (const a of out) {
      for (const c of out) {
        if (a === c) continue;
        assert.ok(!(c.run >= a.run && c.arrive <= a.arrive && c.rides <= a.rides && c.run !== a.run), "dominated by a later run");
      }
    }
  }
});
