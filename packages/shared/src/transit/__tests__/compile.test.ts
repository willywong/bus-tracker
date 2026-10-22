import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { RAIL_STATIONS } from "../../data/rail-stations.js";
import type { GtfsCalendar, GtfsCalendarDate } from "../../types/gtfs.js";
import { haversineMeters } from "../../utils/outlier.js";
import { expandFrequencies } from "../../utils/t816-bundle.js";
import { gtfsTimeToSeconds } from "../../utils/gtfs-time.js";
import {
  activeServiceIds,
  BUS_HEADWAY_CUTOFF_SEC,
  compileNetwork,
  compileNetworkSync,
  ev,
  GRID_CELL_DEG,
  gridKey,
  isTurnUpAndGo,
  stopsNear,
  type CompileFeeds,
  type CompileOptions,
} from "../compile.js";
import { readFeed, type NormalisedFeed } from "../feeds.js";
import { FEED_IDS, MODES, type FeedId, type TransitNetwork } from "../network.js";

// 2026-10-28 is a Wednesday.
const WED = "20261028";
const CALENDAR =
  "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
  "WK,1,1,1,1,1,0,0,20260101,20261231\n" +
  "WE,0,0,0,0,0,1,1,20260101,20261231\n";

/** A synthetic feed zip read as `feed`, with a weekday (WK) and weekend (WE) calendar. */
function makeFeed(feed: FeedId, files: Record<string, string>): NormalisedFeed {
  const entries = Object.entries({ "calendar.txt": CALENDAR, ...files }).map(([k, v]) => [k, strToU8(v)] as const);
  return readFeed(zipSync(Object.fromEntries(entries)), feed);
}

function feedsOf(list: readonly NormalisedFeed[], excluded: readonly FeedId[] = []): CompileFeeds {
  const out: CompileFeeds = {};
  for (const data of list) {
    out[data.feed] = {
      data,
      meta: { fetchedAt: 1, hash: `h-${data.feed}`, validUntil: data.validUntil, included: !excluded.includes(data.feed) },
    };
  }
  return out;
}

function compile(list: readonly NormalisedFeed[], opts: CompileOptions = {}, ymd = WED): TransitNetwork {
  return compileNetworkSync(feedsOf(list), ymd, { builtAt: 0, ...opts });
}

/** Feeder-style feed: stops A–D in a line ~1 km apart, route R1. */
function feeder(trips: string, stopTimes: string, extra: Record<string, string> = {}): NormalisedFeed {
  return makeFeed("feeder", {
    "routes.txt": "route_id,route_short_name,route_long_name\nR1,T100,Somewhere\nR2,T200,Elsewhere\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "A,Stop A,3.100,101.600\nB,Stop B,3.110,101.600\nC,Stop C,3.120,101.600\nD,Stop D,3.130,101.600\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id,trip_headsign,shape_id\n" + trips,
    "stop_times.txt": "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" + stopTimes,
    ...extra,
  });
}

/** Rows for one trip calling at `stops` at the given HH:MM:SS times. */
function rows(trip: string, stops: string, times: string[]): string {
  return stops
    .split("")
    .map((s, i) => `${trip},${s},${i + 1},${times[i]},${times[i]}\n`)
    .join("");
}

/** Pattern indices of `net` whose route id is `routeId`. */
function patternsOf(net: TransitNetwork, routeId: string): number[] {
  const out: number[] = [];
  for (let p = 0; p < net.patterns.count; p++) {
    if (net.routes.id[net.patterns.route[p]] === routeId) out.push(p);
  }
  return out;
}

function stopIdsOf(net: TransitNetwork, p: number): string[] {
  const { stopStart, stopLen, stops } = net.patterns;
  return Array.from(stops.subarray(stopStart[p], stopStart[p] + stopLen[p]), (i) => net.stops.id[i]);
}

function tripKeysOf(net: TransitNetwork, p: number): string[] {
  const { tripStart, tripLen, tripKey } = net.patterns;
  return tripKey.slice(tripStart[p], tripStart[p] + tripLen[p]);
}

const hms = (s: string) => gtfsTimeToSeconds(s)!;

