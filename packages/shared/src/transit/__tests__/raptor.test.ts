import assert from "node:assert/strict";
import test from "node:test";

import { arrAt, depAt, earliestBoard, earliestBoardInto, type BoardOut } from "../boarding.js";
import { stopsNear } from "../compile.js";
import { TRANSFER_KIND, type TransitNetwork } from "../network.js";
import {
  backtrack,
  CHANGE_SEC,
  INF,
  Lbl,
  MAX_RIDES,
  runRounds,
  scaledTransferSeconds,
  startDeparture,
  type RawLeg,
  type StopTime,
} from "../raptor.js";
import { DETOUR_FACTOR } from "../transfers.js";
import { haversineMeters } from "../../utils/outlier.js";
import { resetWorkspace, workspaceFor, type Workspace } from "../workspace.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";
import { tinyNetwork, type TinyPattern } from "./helpers/tiny-network.js";

const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

/** Stops `S0`, `S1`, … about 100 m apart along a parallel. */
const stopsOf = (...ids: string[]) => ids.map((id, i) => ({ id, lat: 3.1, lon: 101.6 + i * 0.001 }));
const idx = (net: TransitNetwork, id: string) => {
  const i = net.stops.id.indexOf(id);
  assert.ok(i >= 0, `stop ${id}`);
  return i;
};
const allPatterns = (net: TransitNetwork) => new Uint8Array(net.patterns.count).fill(1);

interface Run {
  ws: Workspace;
  yields: number;
}

/** One departure: a fresh workspace, access labels, then every round. */
function run(
  net: TransitNetwork,
  access: readonly StopTime[],
  dep: number,
  opts: { egress?: readonly StopTime[]; maxRides?: number; walkMetersPerMin?: number; allowed?: Uint8Array } = {},
): Run {
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  startDeparture(ws, access, dep);
  let yields = 0;
  const rounds = runRounds(net, ws, {
    egress: opts.egress ?? [],
    maxRides: opts.maxRides ?? MAX_RIDES,
    allowed: opts.allowed ?? allPatterns(net),
    walkMetersPerMin: opts.walkMetersPerMin ?? 80,
  });
  for (let step = rounds.next(); !step.done; step = rounds.next()) yields++;
  return { ws, yields };
}
const from = (net: TransitNetwork, id: string): StopTime[] => [{ stop: idx(net, id), seconds: 0, meters: 0 }];
const tauAt = (ws: Workspace, k: number, stop: number) => ws.tau[k * ws.n + stop];
const kinds = (legs: RawLeg[]) => legs.map((l) => l.kind).join(",");

/**
 * Replays `legs` forward from `dep` (access → … → `stop`), checking every
 * boarding is reachable, and returns the arrival.
 */
function replay(net: TransitNetwork, legs: RawLeg[], dep: number, stop: number): number {
  const P = net.patterns;
  let t = INF;
  let at = -1;
  let rode = false;
  for (const leg of legs) {
    if (leg.kind === "access") {
      assert.equal(at, -1, "access comes first");
      at = leg.stop;
      t = dep + leg.seconds;
    } else if (leg.kind === "walk") {
      assert.ok(rode, "a walk follows a ride");
      assert.equal(leg.from, at);
      at = leg.to;
      t += leg.seconds;
      rode = false;
    } else {
      assert.equal(P.stops[P.stopStart[leg.pattern] + leg.boardPos], at, "boards where the last leg ended");
      assert.ok(leg.alightPos > leg.boardPos);
      const ride = leg.trip >= 0 ? { kind: 0 as const, trip: leg.trip, window: -1, start: -1 } : freqRide(net, leg);
      assert.equal(depAt(net, leg.pattern, ride, leg.boardPos), leg.boardTime);
      assert.ok(leg.boardTime >= t + (rode ? CHANGE_SEC : 0), `boards at ${leg.boardTime}, ready at ${t}`);
      at = P.stops[P.stopStart[leg.pattern] + leg.alightPos];
      t = arrAt(net, leg.pattern, ride, leg.alightPos);
      rode = true;
    }
  }
  assert.equal(at, stop, "ends at the stop");
  return t;
}
const freqRide = (net: TransitNetwork, leg: Extract<RawLeg, { kind: "ride" }>) => ({
  kind: 1 as const,
  trip: -1,
  window: leg.window,
  start: leg.boardTime - net.patterns.runOffset[net.patterns.stopStart[leg.pattern] + leg.boardPos],
});

