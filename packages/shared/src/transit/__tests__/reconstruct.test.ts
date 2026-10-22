import assert from "node:assert/strict";
import test from "node:test";

import { fnv1a32, itineraryId, signatureFromLegs } from "../ids.js";
import { patternMask } from "../modes.js";
import type { TransitNetwork } from "../network.js";
import type { Leg, Place } from "../plan.js";
import type { StopTime } from "../raptor.js";
import { rangeRaptor } from "../range.js";
import { journeySignature, summarize, type Candidate } from "../rank.js";
import { legWarnings, toItinerary, toLegs } from "../reconstruct.js";
import { serviceDayStartMs, toEpochMs, toServiceSeconds } from "../time.js";
import { walkedMeters, walkOnlyCandidate } from "../walk.js";
import { toMalaysiaParts } from "../../utils/gtfs-time.js";
import { tinyNetwork, type TinyPattern } from "./helpers/tiny-network.js";

const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

/** Stops `S0`, `S1`, … about 100 m apart along a parallel. */
const stopsOf = (...ids: string[]) => ids.map((id, i) => ({ id, lat: 3.1, lon: 101.6 + i * 0.001 }));
const idx = (net: TransitNetwork, id: string) => {
  const i = net.stops.id.indexOf(id);
  assert.ok(i >= 0, `stop ${id}`);
  return i;
};
const HOME: Place = { kind: "place", name: "Home", lat: 3.1, lng: 101.599 };
const WORK: Place = { kind: "place", name: "Work", lat: 3.101, lng: 101.605 };
const stopTime = (net: TransitNetwork, id: string, seconds = 0, meters = seconds): StopTime[] => [{ stop: idx(net, id), seconds, meters }];
const ms = (net: TransitNetwork, sec: number) => toEpochMs(net, sec);
type Ride = Extract<Leg, { kind: "ride" }>;
const ridesOf = (legs: Leg[]) => legs.filter((l): l is Ride => l.kind === "ride");

/** Every candidate `rangeRaptor` finds (one run at `t0` unless `windowSec`), summarised. */
function candidates(net: TransitNetwork, access: StopTime[], egress: StopTime[], t0: number, windowSec = 0): Candidate[] {
  const g = rangeRaptor(net, { access, egress, t0, windowSec, allowed: patternMask(net), walkMetersPerMin: 80 });
  for (;;) {
    const step = g.next();
    if (step.done) return step.value.map((raw) => summarize(net, raw, t0));
  }
}
/** The one candidate with `rides` rides. */
function only(cands: Candidate[], rides = 1): Candidate {
  const c = cands.filter((x) => x.rides === rides);
  assert.equal(c.length, 1, `one ${rides}-ride candidate of ${cands.length}`);
  return c[0];
}

/** A → B → C → D, 5 min a hop, `trips` first departures (timetabled) or one window. */
function line(opts: { trips?: number[]; freq?: TinyPattern["freq"]; route?: string } = {}): TransitNetwork {
  const stops = ["A", "B", "C", "D"];
  return tinyNetwork({
    stops: stopsOf(...stops),
    patterns: [
      {
        route: opts.route ?? "L",
        stops,
        trips: opts.trips?.map((t) => stops.map((_, i) => t + i * 300)),
        freq: opts.freq,
      },
    ],
  });
}

test("time: 08:00 MYT is 28800 s and round-trips through toEpochMs", () => {
  const net = line({ trips: [at(8)] });
  assert.equal(net.meta.serviceDate, "20261028");
  const t = Date.UTC(2026, 9, 28, 0, 0);
  assert.equal(toServiceSeconds(net, t), 28_800);
  assert.equal(toEpochMs(net, 28_800), t);
  assert.equal(toServiceSeconds(net, t + 999), 28_800, "whole seconds, floored");
  assert.equal(serviceDayStartMs("20261028"), toMalaysiaParts(new Date(Date.UTC(2026, 9, 28, 4))).midnightUtcMs);
  assert.equal(toEpochMs(net, 90_000) - toEpochMs(net, 0), 90_000_000, "past 24:00 runs on");
});