test("activeServiceIds honours day-of-week, date range and calendar_dates add/remove", () => {
  const cal = (service_id: string, days: string, start_date: string, end_date: string): GtfsCalendar => {
    const [monday, tuesday, wednesday, thursday, friday, saturday, sunday] = days.split("").map((c) => c === "1");
    return { service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date };
  };
  const calendar = [
    cal("weekday", "1111100", "20260101", "20261231"),
    cal("weekend", "0000011", "20260101", "20261231"),
    cal("wed-only", "0010000", "20261028", "20261028"),
    cal("ended", "1111111", "20260101", "20261027"),
    cal("future", "1111111", "20261029", "20261231"),
    cal("holiday", "1111111", "20260101", "20261231"),
  ];
  const dates: GtfsCalendarDate[] = [
    { service_id: "holiday", date: WED, exception_type: 2 },
    { service_id: "weekend", date: WED, exception_type: 1 },
    { service_id: "weekday", date: "20261029", exception_type: 2 },
    { service_id: "extra", date: WED, exception_type: 1 },
  ];
  assert.deepEqual([...activeServiceIds(calendar, dates, WED)].sort(), ["extra", "wed-only", "weekday", "weekend"]);
  // Saturday: weekend + holiday by calendar; nothing in calendar_dates.
  assert.deepEqual([...activeServiceIds(calendar, dates, "20261031")].sort(), ["future", "holiday", "weekend"]);
  // Thursday: weekday removed.
  assert.deepEqual([...activeServiceIds(calendar, dates, "20261029")].sort(), ["future", "holiday"]);
});

test("isTurnUpAndGo: rail at any headway, bus only ≤ 720 s", () => {
  assert.equal(BUS_HEADWAY_CUTOFF_SEC, 720);
  assert.equal(isTurnUpAndGo("rail", 180), true);
  assert.equal(isTurnUpAndGo("rail", 840), true);
  assert.equal(isTurnUpAndGo("rail", 3600), true);
  assert.equal(isTurnUpAndGo("bus-kl", 720), true);
  assert.equal(isTurnUpAndGo("bus-kl", 721), false);
  assert.equal(isTurnUpAndGo("feeder", 600), true);
  assert.equal(isTurnUpAndGo("feeder", 1800), false);
  assert.equal(isTurnUpAndGo("bus-kl", 900, 900), true);
  assert.equal(isTurnUpAndGo("rail", 900, 60), true, "the cutoff never applies to rail");
});

test("trips with identical stop sequences share a pattern; different directions do not", () => {
  const net = compile([
    feeder(
      "R1,WK,T1,0,To C,S1\nR1,WK,T2,0,,S1\nR1,WK,T3,1,Back,S2\nR1,WE,T4,0,,S1\n",
      rows("T1", "ABC", ["07:00:00", "07:10:00", "07:20:00"]) +
        rows("T2", "ABC", ["08:00:00", "08:10:00", "08:20:00"]) +
        rows("T3", "ABC", ["09:00:00", "09:10:00", "09:20:00"]) +
        rows("T4", "ABC", ["10:00:00", "10:10:00", "10:20:00"]),
    ),
  ]);
  const ps = patternsOf(net, "R1");
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map((p) => tripKeysOf(net, p)), [["T1", "T2"], ["T3"]], "T4 runs at weekends only");
  for (const p of ps) assert.deepEqual(stopIdsOf(net, p), ["A", "B", "C"]);
  assert.equal(net.patterns.headsign[ps[0]], "To C");
  assert.equal(net.patterns.headsign[ps[1]], "Back");
  // Routes: one per route_id, metadata from routeMeta, shape from the first trip.
  assert.deepEqual(net.routes.id, ["R1", "R2"]);
  assert.deepEqual(net.routes.label, ["T100", "T200"]);
  assert.equal(net.routes.longName[0], "Somewhere");
  assert.equal(MODES[net.routes.mode[0]], "feeder");
  assert.equal(FEED_IDS[net.routes.feed[0]], "feeder");
  assert.equal(net.routes.color[0], "#000000");
  assert.equal(net.routes.textColor[0], "#FFFFFF");
  assert.deepEqual(net.routes.shapeId, ["S1", ""]);
  // No windows: runOffset stays zero.
  assert.ok(net.patterns.runOffset.every((x) => x === 0));
  assert.equal(net.patterns.fStart.length, 0);
});

test("headsign falls back to the last stop's display name", () => {
  const net = compile([feeder("R1,WK,T1,0,,\n", rows("T1", "ABD", ["07:00:00", "07:10:00", "07:20:00"]))]);
  assert.equal(net.patterns.headsign[0], "Stop D");
});

test("trips sort by first departure within a pattern", () => {
  const net = compile([
    feeder(
      "R1,WK,T1,0,,\nR1,WK,T2,0,,\nR1,WK,T3,0,,\n",
      rows("T1", "ABC", ["08:00:00", "08:10:00", "08:20:00"]) +
        rows("T2", "ABC", ["07:00:00", "07:10:00", "07:20:00"]) +
        rows("T3", "ABC", ["09:00:00", "09:10:00", "09:20:00"]),
    ),
  ]);
  assert.equal(net.patterns.count, 1);
  assert.deepEqual(tripKeysOf(net, 0), ["T2", "T1", "T3"]);
  const firstDeps = [0, 1, 2].map((t) => net.patterns.dep[ev(net, 0, t, 0)]);
  assert.deepEqual(firstDeps, [hms("07:00:00"), hms("08:00:00"), hms("09:00:00")]);
  assert.equal(net.patterns.arr[ev(net, 0, 1, 2)], hms("08:20:00"));
});