// ---------------------------------------------------------------------------

/** A → B → C every 10 min from 08:00 to 08:20, 5 min a hop. */
function oneLine(): TransitNetwork {
  return tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [{ route: "L", stops: ["A", "B", "C"], trips: [0, 10, 20].map((m) => [at(8, m), at(8, m + 5), at(8, m + 10)]) }],
  });
}

test("one line: boards the first trip departing at or after t", () => {
  const net = oneLine();
  const [A, C] = [idx(net, "A"), idx(net, "C")];
  let { ws } = run(net, from(net, "A"), at(8, 5));
  assert.equal(tauAt(ws, 1, C), at(8, 20), "the 08:10 trip");
  const legs = backtrack(net, ws, 1, C);
  assert.equal(kinds(legs), "access,ride");
  assert.deepEqual(legs[0], { kind: "access", stop: A, seconds: 0, meters: 0 });
  assert.deepEqual(legs[1], { kind: "ride", pattern: 0, boardPos: 0, alightPos: 2, trip: 1, window: -1, boardTime: at(8, 10) });

  ({ ws } = run(net, from(net, "A"), at(8, 10)));
  assert.equal(tauAt(ws, 1, C), at(8, 20), "a trip leaving exactly at t is caught");
});

test("after the last trip the stop stays INF", () => {
  const net = oneLine();
  const { ws, yields } = run(net, from(net, "A"), at(8, 20, 1));
  assert.equal(tauAt(ws, 1, idx(net, "C")), INF);
  assert.equal(ws.lbl[ws.n + idx(net, "C")], Lbl.None);
  assert.equal(yields, 1, "round 1 marks nothing, so round 2 never runs");
});

test("two lines, same-stop change honours CHANGE_SEC", () => {
  const net = tinyNetwork({
    stops: stopsOf("O", "X", "D"),
    patterns: [
      { route: "L1", stops: ["O", "X"], trips: [[at(8), at(8, 10)]] },
      // Leaves X 30 s, then 60 s after L1 arrives.
      { route: "L2", stops: ["X", "D"], trips: [[at(8, 10, 30), at(8, 20, 30)], [at(8, 11), at(8, 21)]] },
    ],
  });
  const D = idx(net, "D");
  const { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 2, D), at(8, 21), "misses the 30 s connection, catches the 60 s one");
  const legs = backtrack(net, ws, 2, D);
  assert.equal(kinds(legs), "access,ride,ride");
  assert.equal(legs[2].kind === "ride" && legs[2].trip, 1);
  assert.equal(replay(net, legs, at(8), D), at(8, 21));
});

test("a walk arriving within CHANGE_SEC after a ride still boards first", () => {
  // At S: L1 arrives 08:10:00 (ready 08:11:00); L2 + 70 s walk arrives 08:10:10 (ready at once).
  const net = tinyNetwork({
    stops: stopsOf("O", "X", "S", "D"),
    patterns: [
      { route: "L1", stops: ["O", "S"], trips: [[at(8), at(8, 10)]] },
      { route: "L2", stops: ["O", "X"], trips: [[at(8), at(8, 9)]] },
      { route: "L3", stops: ["S", "D"], trips: [[at(8, 10, 30), at(8, 20)], [at(8, 15), at(8, 25)]] },
    ],
    transfers: [{ a: "X", b: "S", seconds: 70 }],
  });
  const [S, D] = [idx(net, "S"), idx(net, "D")];
  const { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 1, S), at(8, 10), "the egress label is the earlier ride arrival");
  assert.equal(ws.lbl[ws.n + S], Lbl.Ride);
  assert.equal(ws.arrWalk[ws.n + S], at(8, 10, 10), "the walk is kept for boarding");
  assert.equal(tauAt(ws, 2, D), at(8, 20));
  const legs = backtrack(net, ws, 2, D);
  assert.equal(kinds(legs), "access,ride,walk,ride");
  assert.equal(replay(net, legs, at(8), D), at(8, 20));
});