test("timetabled ride legs carry tripKey and scheduled timing", () => {
  const net = line({ trips: [at(8), at(8, 10)] });
  const cand = only(candidates(net, stopTime(net, "A", 120, 160), stopTime(net, "D"), at(7, 50)));
  const legs = toLegs(net, cand, HOME, WORK);
  assert.deepEqual(
    legs.map((l) => l.kind),
    ["walk", "ride"],
    "egress 0 s emits no walk",
  );
  const ride = legs[1] as Ride;
  assert.deepEqual(ride.timing, { kind: "scheduled" });
  assert.equal(ride.tripKey, "D#0");
  assert.equal(ride.mode, "bus");
  assert.equal(ride.route, 0);
  assert.equal(ride.label, "L");
  assert.equal(ride.color, "#000000");
  assert.equal(ride.headsign, "D");
  assert.deepEqual(
    [ride.from.stop, ride.from.name, ride.from.time, ride.to.stop, ride.to.name, ride.to.time],
    [idx(net, "A"), "A", ms(net, at(8)), idx(net, "D"), "D", ms(net, at(8, 15))],
  );
  assert.ok(Math.abs(ride.from.lat - 3.1) < 1e-5 && Math.abs(ride.from.lng - 101.6) < 1e-5, "stop coordinates");
});

test("latest leave: the access walk ends 60 s before a timetabled board", () => {
  const net = line({ trips: [at(8), at(8, 10)] });
  const cand = only(candidates(net, stopTime(net, "A", 120, 160), stopTime(net, "D"), at(7, 50)));
  const [walk] = toLegs(net, cand, HOME, WORK);
  assert.equal(walk.kind, "walk");
  assert.deepEqual([walk.from.stop, walk.from.name, walk.from.lat, walk.from.lng], [undefined, "Home", HOME.lat, HOME.lng]);
  assert.equal(walk.from.time, ms(net, at(7, 57)));
  assert.equal(walk.to.time, ms(net, at(7, 59)));
  assert.equal(walk.to.stop, idx(net, "A"));
  assert.deepEqual([walk.seconds, (walk as Extract<Leg, { kind: "walk" }>).meters], [120, 160]);
});

test("headway legs carry headwaySec and no tripKey", () => {
  const net = line({ freq: [{ start: at(8), end: at(9), headway: 600, offsets: [0, 300, 600, 900] }] });
  const cand = only(candidates(net, stopTime(net, "A"), stopTime(net, "C"), at(8, 2)));
  const legs = toLegs(net, cand, HOME, WORK);
  assert.equal(legs.length, 1);
  const ride = legs[0] as Ride;
  assert.deepEqual(ride.timing, { kind: "headway", headwaySec: 600 });
  assert.equal("tripKey" in ride, false);
  // Run start max(08:02 − 0, 08:00) + 5 min; C is 10 min on.
  assert.equal(ride.from.time, ms(net, at(8, 7)));
  assert.equal(ride.to.time, ms(net, at(8, 17)));
});

test("a headway ride after a ride boards CHANGE_SEC later, as the engine does", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [
      { route: "T", stops: ["A", "B"], trips: [[at(8), at(8, 10)]] },
      { route: "F", mode: "lrt", stops: ["B", "C"], freq: [{ start: at(7), end: at(9), headway: 300, offsets: [0, 120] }] },
    ],
  });
  const cand = only(candidates(net, stopTime(net, "A"), stopTime(net, "C"), at(8)), 2);
  const [first, second] = toLegs(net, cand, HOME, WORK) as Ride[];
  assert.equal(first.to.time, ms(net, at(8, 10)));
  // Ready 08:11, run start 08:11 + 150 s.
  assert.equal(second.from.time, ms(net, at(8, 13, 30)));
  assert.equal(second.from.time, ms(net, cand.raw!.legs.filter((l) => l.kind === "ride")[1].boardTime));
  assert.equal(second.to.time, ms(net, at(8, 15, 30)));
  assert.equal(second.mode, "lrt");
});

test("via lists intermediate stops with monotonic times", () => {
  const net = line({ trips: [at(8)] });
  const legs = toLegs(net, only(candidates(net, stopTime(net, "A"), stopTime(net, "D"), at(8))), HOME, WORK);
  const ride = legs[0] as Ride;
  assert.deepEqual(
    ride.via.map((v) => [v.stop, v.name, v.time]),
    [
      [idx(net, "B"), "B", ms(net, at(8, 5))],
      [idx(net, "C"), "C", ms(net, at(8, 10))],
    ],
  );
  const times = [ride.from.time, ...ride.via.map((v) => v.time), ride.to.time];
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
});

