import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { secondsToClockHHMM, toMalaysiaParts } from "../../utils/gtfs-time.js";
import {
  boardText,
  HEADWAY_ONLY_MAX_SEC,
  lineDirections,
  serviceClock,
  stationBoard,
  stopDepartures,
  type BoardRow,
  type NextDeparture,
} from "../board.js";
import { compileNetworkSync, type CompileFeeds } from "../compile.js";
import { readFeed } from "../feeds.js";
import { buildNetwork, SYNTH_KTM_STARTS, syntheticNetwork } from "./fixtures/syntheticNetwork.js";

/** Epoch ms of a Malaysia wall-clock time on 2026-10-`day`. */
const myt = (h: number, m = 0, s = 0, day = 28) => Date.UTC(2026, 9, day, h, m, s) - 8 * 3_600_000;
/** Epoch ms of seconds after 2026-10-28 00:00 MYT. */
const ms = (sec: number) => myt(0) + sec * 1000;
const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

const mins = (n: number) => `${n} ${n === 1 ? "min" : "mins"}`;
const clock = (epochMs: number) => secondsToClockHHMM(toMalaysiaParts(new Date(epochMs)).secSinceMidnight);

// Stops of the synthetic network.
const ALPHA = 0;
const BRAVO = 1;
const KILO_TWO = 4;
const KILO_THREE = 5;
/** Bravo is 2 min from either terminus. */
const OFF = 120;

/** The Bravo row of the KJ1 → KJ3 pattern (towards Charlie). */
function towardsCharlie(rows: BoardRow[]): BoardRow {
  const row = rows.find((r) => r.towards === "Charlie");
  assert.ok(row, "row towards Charlie");
  return row;
}

test("serviceClock maps 00:30 MYT onto the previous service date as t ≥ 86400", () => {
  const net = syntheticNetwork();
  const clk = serviceClock(net, myt(0, 30, 0, 29));
  assert.deepEqual(clk, { t: 86_400 + 1800, midnightMs: myt(0) });
  assert.deepEqual(serviceClock(net, myt(7)), { t: at(7), midnightMs: myt(0) });
  // Two days on, or the day before, is another service date.
  assert.equal(serviceClock(net, myt(0, 30, 0, 30)), null);
  assert.equal(serviceClock(net, myt(23, 0, 0, 27)), null);
});

test("headway row at 07:00 at stop 2 reports headwaySec 180 and nextAboutSec on the shifted grid", () => {
  const net = syntheticNetwork();
  const row = towardsCharlie(stopDepartures(net, BRAVO, myt(7)));
  // Trains leave Alpha at 06:00 + k·3 min, so pass Bravo at 06:02 + k·3 min: next 07:02.
  assert.deepEqual(row.next, { kind: "headway", headwaySec: 180, nextAboutSec: 120 });
  assert.equal(row.route, 0);
  assert.equal(row.pattern, 1);
});

test('boardText shows only "every 3 mins" when headway ≤ 300 s', () => {
  const out = boardText({ kind: "headway", headwaySec: 180, nextAboutSec: 95 }, mins, clock);
  assert.deepEqual(out, { primary: "every 3 mins", secondary: null, spoken: "every 3 minutes" });
  const edge = boardText({ kind: "headway", headwaySec: HEADWAY_ONLY_MAX_SEC, nextAboutSec: 200 }, mins, clock);
  assert.equal(edge.primary, "every 5 mins");
  assert.equal(edge.secondary, null);
});

test('boardText shows "about 4 mins" + "then every 7 mins" when headway > 300 s', () => {
  const out = boardText({ kind: "headway", headwaySec: 420, nextAboutSec: 4 * 60 + 50 }, mins, clock);
  assert.deepEqual(out, {
    primary: "about 4 mins",
    secondary: "then every 7 mins",
    spoken: "about 4 minutes, then every 7 minutes",
  });
  // A train under a minute away is still "about 1 min", never "about 0 mins".
  assert.equal(boardText({ kind: "headway", headwaySec: 420, nextAboutSec: 20 }, mins, clock).primary, "about 1 min");
});

test("boardText: timetable is scheduled clock times, closed never counts down", () => {
  const times = SYNTH_KTM_STARTS.map(ms);
  assert.deepEqual(boardText({ kind: "timetable", times }, mins, clock), {
    primary: "06:30",
    secondary: "07:30 · 08:30",
    spoken: "Scheduled 06:30, 07:30, 08:30",
  });
  assert.equal(boardText({ kind: "timetable", times: times.slice(0, 1) }, mins, clock).secondary, null);
  const first: NextDeparture = { kind: "closed", reopensAt: ms(at(6)) };
  assert.deepEqual(boardText(first, mins, clock), { primary: "First 06:00", secondary: null, spoken: "First 06:00" });
  assert.equal(boardText({ kind: "closed", reopensAt: null }, mins, clock).primary, "No more trains today");
});