/** L1 O → X, a walk X ↔ Y, L2 Y → D every minute. */
function viaFootpath(seconds: number, kind?: number): TransitNetwork {
  return tinyNetwork({
    stops: stopsOf("O", "X", "Y", "D"),
    patterns: [
      { route: "L1", stops: ["O", "X"], trips: [[at(8), at(8, 10)]] },
      { route: "L2", stops: ["Y", "D"], trips: Array.from({ length: 30 }, (_, m) => [at(8, m), at(8, m + 10)]) },
    ],
    transfers: [{ a: "X", b: "Y", seconds, kind }],
  });
}

test("two lines via a footpath: walk pointer then ride pointer", () => {
  const net = viaFootpath(120);
  const [X, Y, D] = [idx(net, "X"), idx(net, "Y"), idx(net, "D")];
  const { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 1, Y), at(8, 12));
  assert.equal(ws.lbl[ws.n + Y], Lbl.Walk);
  assert.equal(tauAt(ws, 2, D), at(8, 22), "boards at 08:12 with no change cost after a walk");
  const legs = backtrack(net, ws, 2, D);
  assert.equal(kinds(legs), "access,ride,walk,ride");
  assert.deepEqual(legs[2], { kind: "walk", from: X, to: Y, seconds: 120, transferKind: TRANSFER_KIND.walk });
  assert.equal(replay(net, legs, at(8), D), at(8, 22));
});

test("proximity footpaths scale with walkMetersPerMin", () => {
  // 180 s at 80 m/min is 60 s to find the stop plus 120 s of walking; at 40 m/min the walk takes 240 s.
  const walk = viaFootpath(180);
  const Y = idx(walk, "Y");
  assert.equal(scaledTransferSeconds(walk, walk.transfers.start[idx(walk, "X")], 40), 300);
  assert.equal(scaledTransferSeconds(walk, walk.transfers.start[idx(walk, "X")], 80), 180);
  let { ws } = run(walk, from(walk, "O"), at(8), { walkMetersPerMin: 40 });
  assert.equal(tauAt(ws, 1, Y), at(8, 15));
  const last = backtrack(walk, ws, 1, Y).at(-1);
  assert.ok(last?.kind === "walk" && last.seconds === 300, "the walk leg carries the scaled time");
  ({ ws } = run(walk, from(walk, "O"), at(8), { walkMetersPerMin: 120 }));
  assert.equal(tauAt(ws, 1, Y), at(8, 12, 20), "ceil(120 · 80 / 120) + 60");

  // A platform change is a fixed time.
  const station = viaFootpath(180, TRANSFER_KIND.station);
  ({ ws } = run(station, from(station, "O"), at(8), { walkMetersPerMin: 40 }));
  assert.equal(tauAt(ws, 1, idx(station, "Y")), at(8, 13));
});

test("a ride arrival after an earlier walk label still walks on", () => {
  // Round 1 walks X → Y (08:06), but only a ride arrival may walk on: Y → Z needs round 2's ride into Y.
  const net = tinyNetwork({
    stops: stopsOf("O", "X", "Y", "W", "Z"),
    patterns: [
      { route: "L1", stops: ["O", "X"], trips: [[at(8), at(8, 5)]] },
      { route: "L2", stops: ["O", "W"], trips: [[at(8), at(8, 10)]] },
      { route: "L3", stops: ["W", "Y"], trips: [[at(8, 12), at(8, 20)]] },
    ],
    transfers: [
      { a: "X", b: "Y", seconds: 60 },
      { a: "Y", b: "Z", seconds: 120 },
    ],
  });
  const [Y, Z] = [idx(net, "Y"), idx(net, "Z")];
  const { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 1, Y), at(8, 6));
  assert.equal(tauAt(ws, 1, Z), INF, "walks never chain");
  assert.equal(ws.arrRide[2 * ws.n + Y], at(8, 20));
  assert.equal(tauAt(ws, 2, Z), at(8, 22));
  assert.equal(kinds(backtrack(net, ws, 2, Z)), "access,ride,ride,walk");
});

test("frequency vs timetable on parallel lines picks the earlier arrival", () => {
  const net = tinyNetwork({
    stops: stopsOf("O", "D"),
    patterns: [
      { route: "BUS", stops: ["O", "D"], trips: [[at(8, 2), at(8, 25)]] },
      { route: "KJ", mode: "lrt", stops: ["O", "D"], freq: [{ start: at(8), end: at(9), headway: 600, offsets: [0, 900] }] },
    ],
  });
  const D = idx(net, "D");
  let { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 1, D), at(8, 20), "the line every 10 min boards at 08:05 (half a headway)");
  assert.deepEqual(backtrack(net, ws, 1, D)[1], {
    kind: "ride",
    pattern: 1,
    boardPos: 0,
    alightPos: 1,
    trip: -1,
    window: 0,
    boardTime: at(8, 5),
  });
  // Without the rail line the bus is the answer.
  const busOnly = Uint8Array.from([1, 0]);
  ({ ws } = run(net, from(net, "O"), at(8), { allowed: busOnly }));
  assert.equal(tauAt(ws, 1, D), at(8, 25));
});