test("an overtaking express is split into its own pattern (FIFO)", () => {
  const net = compile([
    feeder(
      "R1,WK,SLOW,0,,\nR1,WK,EXPRESS,0,,\nR1,WK,LATER,0,,\n",
      rows("SLOW", "ABC", ["07:00:00", "07:30:00", "08:00:00"]) +
        rows("EXPRESS", "ABC", ["07:10:00", "07:20:00", "07:40:00"]) +
        rows("LATER", "ABC", ["07:20:00", "07:50:00", "08:20:00"]),
    ),
  ]);
  const ps = patternsOf(net, "R1");
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map((p) => tripKeysOf(net, p)), [["SLOW", "LATER"], ["EXPRESS"]]);
  assert.deepEqual(stopIdsOf(net, ps[0]), stopIdsOf(net, ps[1]));
  assert.equal(net.patterns.headsign[ps[0]], net.patterns.headsign[ps[1]]);
  // FIFO holds in every pattern at every stop.
  for (const p of ps) {
    for (let t = 1; t < net.patterns.tripLen[p]; t++) {
      for (let s = 0; s < net.patterns.stopLen[p]; s++) {
        assert.ok(net.patterns.dep[ev(net, p, t, s)] >= net.patterns.dep[ev(net, p, t - 1, s)]);
      }
    }
  }
});

test("ev indexes never overlap across patterns with different stopLen", () => {
  const net = compile([
    feeder(
      "R1,WK,T1,0,,\nR1,WK,T2,0,,\nR2,WK,U1,0,,\nR2,WK,U2,0,,\nR2,WK,U3,0,,\n",
      rows("T1", "ABCD", ["07:00:00", "07:10:00", "07:20:00", "07:30:00"]) +
        rows("T2", "ABCD", ["08:00:00", "08:10:00", "08:20:00", "08:30:00"]) +
        rows("U1", "AB", ["07:00:00", "07:10:00"]) +
        rows("U2", "AB", ["08:00:00", "08:10:00"]) +
        rows("U3", "AB", ["09:00:00", "09:10:00"]),
    ),
  ]);
  const { count, tripLen, stopLen } = net.patterns;
  assert.equal(count, 2);
  assert.notEqual(stopLen[0], stopLen[1]);
  const seen = new Set<number>();
  for (let p = 0; p < count; p++) {
    for (let t = 0; t < tripLen[p]; t++) {
      for (let s = 0; s < stopLen[p]; s++) {
        const i = ev(net, p, t, s);
        assert.ok(!seen.has(i), `p${p} t${t} s${s} → ${i} reused`);
        seen.add(i);
      }
    }
  }
  assert.equal(seen.size, net.patterns.arr.length);
  assert.equal(net.patterns.dep[ev(net, 1, 2, 1)], hms("09:10:00"));
});

/** bus-kl-style headway template K1 over A→B→C, with the given frequencies.txt rows. */
function busKl(frequencies: string): NormalisedFeed {
  return makeFeed("bus-kl", {
    "routes.txt": "route_id,route_short_name,route_long_name\n400,400,Route 400\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "A,Stop A,3.100,101.600\nB,Stop B,3.110,101.600\nC,Stop C,3.120,101.600\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id\n400,WK,K1,0\n",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
      "K1,C,3,06:12:00,06:12:00\nK1,A,1,06:00:00,06:00:00\nK1,B,2,06:04:00,06:05:00\n",
    "frequencies.txt": "trip_id,start_time,end_time,headway_secs,exact_times\n" + frequencies,
  });
}

test("bus headway ≤ 720 s becomes a freq window with runOffset from the template", () => {
  const net = compile([busKl("K1,06:00:00,09:00:00,600,0\n")]);
  const p = net.patterns;
  assert.equal(p.count, 1);
  assert.deepEqual(stopIdsOf(net, 0), ["kl:A", "kl:B", "kl:C"]);
  assert.equal(p.tripLen[0], 0);
  assert.equal(p.freqLen[0], 1);
  const w = p.freqStart[0];
  assert.deepEqual([p.fStart[w], p.fEnd[w], p.fHeadway[w]], [hms("06:00:00"), hms("09:00:00"), 600]);
  assert.deepEqual(Array.from(p.runOffset.subarray(p.stopStart[0], p.stopStart[0] + 3)), [0, 300, 720]);
});