test("window boundary at 09:00 switches headway without a negative nextAboutSec", () => {
  const net = syntheticNetwork();
  const before = towardsCharlie(stopDepartures(net, BRAVO, ms(at(9) + OFF - 1))).next;
  assert.deepEqual(before, { kind: "headway", headwaySec: 180, nextAboutSec: 1 });
  const on = towardsCharlie(stopDepartures(net, BRAVO, ms(at(9) + OFF))).next;
  assert.deepEqual(on, { kind: "headway", headwaySec: 420, nextAboutSec: 0 });
  const after = towardsCharlie(stopDepartures(net, BRAVO, ms(at(9) + OFF + 1))).next;
  assert.deepEqual(after, { kind: "headway", headwaySec: 420, nextAboutSec: 419 });
  // Every second across the boundary stays a non-negative countdown.
  for (let t = at(8, 55); t <= at(9, 10); t++) {
    const next = towardsCharlie(stopDepartures(net, BRAVO, ms(t))).next;
    assert.equal(next.kind, "headway");
    if (next.kind === "headway") assert.ok(next.nextAboutSec >= 0 && next.nextAboutSec <= next.headwaySec, `t=${t}`);
  }
});

test("a window ending off its grid hands over to the next window; a gap is closed", () => {
  // 06:00–09:00 every 7 min (last train 08:55), 09:00–10:00 every 3 min, then a gap to 15:00.
  const net = buildNetwork({
    stops: [
      { id: "rail:X1", name: "One", station: -1 },
      { id: "rail:X2", name: "Two", station: -1 },
    ],
    stations: [],
    routes: [{ id: "rail:X", label: "X", mode: "lrt", feed: "rail" }],
    patterns: [
      {
        route: 0,
        headsign: "Two",
        stops: [0, 1],
        windows: [[at(6), at(9), 420], [at(9), at(10), 180], [at(15), at(16), 180]],
        runOffset: [0, 60],
      },
    ],
  });
  const next = (h: number, m: number) => stopDepartures(net, 0, myt(h, m))[0].next;
  assert.deepEqual(next(8, 57), { kind: "headway", headwaySec: 420, nextAboutSec: 180 });
  assert.deepEqual(next(12, 0), { kind: "closed", reopensAt: ms(at(15)) });
  const [row] = stopDepartures(net, 0, myt(12));
  assert.equal(row.last, ms(at(16)));
});

test("before first window returns closed with reopensAt = first departure", () => {
  const net = syntheticNetwork();
  const row = towardsCharlie(stopDepartures(net, BRAVO, myt(5)));
  assert.deepEqual(row.next, { kind: "closed", reopensAt: ms(at(6) + OFF) });
  assert.equal(row.first, ms(at(6) + OFF));
});

test("after last window returns closed with reopensAt null", () => {
  const net = syntheticNetwork();
  const row = towardsCharlie(stopDepartures(net, BRAVO, myt(23, 45)));
  assert.deepEqual(row.next, { kind: "closed", reopensAt: null });
  // KTM after its last trip, too.
  const ktm = stopDepartures(net, KILO_TWO, myt(22));
  assert.deepEqual(ktm.map((r) => r.next), [{ kind: "closed", reopensAt: null }]);
});

test("last stop of a pattern yields no row (arrivals only)", () => {
  const net = syntheticNetwork();
  assert.deepEqual(stopDepartures(net, KILO_THREE, myt(7)), []);
  // Alpha is the terminus of KJ3 → KJ1 and the origin of KJ1 → KJ3.
  const rows = stopDepartures(net, ALPHA, myt(7));
  assert.deepEqual(rows.map((r) => r.towards), ["Charlie"]);
  // At the origin the grid is unshifted: 07:00 is a departure.
  assert.deepEqual(rows[0].next, { kind: "headway", headwaySec: 180, nextAboutSec: 0 });
});

test("interchange station merges both platforms and sorts by line label", () => {
  const net = syntheticNetwork();
  const board = stationBoard(net, 1, myt(7));
  assert.equal(board.station, 1);
  assert.equal(board.stale, false);
  assert.deepEqual(
    board.rows.map((r) => [net.routes.label[r.route], r.towards]),
    [
      ["KJ", "Alpha"],
      ["KJ", "Charlie"],
      ["KTM Seremban", "Kilo Three"],
    ],
  );
});