test("frequency boarding at a middle stop adds runOffset", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [{ route: "KJ", mode: "lrt", stops: ["A", "B", "C"], freq: [{ start: at(8), end: at(9), headway: 600, offsets: [0, 300, 600] }] }],
  });
  // Ready at B 08:10: a train starting 08:05 + 5 min (half a headway) reaches B at 08:15.
  assert.deepEqual(earliestBoard(net, 0, 1, at(8, 10)), { kind: "freq", window: 0, board: at(8, 15) });
  const out: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  assert.ok(earliestBoardInto(net, 0, 1, at(8, 10), out));
  assert.equal(out.start, at(8, 10));
  assert.equal(arrAt(net, 0, out, 2), at(8, 20));
  assert.equal(depAt(net, 0, out, 1), at(8, 15));
});

test("trip start past fEnd is rejected", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B"),
    patterns: [{ route: "KJ", mode: "lrt", stops: ["A", "B"], freq: [{ start: at(8), end: at(9), headway: 600, offsets: [0, 300] }] }],
  });
  assert.deepEqual(earliestBoard(net, 0, 1, at(9)), { kind: "freq", window: 0, board: at(9, 5) }, "start 09:00 = fEnd is valid");
  assert.equal(earliestBoard(net, 0, 1, at(9, 0, 1)), null);
  assert.deepEqual(earliestBoard(net, 0, 0, at(7)), { kind: "freq", window: 0, board: at(8, 5) }, "before the window: its first expected train");
});

test("overlapping windows take the minimum board", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B"),
    patterns: [
      {
        route: "KJ",
        mode: "lrt",
        stops: ["A", "B"],
        freq: [
          { start: at(8), end: at(9), headway: 1200, offsets: [0, 300] },
          { start: at(8, 30), end: at(9, 30), headway: 120, offsets: [0, 300] },
        ],
      },
    ],
  });
  assert.deepEqual(earliestBoard(net, 0, 0, at(8, 40)), { kind: "freq", window: 1, board: at(8, 41) }, "not the first valid window");
  assert.deepEqual(earliestBoard(net, 0, 0, at(8, 20)), { kind: "freq", window: 0, board: at(8, 30) });
  let last = -1;
  for (let t = at(7, 50); t <= at(9, 40); t += 15) {
    const b = earliestBoard(net, 0, 1, t);
    const board = b === null ? INF : b.kind === "freq" ? b.board : -1;
    assert.ok(board >= last, `non-decreasing at ${t}`);
    last = board;
  }
});

test("both kinds on one pattern: the earlier departure, the trip on a tie", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B"),
    patterns: [
      {
        route: "U6",
        stops: ["A", "B"],
        trips: [[at(8, 5), at(8, 10)], [at(8, 30), at(8, 35)]],
        freq: [{ start: at(8), end: at(8, 20), headway: 600, offsets: [0, 300] }],
      },
    ],
  });
  assert.deepEqual(earliestBoard(net, 0, 0, at(8)), { kind: "trip", trip: 0 }, "tie at 08:05: the trip");
  assert.deepEqual(earliestBoard(net, 0, 0, at(8, 6)), { kind: "freq", window: 0, board: at(8, 11) });
  assert.deepEqual(earliestBoard(net, 0, 0, at(8, 20)), { kind: "trip", trip: 1 }, "the window ended");
});

test("overtaking express (two FIFO patterns) wins although it departs later", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [
      { route: "R", stops: ["A", "B", "C"], trips: [[at(8), at(8, 30), at(9)]] },
      { route: "R", stops: ["A", "B", "C"], trips: [[at(8, 5), at(8, 15), at(8, 25)]] },
    ],
  });
  const C = idx(net, "C");
  const { ws } = run(net, from(net, "A"), at(8));
  assert.equal(tauAt(ws, 1, C), at(8, 25));
  const ride = backtrack(net, ws, 1, C)[1];
  assert.ok(ride.kind === "ride" && ride.pattern === 1 && ride.boardTime === at(8, 5));
});