test("transfer walk + egress walk merge into one walk leg", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "X"),
    patterns: [{ route: "L", stops: ["A", "B"], trips: [[at(8), at(8, 10)]] }],
    transfers: [{ a: "B", b: "X", seconds: 150 }],
  });
  const cand = only(candidates(net, stopTime(net, "A"), stopTime(net, "X", 200, 250), at(8)));
  const legs = toLegs(net, cand, HOME, WORK);
  assert.deepEqual(
    legs.map((l) => l.kind),
    ["ride", "walk"],
  );
  const walk = legs[1] as Extract<Leg, { kind: "walk" }>;
  assert.equal(walk.from.stop, idx(net, "B"));
  assert.equal(walk.to.stop, undefined);
  assert.equal(walk.to.name, "Work");
  assert.equal(walk.seconds, 150 + 200);
  const bx = Math.round(walkedMeters({ lat: net.stops.lat[1], lng: net.stops.lon[1] }, { lat: net.stops.lat[2], lng: net.stops.lon[2] }));
  assert.equal(walk.meters, bx + 250);
  assert.equal(walk.from.time, ms(net, at(8, 10)));
  assert.equal(walk.to.time, ms(net, at(8, 10) + 350));
});

test("snapped origin emits no zero-length walk", () => {
  const net = line({ trips: [at(8)] });
  const legs = toLegs(net, only(candidates(net, stopTime(net, "A"), stopTime(net, "D", 90, 120), at(7, 55))), HOME, WORK);
  assert.deepEqual(
    legs.map((l) => l.kind),
    ["ride", "walk"],
  );
  assert.ok(legs.every((l) => l.to.time > l.from.time));
});

test("walk-only: one walk leg from cand.leave", () => {
  const net = line({ trips: [at(8)] });
  const cand = walkOnlyCandidate(HOME, WORK, at(8), 80)!;
  const legs = toLegs(net, cand, HOME, WORK);
  assert.equal(legs.length, 1);
  const walk = legs[0] as Extract<Leg, { kind: "walk" }>;
  assert.deepEqual(
    [walk.kind, walk.from.name, walk.to.name, walk.from.time, walk.to.time, walk.meters, walk.seconds],
    ["walk", "Home", "Work", ms(net, at(8)), ms(net, cand.arrive), cand.walkMeters, cand.walkSec],
  );
});

test("a vehicle that leaves before you reach it is an engine bug and throws", () => {
  const net = line({ trips: [at(8)] });
  const cand = only(candidates(net, stopTime(net, "A", 120, 160), stopTime(net, "D"), at(7, 50)));
  // Leave at the run, not the latest leave, with a longer access walk than the label had.
  const raw = { ...cand.raw!, run: at(7, 59), legs: cand.raw!.legs.map((l) => (l.kind === "access" ? { ...l, seconds: 120 } : l)) };
  assert.throws(() => toLegs(net, { ...cand, raw }, HOME, WORK), /boards at 08:00/);
});

test("id ignores times, changes with route or stops; signatureFromLegs equals journeySignature", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C"),
    patterns: [
      { route: "L", stops: ["A", "B", "C"], trips: [[at(8), at(8, 5), at(8, 10)]] },
      { route: "M", stops: ["A", "B", "C"], trips: [[at(9), at(9, 5), at(9, 10)]] },
    ],
  });
  const cand = only(candidates(net, stopTime(net, "A", 60), stopTime(net, "C", 60), at(7, 55)));
  const legs = toLegs(net, cand, HOME, WORK);
  assert.equal(signatureFromLegs(net, legs), journeySignature(net, cand.raw));
  assert.equal(signatureFromLegs(net, legs), "L:A>C");
  const id = itineraryId(net, legs);
  assert.match(id, /^[0-9a-z]{7}$/);

  const shift = (p: Leg["from"]) => ({ ...p, time: p.time + 600_000 });
  const later = legs.map((l) => ({ ...l, from: shift(l.from), to: shift(l.to) })) as Leg[];
  assert.equal(itineraryId(net, later), id, "times excluded");

  const ride = legs.findIndex((l) => l.kind === "ride");
  const other = legs.map((l, i) => (i === ride ? { ...(l as Ride), label: "M", route: 1 } : l));
  assert.notEqual(itineraryId(net, other), id, "route changes it");
  const shorter = legs.map((l, i) => (i === ride ? { ...(l as Ride), to: { ...l.to, stop: idx(net, "B") } } : l));
  assert.notEqual(itineraryId(net, shorter), id, "stops change it");

  const walkOnly = toLegs(net, walkOnlyCandidate(HOME, WORK, at(8), 80)!, HOME, WORK);
  assert.equal(signatureFromLegs(net, walkOnly), "walk");
  assert.equal(itineraryId(net, walkOnly), fnv1a32("walk").toString(36).padStart(7, "0"));
  // FNV-1a 32-bit reference values.
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("a"), 0xe40c292c);
});