test("bus headway > 720 s expands to concrete trips keyed <template>@HH:MM", () => {
  const feed = busKl("K1,06:00:00,07:00:00,1800,0\n");
  const net = compile([feed]);
  const p = net.patterns;
  assert.equal(p.count, 1);
  assert.equal(p.freqLen[0], 0);
  assert.deepEqual(tripKeysOf(net, 0), ["kl:K1@06:00", "kl:K1@06:30", "kl:K1@07:00"]);
  // Same instances and times as expandFrequencies.
  const { parsed } = feed;
  const expanded = expandFrequencies(parsed.trips, parsed.stopTimes, parsed.frequencies);
  assert.deepEqual(expanded.trips.map((t) => t.trip_id), tripKeysOf(net, 0));
  for (let t = 0; t < 3; t++) {
    const sts = expanded.stopTimes
      .filter((st) => st.trip_id === expanded.trips[t].trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence);
    for (let s = 0; s < 3; s++) {
      assert.equal(p.arr[ev(net, 0, t, s)], hms(sts[s].arrival_time!));
      assert.equal(p.dep[ev(net, 0, t, s)], hms(sts[s].departure_time!));
    }
  }
  assert.equal(p.arr[ev(net, 0, 1, 1)], hms("06:34:00"));
  assert.equal(p.dep[ev(net, 0, 1, 1)], hms("06:35:00"));
});

test("a template with both short and long windows yields both kinds on one pattern", () => {
  const net = compile([busKl("K1,06:00:00,09:00:00,600,0\nK1,20:00:00,21:00:00,3600,0\n")]);
  const p = net.patterns;
  assert.equal(p.count, 1);
  assert.equal(p.freqLen[0], 1);
  assert.deepEqual(tripKeysOf(net, 0), ["kl:K1@20:00", "kl:K1@21:00"]);
  assert.equal(p.fHeadway[p.freqStart[0]], 600);
});

test("templates whose run times differ by more than 60 s get separate patterns", () => {
  const feed = makeFeed("bus-kl", {
    "routes.txt": "route_id,route_short_name\n400,400\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nA,A,3.1,101.6\nB,B,3.11,101.6\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id\n400,WK,K1,0\n400,WK,K2,0\n400,WK,K3,0\n",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
      rows("K1", "AB", ["06:00:00", "06:10:00"]) +
      rows("K2", "AB", ["09:00:00", "09:11:00"]) +
      rows("K3", "AB", ["17:00:00", "17:20:00"]),
    "frequencies.txt":
      "trip_id,start_time,end_time,headway_secs\n" +
      "K1,06:00:00,09:00:00,300\nK2,09:00:00,17:00:00,600\nK3,17:00:00,19:00:00,300\n",
  });
  const net = compile([feed]);
  const p = net.patterns;
  assert.equal(p.count, 2);
  assert.deepEqual([p.freqLen[0], p.freqLen[1]], [2, 1]);
  assert.deepEqual([p.runOffset[p.stopStart[0] + 1], p.runOffset[p.stopStart[1] + 1]], [600, 1200]);
  // Windows sorted by start within a pattern.
  assert.deepEqual([p.fStart[p.freqStart[0]], p.fStart[p.freqStart[0] + 1]], [hms("06:00:00"), hms("09:00:00")]);
});

test("an 840 s rail window stays a freq window (no expanded trips)", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const rail = makeFeed("rail", {
    "routes.txt": "route_id,route_short_name,route_long_name\nKJ,KJ,LRT Kelana Jaya Line\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "KJ1,GOMBAK,3.231,101.724\nKJ2,TAMAN MELATI,3.219,101.722\nKJ99,NEW STATION,3.200,101.720\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id,trip_headsign\nKJ,WK,KJ_0,0,Putra Heights\n",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" +
      "KJ_0,KJ1,1,22:00:00,22:00:00\nKJ_0,KJ2,2,22:02:00,22:02:30\nKJ_0,KJ99,3,22:05:00,22:05:00\n",
    "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nKJ_0,22:00:00,24:00:00,840\n",
  });
  const net = compile([rail]);
  const p = net.patterns;
  assert.equal(p.count, 1);
  assert.equal(p.freqLen[0], 1);
  assert.equal(p.tripLen[0], 0);
  assert.equal(p.tripKey.length, 0);
  assert.equal(p.fEnd[p.freqStart[0]], 86_400);
  assert.deepEqual(Array.from(p.runOffset.subarray(0, 3)), [0, 150, 300]);
  assert.equal(net.routes.label[0], "KJ");
  assert.equal(MODES[net.routes.mode[0]], "lrt");

  // Stations: every RAIL_STATIONS entry, namespaced, plus one for the stop it lacks.
  assert.equal(net.stations.length, RAIL_STATIONS.length + 1);
  const gombak = net.stations[net.stops.station[0]];
  assert.ok(gombak.stopIds.includes("rail:KJ1"));
  assert.equal(gombak.name, RAIL_STATIONS.find((s) => s.stopIds.includes("KJ1"))?.name);
  const added = net.stations[net.stops.station[2]];
  assert.equal(net.stops.station[2], RAIL_STATIONS.length);
  assert.deepEqual(added.stopIds, ["rail:KJ99"]);
  assert.equal(added.name, "New Station");
  assert.deepEqual(added.lines.map((l) => l.code), ["LRT KJ"]);
  assert.equal(warn.mock.callCount(), 1);
});