test("catches an earlier trip downstream", () => {
  // Round 1: A reaches X (walk on to S2 by 08:07) and, later, S0 (08:11).
  // Round 2: L boards its 08:15 trip at S0, but S2's walk label catches the 08:10 trip.
  const net = tinyNetwork({
    stops: stopsOf("O", "X", "S0", "S1", "S2", "S3"),
    patterns: [
      { route: "A", stops: ["O", "X"], trips: [[at(8), at(8, 5)]] },
      { route: "B", stops: ["O", "S0"], trips: [[at(8), at(8, 11)]] },
      {
        route: "L",
        stops: ["S0", "S1", "S2", "S3"],
        trips: [
          [at(7, 50), at(8), at(8, 10), at(8, 20)],
          [at(8, 15), at(8, 25), at(8, 35), at(8, 45)],
        ],
      },
    ],
    transfers: [{ a: "X", b: "S2", seconds: 120 }],
  });
  const S3 = idx(net, "S3");
  const { ws } = run(net, from(net, "O"), at(8));
  assert.equal(tauAt(ws, 2, S3), at(8, 20));
  const legs = backtrack(net, ws, 2, S3);
  assert.equal(kinds(legs), "access,ride,walk,ride");
  assert.deepEqual(legs[3], { kind: "ride", pattern: 2, boardPos: 2, alightPos: 3, trip: 0, window: -1, boardTime: at(8, 10) });
  assert.equal(replay(net, legs, at(8), S3), at(8, 20));
});

test("needs 5 rides → no journey with maxRides 4", () => {
  const ids = ["S0", "S1", "S2", "S3", "S4", "S5"];
  const net = tinyNetwork({
    stops: stopsOf(...ids),
    patterns: ids.slice(1).map((id, i) => ({ route: `L${i}`, stops: [ids[i], id], trips: [[at(8, i * 10), at(8, i * 10 + 5)]] })),
  });
  const { ws } = run(net, from(net, "S0"), at(8));
  assert.equal(tauAt(ws, 4, idx(net, "S4")), at(8, 35), "four rides reach S4");
  for (let k = 0; k <= MAX_RIDES; k++) assert.equal(tauAt(ws, k, idx(net, "S5")), INF);
  assert.equal(kinds(backtrack(net, ws, 4, idx(net, "S4"))), "access,ride,ride,ride,ride");
});

test("loop pattern never records a ride back to its first stop", () => {
  const net = tinyNetwork({
    stops: stopsOf("X", "A", "B"),
    patterns: [{ route: "T816", stops: ["X", "A", "B", "X"], trips: [[at(8), at(8, 5), at(8, 10), at(8, 15)]] }],
    transfers: [{ a: "X", b: "B", seconds: 90 }],
  });
  const [X, B] = [idx(net, "X"), idx(net, "B")];
  const { ws } = run(net, from(net, "X"), at(8));
  for (let k = 1; k <= MAX_RIDES; k++) {
    assert.equal(tauAt(ws, k, X), INF, `round ${k}`);
    assert.equal(ws.arrRide[k * ws.n + X], INF, `round ${k} ride`);
  }
  assert.equal(tauAt(ws, 1, B), at(8, 10));
});

test("runRounds yields once per round", () => {
  const net = oneLine();
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  startDeparture(ws, from(net, "A"), at(8));
  const C = idx(net, "C");
  const rounds = runRounds(net, ws, { egress: [{ stop: C, seconds: 30, meters: 40 }], maxRides: 4, allowed: allPatterns(net), walkMetersPerMin: 80 });
  assert.equal(rounds.next().done, false);
  assert.equal(tauAt(ws, 1, C), at(8, 10), "round 1 is done at the first yield");
  assert.equal(ws.destBest[1], at(8, 10, 30));
  assert.equal(ws.destBest[MAX_RIDES], at(8, 10, 30), "≤ k rides: later rounds share the bound");
  assert.equal(rounds.next().done, false, "round 2 rescans from B and C");
  assert.equal(rounds.next().done, true, "nothing improved, so no round 3");
  assert.equal(run(net, from(net, "A"), at(8), { maxRides: 1 }).yields, 1);
});