test("last-service when the next departure is > 60 min away", () => {
  const legsAt = (trips: number[]) => {
    const net = line({ trips });
    const legs = toLegs(net, only(candidates(net, stopTime(net, "A"), stopTime(net, "D"), at(8))), HOME, WORK);
    return legWarnings(net, legs);
  };
  assert.deepEqual(legsAt([at(8), at(9, 1)]), ["last-service"]);
  assert.deepEqual(legsAt([at(8)]), ["last-service"], "no later trip");
  assert.deepEqual(legsAt([at(8), at(9)]), [], "exactly 60 min is not last");

  const headway = (end: number) => {
    const net = line({ freq: [{ start: at(7), end, headway: 600, offsets: [0, 300, 600, 900] }] });
    const legs = toLegs(net, only(candidates(net, stopTime(net, "A"), stopTime(net, "D"), at(8))), HOME, WORK);
    return legWarnings(net, legs);
  };
  assert.deepEqual(headway(at(9)), [], "the window runs on");
  assert.deepEqual(headway(at(8, 5)), ["last-service"], "the window ends with this run");
});

test("long-wait on a 20-min transfer", () => {
  const transfer = (second: number) => {
    const net = tinyNetwork({
      stops: stopsOf("A", "B", "C"),
      patterns: [
        { route: "L", stops: ["A", "B"], trips: [[at(8), at(8, 10)], [at(8, 30), at(8, 40)]] },
        { route: "M", stops: ["B", "C"], trips: [[second, second + 600], [second + 1200, second + 1800]] },
      ],
    });
    const cand = only(candidates(net, stopTime(net, "A"), stopTime(net, "C"), at(8)), 2);
    const legs = toLegs(net, cand, HOME, WORK);
    return legWarnings(net, legs);
  };
  assert.deepEqual(transfer(at(8, 30)), ["long-wait"]);
  assert.deepEqual(transfer(at(8, 20)), [], "10 min is fine");
});

test("warnings: last-service before long-wait, each once", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "C", "D"),
    patterns: [
      { route: "L", stops: ["A", "B"], trips: [[at(8), at(8, 10)]] },
      { route: "M", stops: ["B", "C"], trips: [[at(8, 30), at(8, 40)]] },
      { route: "N", stops: ["C", "D"], trips: [[at(9), at(9, 10)]] },
    ],
  });
  const legs = toLegs(net, only(candidates(net, stopTime(net, "A"), stopTime(net, "D"), at(8)), 3), HOME, WORK);
  assert.deepEqual(legWarnings(net, legs), ["last-service", "long-wait"]);
});

test("toItinerary: totals from the legs, tags passed through, no previousArriveAt", () => {
  const net = tinyNetwork({
    stops: stopsOf("A", "B", "X"),
    patterns: [{ route: "L", stops: ["A", "B"], trips: [[at(8), at(8, 10)], [at(8, 20), at(8, 30)]] }],
    transfers: [{ a: "B", b: "X", seconds: 150 }],
  });
  const cand = only(candidates(net, stopTime(net, "A", 120, 160), stopTime(net, "X", 200, 250), at(7, 50)));
  const q = { from: HOME, to: WORK, departAt: ms(net, at(7, 50)), walkMetersPerMin: 80 };
  const it = toItinerary(net, q, { cand, score: 1, tags: ["fastest"] });
  assert.equal(it.departAt, it.legs[0].from.time);
  assert.equal(it.arriveAt, it.legs.at(-1)!.to.time);
  assert.equal(it.departAt, ms(net, at(7, 57)));
  assert.equal(it.arriveAt, ms(net, cand.arrive));
  assert.equal(it.rides, 1);
  assert.equal(it.walkMeters, cand.walkMeters);
  assert.deepEqual(it.tags, ["fastest"]);
  assert.equal(it.id, itineraryId(net, it.legs));
  assert.deepEqual(it.warnings, []);
  assert.equal("previousArriveAt" in it, false);
});