test("times past 24:00:00 are kept above 86400", () => {
  const net = compile([
    feeder(
      "R1,WK,LATE,0,,\n",
      rows("LATE", "ABC", ["23:50:00", "24:10:00", "25:30:00"]),
    ),
  ]);
  const p = net.patterns;
  assert.deepEqual(
    [0, 1, 2].map((s) => p.arr[ev(net, 0, 0, s)]),
    [23 * 3600 + 50 * 60, 86_400 + 600, 86_400 + 5400],
  );
});

test("missing arrival or departure takes the other; bad times or < 2 stops skip the trip", () => {
  const net = compile([
    feeder(
      "R1,WK,OK,0,,\nR1,WK,BAD,0,,\nR1,WK,ONE,0,,\n",
      "OK,A,1,,07:00:00\nOK,B,2,07:10:00,\nOK,C,3,07:20:00,07:21:00\n" +
        "BAD,A,1,08:00:00,08:00:00\nBAD,B,2,8h10,8h10\nBAD,C,3,08:20:00,08:20:00\n" +
        "ONE,A,1,09:00:00,09:00:00\n",
    ),
  ]);
  const p = net.patterns;
  assert.equal(p.count, 1);
  assert.deepEqual(tripKeysOf(net, 0), ["OK"]);
  assert.deepEqual(
    [0, 1, 2].map((s) => [p.arr[ev(net, 0, 0, s)], p.dep[ev(net, 0, 0, s)]]),
    [[25_200, 25_200], [25_800, 25_800], [26_400, 26_460]],
  );
});

test("excluded feeds contribute nothing", () => {
  const f = feeder("R1,WK,T1,0,,\n", rows("T1", "ABC", ["07:00:00", "07:10:00", "07:20:00"]));
  const kl = busKl("K1,06:00:00,09:00:00,600,0\n");
  const net = compileNetworkSync(feedsOf([f, kl], ["bus-kl"]), WED, { builtAt: 42 });
  assert.equal(net.stops.count, 4);
  assert.ok(net.stops.id.every((id) => !id.startsWith("kl:")));
  assert.ok(net.routes.id.every((id) => !id.startsWith("kl:")));
  assert.equal(net.patterns.count, 1);
  assert.equal(net.patterns.fStart.length, 0);
  assert.equal(net.stations.length, 0);
  assert.deepEqual(net.meta, {
    version: 1,
    serviceDate: WED,
    builtAt: 42,
    feeds: {
      rail: { fetchedAt: 0, hash: "", validUntil: "", included: false },
      "bus-kl": { fetchedAt: 1, hash: "h-bus-kl", validUntil: "20261231", included: false },
      feeder: { fetchedAt: 1, hash: "h-feeder", validUntil: "20261231", included: true },
      ktm: { fetchedAt: 0, hash: "", validUntil: "", included: false },
    },
  });
  // Transfers are left for task 04: empty CSR over every stop.
  assert.equal(net.transfers.start.length, 4);
  assert.equal(net.transfers.len.length, 4);
  assert.equal(net.transfers.to.length, 0);
});

test("stopRoutes lists every (pattern, pos), loops twice", () => {
  const net = compile([
    feeder(
      "R1,WK,LOOP,0,,\nR2,WK,T2,0,,\n",
      rows("LOOP", "ABCA", ["07:00:00", "07:10:00", "07:20:00", "07:30:00"]) +
        rows("T2", "CD", ["07:00:00", "07:10:00"]),
    ),
  ]);
  const { start, len, pattern, pos } = net.stopRoutes;
  const at = (id: string) => {
    const i = net.stops.id.indexOf(id);
    return Array.from({ length: len[i] }, (_, k) => [pattern[start[i] + k], pos[start[i] + k]]);
  };
  assert.deepEqual(at("A"), [[0, 0], [0, 3]]);
  assert.deepEqual(at("C"), [[0, 2], [1, 0]]);
  assert.deepEqual(at("D"), [[1, 1]]);
  assert.equal(pattern.length, 6);
});