test("labels persist across departures until resetWorkspace (rRAPTOR)", () => {
  const net = oneLine();
  const C = idx(net, "C");
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  const drain = () => {
    const r = runRounds(net, ws, { egress: [], maxRides: 4, allowed: allPatterns(net), walkMetersPerMin: 80 });
    while (!r.next().done);
  };
  startDeparture(ws, from(net, "A"), at(8, 5));
  drain();
  assert.equal(tauAt(ws, 1, C), at(8, 20));
  startDeparture(ws, from(net, "A"), at(8, 15));
  drain();
  assert.equal(tauAt(ws, 1, C), at(8, 20), "a later departure keeps the better label");
  startDeparture(ws, from(net, "A"), at(7, 59));
  drain();
  assert.equal(tauAt(ws, 1, C), at(8, 10));
  resetWorkspace(ws);
  assert.equal(tauAt(ws, 1, C), INF);
  assert.equal(ws.lbl[ws.n + C], Lbl.None);
});

test("backtrack throws on corrupt labels", () => {
  const net = oneLine();
  const { ws } = run(net, from(net, "A"), at(8));
  assert.throws(() => backtrack(net, ws, 2, idx(net, "C")), /label/);
});

// --- Fixture network ---------------------------------------------------------

/** 2026-10-28 08:00 MYT, seconds after the service day's midnight. */
const AT_0800 = at(8);

function klccEgress(net: TransitNetwork): StopTime[] {
  const klcc = net.stations.find((s) => s.id === "klcc");
  assert.ok(klcc, "station klcc");
  return klcc.stopIds.map((id) => ({ stop: idx(net, id), seconds: 0, meters: 0 }));
}

/** The best (round, egress stop) after a run, fewest rides on a tie. */
function bestEgress(ws: Workspace, egress: readonly StopTime[], maxRides = MAX_RIDES): { k: number; stop: number; arrive: number } {
  let best = { k: -1, stop: -1, arrive: INF };
  for (let k = 1; k <= maxRides; k++) {
    for (const e of egress) {
      const t = tauAt(ws, k, e.stop) + e.seconds;
      if (t < best.arrive) best = { k, stop: e.stop, arrive: t };
    }
  }
  return best;
}

test("Hotel Lisa De Inn reaches rail:KJ10 within 4 rides", () => {
  const net = fixtureNetwork();
  const egress = klccEgress(net);
  assert.ok(egress.some((e) => net.stops.id[e.stop] === "rail:KJ10"));
  const { ws } = run(net, from(net, "12000759"), AT_0800, { egress });
  assert.ok(ws.destBest[MAX_RIDES] < AT_0800 + 2 * 3600, `arrives within 2 h (${ws.destBest[MAX_RIDES]})`);
  const best = bestEgress(ws, egress);
  assert.equal(best.arrive, ws.destBest[MAX_RIDES]);
  const legs = backtrack(net, ws, best.k, best.stop);
  assert.match(kinds(legs), /^access,ride(,(walk,)?ride)*(,walk)?$/);
  assert.equal(legs.filter((l) => l.kind === "ride").length, best.k);
  assert.ok(egress.some((e) => e.stop === best.stop), "ends at a KLCC stop");
  assert.equal(replay(net, legs, AT_0800, best.stop), tauAt(ws, best.k, best.stop));
});

/**
 * Reference: round by round over every pattern with no pruning, the same
 * rules (change cost after a ride, footpaths only from ride arrivals, no
 * ride back to the boarding stop). Best egress arrival with ≤ k rides, k = 1..K.
 */