test("timetable rows return ≤ 3 epoch-ms times in Malaysia time", () => {
  const net = syntheticNetwork();
  const [early] = stopDepartures(net, KILO_TWO, myt(6));
  assert.equal(early.next.kind, "timetable");
  if (early.next.kind !== "timetable") return;
  assert.deepEqual(early.next.times, SYNTH_KTM_STARTS.map((t) => ms(t + 600)));
  const parts = toMalaysiaParts(new Date(early.next.times[0]));
  assert.equal(parts.ymd, "20261028");
  assert.equal(parts.secSinceMidnight, at(6, 40));
  // 07:40 itself is still to come at 07:40.
  const [later] = stopDepartures(net, KILO_TWO, myt(7, 40));
  assert.deepEqual(later.next, { kind: "timetable", times: [ms(at(7, 40)), ms(at(8, 40))] });
  assert.equal(later.first, ms(at(6, 40)));
  assert.equal(later.last, ms(at(8, 40)));
});

test("rail feed excluded → stationBoard stale with no rows", () => {
  const net = syntheticNetwork();
  net.meta.feeds.rail.included = false;
  assert.deepEqual(stationBoard(net, 1, myt(7)), { station: 1, rows: [], stale: true });
  // No service clock for this network: also stale.
  const fresh = syntheticNetwork();
  assert.deepEqual(stationBoard(fresh, 1, myt(7, 0, 0, 30)), { station: 1, rows: [], stale: true });
});

test("first/last include the runOffset for mid-line stations", () => {
  const net = syntheticNetwork();
  const row = towardsCharlie(stopDepartures(net, BRAVO, myt(12)));
  assert.equal(row.first, ms(at(6) + OFF));
  // The 09:00–23:30 window's last 7-min departure from Alpha is 23:28, at Bravo 23:30.
  assert.equal(row.last, ms(at(23, 28) + OFF));
  const [origin] = stopDepartures(net, ALPHA, myt(12));
  assert.equal(origin.first, ms(at(6)));
  assert.equal(origin.last, ms(at(23, 28)));
});

test("lineDirections puts the pattern starting at the lowest station code first", () => {
  const net = syntheticNetwork();
  // Pattern 1 starts at KJ1, pattern 0 at KJ3.
  assert.deepEqual(lineDirections(net, 0), [1, 0]);
  assert.deepEqual(lineDirections(net, 1), [2]);
  const rows = stopDepartures(net, BRAVO, myt(7));
  assert.deepEqual(
    rows.map((r) => [r.towards, r.dir]),
    [
      ["Alpha", 1],
      ["Charlie", 0],
    ],
  );
});

// ---------------------------------------------------------------------------
// Fixture network, captured 2026-10-23
// ---------------------------------------------------------------------------

const FIXTURES = new URL("../__fixtures__/2026-10-23/", import.meta.url);

function fixtureNetwork() {
  const feeds: CompileFeeds = {};
  for (const [feed, zip] of [["rail", "rapid-rail-kl.zip"], ["ktm", "ktmb.zip"]] as const) {
    const data = readFeed(new Uint8Array(readFileSync(new URL(zip, FIXTURES))), feed);
    feeds[feed] = { data, meta: { fetchedAt: 0, hash: "", validUntil: data.validUntil, included: true } };
  }
  return compileNetworkSync(feeds, "20261028", { builtAt: 0 });
}

test("Pasar Seni board on 2026-10-28 08:00 has KJ and KG rows in both directions", () => {
  const net = fixtureNetwork();
  const station = net.stations.findIndex((s) => s.id === "pasar-seni");
  assert.ok(station >= 0);
  const board = stationBoard(net, station, myt(8));
  assert.equal(board.stale, false);
  const seen = board.rows.map((r) => `${net.routes.label[r.route]} ${r.dir} ${r.towards}`);
  assert.deepEqual(seen, ["KG 0 Kajang", "KG 1 Kwasa Damansara", "KJ 1 Gombak", "KJ 0 Putra Heights"]);
  for (const row of board.rows) {
    assert.equal(row.next.kind, "headway", seen.join(", "));
    assert.ok(row.first !== null && row.last !== null && row.first < myt(8) && myt(8) < row.last);
  }
  // Kajang Line: 06:00–09:00 every 6 min, so "about N mins · then every 6 mins".
  const kg = board.rows.find((r) => net.routes.label[r.route] === "KG")!;
  assert.deepEqual(kg.next.kind === "headway" && kg.next.headwaySec, 360);
  assert.equal(boardText(kg.next, mins, clock).secondary, "then every 6 mins");
});