test("generator yields at least stopEvents / yieldEvery times", () => {
  const f = feeder(
    "R1,WK,T1,0,,\nR1,WK,T2,0,,\nR1,WK,T3,0,,\n",
    rows("T1", "ABCD", ["07:00:00", "07:10:00", "07:20:00", "07:30:00"]) +
      rows("T2", "ABCD", ["08:00:00", "08:10:00", "08:20:00", "08:30:00"]) +
      rows("T3", "ABCD", ["09:00:00", "09:10:00", "09:20:00", "09:30:00"]),
  );
  const steps = compileNetwork(feedsOf([f]), WED, { yieldEvery: 4 });
  let yields = 0;
  let net: TransitNetwork;
  for (;;) {
    const step = steps.next();
    if (step.done) {
      net = step.value;
      break;
    }
    yields++;
  }
  assert.equal(net.patterns.arr.length, 12);
  assert.ok(yields >= 12 / 4, `${yields} yields`);
});

test("stopsNear finds stops across a cell boundary", () => {
  // A cell edge sits on lat 3.1 (93.1 / 0.005 = 18620); X and Y straddle it ~22 m apart.
  const f = makeFeed("feeder", {
    "routes.txt": "route_id,route_short_name\nR1,T1\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "X,X,3.1001,101.6\nY,Y,3.0999,101.6\nFAR,Far,3.1100,101.6\nE,E,3.1001,101.6024\n",
    "trips.txt": "route_id,service_id,trip_id\nR1,WK,T1\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n" + rows("T1", "XY", ["07:00:00", "07:01:00"]),
  });
  const net = compile([f]);
  const [x, y, far, e] = ["X", "Y", "FAR", "E"].map((id) => net.stops.id.indexOf(id));
  assert.equal(net.grid.cellDeg, GRID_CELL_DEG);
  assert.notEqual(gridKey(net.stops.lat[x], net.stops.lon[x], GRID_CELL_DEG), gridKey(net.stops.lat[y], net.stops.lon[y], GRID_CELL_DEG));
  assert.deepEqual(stopsNear(net, 3.0999, 101.6, 100), [x, y]);
  // 101.6024 is ~267 m east of X, and FAR ~1.1 km north: only a bigger radius reaches them.
  assert.deepEqual(stopsNear(net, 3.1001, 101.6, 300), [x, y, e]);
  assert.deepEqual(stopsNear(net, 3.1001, 101.6, 1200), [x, y, far, e]);
  // Every stop in a cell is listed, ascending.
  let listed = 0;
  for (const [key, cell] of net.grid.cells) {
    for (let k = 0; k < cell.length; k++) {
      assert.equal(gridKey(net.stops.lat[cell[k]], net.stops.lon[cell[k]], GRID_CELL_DEG), key);
      if (k > 0) assert.ok(cell[k] > cell[k - 1]);
    }
    listed += cell.length;
  }
  assert.equal(listed, net.stops.count);
});

// ---------------------------------------------------------------------------
// Fixture feeds, captured 2026-10-23
// ---------------------------------------------------------------------------

const FIXTURES = new URL("../__fixtures__/2026-10-23/", import.meta.url);
const ZIP: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};
let fixtureFeeds: NormalisedFeed[] | null = null;
function fixtures(): NormalisedFeed[] {
  fixtureFeeds ??= FEED_IDS.map((f) => readFeed(new Uint8Array(readFileSync(new URL(ZIP[f], FIXTURES))), f));
  return fixtureFeeds;
}

/** task 00 sizing for 20261028 (fixture README): patterns and trip-equivalents per feed. */
const BASELINE: Record<FeedId, { stops: number; patterns: number; tripEquivalents: number }> = {
  rail: { stops: 187, patterns: 16, tripEquivalents: 2779 },
  "bus-kl": { stops: 4036, patterns: 171, tripEquivalents: 6817 },
  feeder: { stops: 2117, patterns: 92, tripEquivalents: 3443 },
  ktm: { stops: 49, patterns: 18, tripEquivalents: 90 },
};

const within = (actual: number, expected: number, frac: number) => Math.abs(actual - expected) <= expected * frac;