function naiveBest(net: TransitNetwork, access: readonly StopTime[], egress: readonly StopTime[], dep: number): number[] {
  const P = net.patterns;
  const n = net.stops.count;
  const acc = new Array<number>(n).fill(INF);
  for (const a of access) acc[a.stop] = Math.min(acc[a.stop], dep + a.seconds);
  let ride = new Array<number>(n).fill(INF);
  let walk = new Array<number>(n).fill(INF);
  const out: number[] = [];
  let best = INF;
  const b: BoardOut = { kind: 0, trip: -1, window: -1, start: -1, dep: -1 };
  for (let k = 1; k <= MAX_RIDES; k++) {
    const ready = (s: number) => Math.min(acc[s], walk[s], ride[s] + CHANGE_SEC);
    const nextRide = ride.slice();
    for (let p = 0; p < P.count; p++) {
      const slot = P.stopStart[p];
      const len = P.stopLen[p];
      // Per alighting position: the earliest arrival over boardings, the first boarding position on a tie.
      const arrive = new Array<number>(len).fill(INF);
      const boardStop = new Array<number>(len).fill(-1);
      for (let i = 0; i < len - 1; i++) {
        const r = ready(P.stops[slot + i]);
        if (r >= INF || !earliestBoardInto(net, p, i, r, b)) continue;
        for (let j = i + 1; j < len; j++) {
          const a = arrAt(net, p, b, j);
          if (a < arrive[j]) {
            arrive[j] = a;
            boardStop[j] = P.stops[slot + i];
          }
        }
      }
      for (let j = 0; j < len; j++) {
        const s = P.stops[slot + j];
        if (arrive[j] < nextRide[s] && boardStop[j] !== s) nextRide[s] = arrive[j];
      }
    }
    const nextWalk = walk.slice();
    for (let s = 0; s < n; s++) {
      if (nextRide[s] >= INF) continue;
      for (let j = net.transfers.start[s], end = j + net.transfers.len[s]; j < end; j++) {
        const to = net.transfers.to[j];
        nextWalk[to] = Math.min(nextWalk[to], nextRide[s] + net.transfers.seconds[j]);
      }
    }
    ride = nextRide;
    walk = nextWalk;
    for (const e of egress) best = Math.min(best, Math.min(ride[e.stop], walk[e.stop]) + e.seconds);
    out.push(best);
  }
  return out;
}

test("agrees with a naive round-by-round scan on random fixture queries, and every journey replays", () => {
  const net = fixtureNetwork();
  let seed = 20261028;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const served = [...Array(net.stops.count).keys()].filter((s) => net.stopRoutes.len[s] > 0);
  let checked = 0;
  while (checked < 24) {
    const origin = served[Math.floor(rand() * served.length)];
    const dest = served[Math.floor(rand() * served.length)];
    const dep = at(6) + Math.floor(rand() * 15 * 3600);
    const egress = stopsNear(net, net.stops.lat[dest], net.stops.lon[dest], 300).map((stop) => {
      const meters = haversineMeters({ lat: net.stops.lat[dest], lng: net.stops.lon[dest] }, { lat: net.stops.lat[stop], lng: net.stops.lon[stop] });
      return { stop, meters, seconds: Math.ceil((meters * DETOUR_FACTOR) / (80 / 60)) };
    });
    if (egress.some((e) => e.stop === origin)) continue;
    checked++;
    const access = [{ stop: origin, seconds: 0, meters: 0 }];
    const { ws } = run(net, access, dep, { egress });
    const expected = naiveBest(net, access, egress, dep);
    assert.deepEqual([...ws.destBest.subarray(1)], expected, `${net.stops.id[origin]} → ${net.stops.id[dest]} at ${dep}`);
    for (let k = 1; k <= MAX_RIDES; k++) {
      const best = bestEgress(ws, egress, k);
      if (best.arrive >= INF || best.k !== k) continue;
      const legs = backtrack(net, ws, k, best.stop);
      assert.equal(replay(net, legs, dep, best.stop), tauAt(ws, k, best.stop), `${net.stops.id[origin]} round ${k}`);
    }
  }
});

test("a range of departures (latest first) reaches the best single departure in the window", () => {
  const net = fixtureNetwork();
  const egress = klccEgress(net);
  const access = from(net, "12000759");
  let single = INF;
  for (let t = AT_0800; t <= AT_0800 + 1200; t += 120) single = Math.min(single, run(net, access, t, { egress }).ws.destBest[MAX_RIDES]);
  const ws = workspaceFor(net);
  resetWorkspace(ws);
  for (let t = AT_0800 + 1200; t >= AT_0800; t -= 120) {
    startDeparture(ws, access, t);
    const r = runRounds(net, ws, { egress, maxRides: MAX_RIDES, allowed: allPatterns(net), walkMetersPerMin: 80 });
    while (!r.next().done);
  }
  assert.equal(ws.destBest[MAX_RIDES], single);
  const best = bestEgress(ws, egress);
  assert.ok(replay(net, backtrack(net, ws, best.k, best.stop), AT_0800, best.stop) <= best.arrive, "a mixed-departure chain still replays");
});