test("compiles all four fixture feeds for 20261028", () => {
  const feeds = fixtures();
  const net = compileNetworkSync(feedsOf(feeds), WED);
  const p = net.patterns;

  type Counts = { stops: number; patterns: number; base: number; fifoSplits: number; templateSplits: number; trips: number; windows: number; tripEquivalents: number; events: number };
  const perFeed = new Map<FeedId, Counts>();
  for (const f of FEED_IDS) {
    perFeed.set(f, { stops: 0, patterns: 0, base: 0, fifoSplits: 0, templateSplits: 0, trips: 0, windows: 0, tripEquivalents: 0, events: 0 });
  }
  for (let i = 0; i < net.stops.count; i++) perFeed.get(FEED_IDS[net.stops.feed[i]])!.stops++;
  // Patterns split from one (route, stop sequence): extra timetabled ones are
  // FIFO splits (or a direction_id split: KTM trip 2169 runs the direction-1
  // stops as direction 0), extra windowed ones templates whose run times disagree.
  const base = new Map<string, { timed: number; windowed: number }>();
  for (let q = 0; q < p.count; q++) {
    const c = perFeed.get(FEED_IDS[net.routes.feed[p.route[q]]])!;
    c.patterns++;
    c.trips += p.tripLen[q];
    c.events += p.tripLen[q] * p.stopLen[q];
    c.tripEquivalents += p.tripLen[q];
    for (let w = p.freqStart[q]; w < p.freqStart[q] + p.freqLen[q]; w++) {
      c.windows++;
      c.tripEquivalents += Math.floor((p.fEnd[w] - p.fStart[w]) / p.fHeadway[w]) + 1;
    }
    const key = `${p.route[q]}|${stopIdsOf(net, q).join(",")}`;
    let b = base.get(key);
    if (!b) {
      base.set(key, (b = { timed: 0, windowed: 0 }));
      c.base++;
    }
    if (p.tripLen[q] > 0 && b.timed++ > 0) c.fifoSplits++;
    if (p.freqLen[q] > 0 && b.windowed++ > 0) c.templateSplits++;
  }
  console.log(`fixture network ${WED}: ${net.stops.count} stops, ${p.count} patterns, ${p.tripKey.length} trips, ${p.arr.length} stop events, ${p.fStart.length} windows, ${net.stations.length} stations`);
  for (const [f, c] of perFeed) {
    const b = BASELINE[f];
    console.log(
      `  ${f.padEnd(7)} stops ${c.stops} (task 00 served ${b.stops}) · patterns ${c.patterns} = ${c.base} (task 00 ${b.patterns}) + ${c.fifoSplits} FIFO/direction + ${c.templateSplits} template splits · trips ${c.trips} · windows ${c.windows} · trip-equivalents ${c.tripEquivalents} (task 00 ${b.tripEquivalents}) · events ${c.events}`,
    );
    assert.ok(within(c.stops, b.stops, 0.01), `${f} stops ${c.stops} vs ${b.stops}`);
    // task 00 keyed patterns by (route, direction, stops): between the two.
    assert.ok(c.base <= b.patterns && b.patterns <= c.patterns, `${f} patterns ${c.base}/${c.patterns} vs ${b.patterns}`);
    assert.ok(c.patterns - c.base <= Math.max(2, c.base * 0.1), `${f}: ${c.patterns - c.base} split patterns`);
    assert.ok(within(c.tripEquivalents, b.tripEquivalents, 0.01), `${f} trip-equivalents ${c.tripEquivalents} vs ${b.tripEquivalents}`);
  }
  // ≈6.5k stops less the KTM stops cut to the Komuter lines in the bbox.
  assert.ok(net.stops.count > 6300 && net.stops.count < 6500, `${net.stops.count} stops`);
  // ≈12.3k (spec §1, exclusive windows) less the KTM trips cut; task 00 measured 13.1k with inclusive windows.
  const tripEquivalents = [...perFeed.values()].reduce((n, c) => n + c.tripEquivalents, 0);
  assert.ok(within(tripEquivalents, 13_129, 0.05), `${tripEquivalents} trip-equivalents`);
  assert.equal(perFeed.get("ktm")!.trips, 90);
  assert.equal(perFeed.get("feeder")!.windows, 0);
  assert.equal(perFeed.get("ktm")!.windows, 0);

  // No rail window was expanded, and the 840 s Putrajaya window is a window.
  for (let q = 0; q < p.count; q++) {
    if (FEED_IDS[net.routes.feed[p.route[q]]] !== "rail") continue;
    assert.equal(p.tripLen[q], 0, `rail pattern ${q} has trips`);
  }
  assert.ok(!p.tripKey.some((k) => k.startsWith("rail:")));
  let railOver720 = 0;
  for (let q = 0; q < p.count; q++) {
    if (FEED_IDS[net.routes.feed[p.route[q]]] !== "rail") continue;
    for (let w = p.freqStart[q]; w < p.freqStart[q] + p.freqLen[q]; w++) if (p.fHeadway[w] > 720) railOver720++;
  }
  assert.equal(railOver720, 1);
  // Every bus window left as a window is ≤ 720 s; every expanded bus trip is keyed <template>@HH:MM.
  for (let q = 0; q < p.count; q++) {
    const feed = FEED_IDS[net.routes.feed[p.route[q]]];
    if (feed === "rail") continue;
    for (let w = p.freqStart[q]; w < p.freqStart[q] + p.freqLen[q]; w++) assert.ok(p.fHeadway[w] <= 720);
  }

  // arr ≤ dep at each stop, times never go backwards along a trip, FIFO within a pattern.
  for (let q = 0; q < p.count; q++) {
    for (let t = 0; t < p.tripLen[q]; t++) {
      for (let s = 0; s < p.stopLen[q]; s++) {
        const i = ev(net, q, t, s);
        assert.ok(p.arr[i] <= p.dep[i], `${p.tripKey[p.tripStart[q] + t]} stop ${s}: arr > dep`);
        if (s > 0) assert.ok(p.dep[i - 1] <= p.arr[i], `${p.tripKey[p.tripStart[q] + t]} stop ${s}: goes backwards`);
        if (t > 0) assert.ok(p.dep[ev(net, q, t - 1, s)] <= p.dep[i], `pattern ${q} trip ${t}: not FIFO`);
      }
    }
    for (let w = p.freqStart[q] + 1; w < p.freqStart[q] + p.freqLen[q]; w++) assert.ok(p.fStart[w - 1] <= p.fStart[w]);
  }

  // Stations: RAIL_STATIONS plus one per KTM stop; every rail and KTM stop has one.
  const ktmStops = net.stops.id.filter((id) => id.startsWith("ktm:")).length;
  assert.equal(net.stations.length, RAIL_STATIONS.length + ktmStops);
  for (let i = 0; i < net.stops.count; i++) {
    const feed = FEED_IDS[net.stops.feed[i]];
    const st = net.stops.station[i];
    if (feed === "rail" || feed === "ktm") {
      assert.ok(st >= 0 && net.stations[st].stopIds.includes(net.stops.id[i]), net.stops.id[i]);
    } else {
      assert.equal(st, -1);
    }
  }
  const sentral = net.stations[net.stops.station[net.stops.id.indexOf("ktm:19100")]];
  assert.equal(sentral.id, "ktm-kl-sentral");
  assert.equal(sentral.name, "KL Sentral");
  assert.ok(sentral.lines.length >= 1 && sentral.lines.every((l) => l.mode === "KTM" && l.code === "KTM"));
  assert.ok(sentral.lines.some((l) => l.color === "#DC2420"), "Port Klang Line colour");
  const kj15 = net.stations[net.stops.station[net.stops.id.indexOf("rail:KJ15")]];
  assert.ok(kj15.stopIds.includes("rail:MR1"));

  // stopRoutes and grid cover every stop slot and every stop.
  let slots = 0;
  for (let q = 0; q < p.count; q++) slots += p.stopLen[q];
  assert.equal(net.stopRoutes.pattern.length, slots);
  let gridded = 0;
  for (const cell of net.grid.cells.values()) gridded += cell.length;
  assert.equal(gridded, net.stops.count);
  const kj15i = net.stops.id.indexOf("rail:KJ15");
  const near = stopsNear(net, net.stops.lat[kj15i], net.stops.lon[kj15i], 250);
  assert.ok(near.includes(kj15i) && near.includes(net.stops.id.indexOf("ktm:19100")));
  for (const i of near) {
    const d = haversineMeters(
      { lat: net.stops.lat[kj15i], lng: net.stops.lon[kj15i] },
      { lat: net.stops.lat[i], lng: net.stops.lon[i] },
    );
    assert.ok(d <= 250);
  }
});

test("compile time on node", () => {
  const feeds = fixtures();
  compileNetworkSync(feedsOf(feeds), WED); // warm-up
  const t0 = performance.now();
  compileNetworkSync(feedsOf(feeds), WED);
  const syncMs = performance.now() - t0;
  // Longest single generator step at the default yieldEvery.
  const steps = compileNetwork(feedsOf(feeds), WED);
  let longest = 0;
  let count = 0;
  for (;;) {
    const s0 = performance.now();
    const step = steps.next();
    longest = Math.max(longest, performance.now() - s0);
    count++;
    if (step.done) break;
  }
  console.log(`compileNetworkSync: ${syncMs.toFixed(1)} ms on node; ${count} steps, longest ${longest.toFixed(2)} ms`);
});
