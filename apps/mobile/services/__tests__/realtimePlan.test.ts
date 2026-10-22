import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecodedFeed } from "@bus-tracker/shared";

import type { PlannerFeedRoutes } from "@bus-tracker/shared";

import {
  buildRealtimePlan,
  mergeExtraRoutes,
  positionsFromFeed,
  requestsPerMinute,
  routeFeedHealth,
  tripMapRouteCodes,
} from "../realtimePlan";

const NOW = Date.UTC(2026, 9, 21, 4, 0, 0);

function feed(
  vehicles: Array<{ id: string; trip_id: string; route_id: string; stop_id?: string; start_time?: string }>,
): DecodedFeed {
  return {
    header: { gtfs_realtime_version: "2.0" },
    entity: vehicles.map((v) => ({
      id: v.id,
      vehicle: {
        trip: { trip_id: v.trip_id, route_id: v.route_id, start_time: v.start_time },
        vehicle: { id: v.id },
        position: { latitude: 3.1, longitude: 101.6 },
        timestamp: NOW / 1000,
        stop_id: v.stop_id,
      },
    })),
  } as unknown as DecodedFeed;
}

test("polls only the categories of followed routes", () => {
  const plan = buildRealtimePlan(
    ["T816", "400"],
    [
      { code: "T816", route_id: "30000025", category: "rapid-bus-mrtfeeder" },
      { code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" },
    ],
    new Map([["261021010076S10", "T816"]]),
  );
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.feeds.map((f) => f.category), ["rapid-bus-mrtfeeder", "rapid-bus-kl"]);
});

test("pre-category rows are treated as feeder rows", () => {
  const plan = buildRealtimePlan(["T816"], [{ code: "T816", route_id: "30000025", category: null }], new Map());
  assert.deepEqual(plan.feeds.map((f) => f.category), ["rapid-bus-mrtfeeder"]);
});

test("Kuantan has no realtime feed, so nothing is polled for it", () => {
  const plan = buildRealtimePlan(
    ["300 Kuantan"],
    [{ code: "300 Kuantan", route_id: "kt:K3000", category: "rapid-bus-kuantan" }],
    new Map(),
  );
  assert.deepEqual(plan.feeds, []);
});

test("a route not yet in SQLite guesses its feeds and asks to be rebuilt", () => {
  const bare = buildRealtimePlan(["750"], [], new Map());
  assert.equal(bare.complete, false);
  assert.deepEqual(bare.feeds.map((f) => f.category), ["rapid-bus-mrtfeeder", "rapid-bus-kl"]);
  const penang = buildRealtimePlan(["401 Penang"], [], new Map());
  assert.deepEqual(penang.feeds.map((f) => [f.category, [...f.aliases]]), [
    ["rapid-bus-penang", [["401", "401 Penang"]]],
  ]);
});

test("Rapid KL vehicles resolve by GTFS route_id and get namespaced ids", () => {
  const plan = buildRealtimePlan(
    ["400"],
    [{ code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" }],
    new Map(),
  );
  const positions = positionsFromFeed(
    plan.feeds[0],
    feed([
      { id: "WVH1852", trip_id: "weekday_U4000_U400002_2", route_id: "U4000", stop_id: "1005840" },
      { id: "OTHER", trip_id: "weekday_U7800_U780002_2", route_id: "U7800" },
    ]),
    NOW,
  );
  assert.deepEqual(
    positions.map((p) => [p.vehicleId, p.routeId, p.tripId, p.currentStopId]),
    [["WVH1852", "400", "kl:weekday_U4000_U400002_2", "kl:1005840"]],
  );
});

test("Penang vehicles map their bare route code to the suffixed key", () => {
  const plan = buildRealtimePlan(
    ["401 Penang"],
    [{ code: "401 Penang", route_id: "pg:30000019", category: "rapid-bus-penang" }],
    new Map(),
  );
  const positions = positionsFromFeed(
    plan.feeds[0],
    feed([{ id: "PJH4862", trip_id: "261016010252S5", route_id: "401" }]),
    NOW,
  );
  assert.deepEqual(positions.map((p) => [p.routeId, p.tripId]), [["401 Penang", "pg:261016010252S5"]]);
});

test("feeder vehicles keep raw ids; a direction suffix on route_id still matches", () => {
  const plan = buildRealtimePlan(
    ["T155"],
    [{ code: "T155", route_id: "30000155", category: "rapid-bus-mrtfeeder" }],
    new Map(),
  );
  const positions = positionsFromFeed(
    plan.feeds[0],
    feed([{ id: "VAF5766", trip_id: "261002010006S6", route_id: "T155 Inbound", stop_id: "12003044" }]),
    NOW,
  );
  assert.deepEqual(
    positions.map((p) => [p.routeId, p.tripId, p.currentStopId]),
    [["T155", "261002010006S6", "12003044"]],
  );
});

test("Rapid KL trip ids carry the run's start time when the feed gives one", () => {
  const plan = buildRealtimePlan(["400"], [{ code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" }], new Map());
  const positions = positionsFromFeed(
    plan.feeds[0],
    feed([
      { id: "A", trip_id: "weekday_U4000_x_2", route_id: "U4000", start_time: "12:52:10" },
      { id: "B", trip_id: "weekday_U4000_x_2", route_id: "U4000", start_time: "13:05:00" },
    ]),
    NOW,
  );
  assert.deepEqual(positions.map((p) => p.tripId), ["kl:weekday_U4000_x_2@12:52:10", "kl:weekday_U4000_x_2@13:05"]);
});

test("feed health is per route, so one network can't mask another", () => {
  const plan = buildRealtimePlan(
    ["T816", "400", "300 Kuantan"],
    [
      { code: "T816", route_id: "30000025", category: "rapid-bus-mrtfeeder" },
      { code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" },
      { code: "300 Kuantan", route_id: "kt:K3000", category: "rapid-bus-kuantan" },
    ],
    new Map(),
  );
  const down = new Error("realtime 503");
  const health = routeFeedHealth(
    ["T816", "400", "300 Kuantan"],
    plan,
    new Map([
      ["rapid-bus-mrtfeeder", { vehicleCount: 0, error: null }],
      ["rapid-bus-kl", { vehicleCount: null, error: down }],
    ]),
  );
  assert.deepEqual(health, {
    // Feeder feed up but empty: that route alone reads as "feed down".
    T816: { vehicleCount: 0, error: null },
    // KL fetch failed: the error belongs to 400 only.
    "400": { vehicleCount: null, error: down },
    // No realtime feed at all: unknown, never "feed down" or ghost warnings.
    "300 Kuantan": { vehicleCount: null, error: null },
  });
});

test("trip ids are loaded only for networks matched by trip id", () => {
  assert.deepEqual(
    tripMapRouteCodes([
      { code: "T816", route_id: "30000025", category: "rapid-bus-mrtfeeder" },
      { code: "T789", route_id: "30000026", category: null },
      { code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" },
      { code: "401 Penang", route_id: "pg:30000019", category: "rapid-bus-penang" },
      { code: "300 Kuantan", route_id: "kt:K3000", category: "rapid-bus-kuantan" },
    ]),
    ["T816", "T789", "401 Penang"],
  );
});

test("other routes' buses are dropped before their ids are namespaced", () => {
  const plan = buildRealtimePlan(
    ["401 Penang"],
    [{ code: "401 Penang", route_id: "pg:30000019", category: "rapid-bus-penang" }],
    // A drifted route_id: this bus is found by its trip id alone.
    new Map([["pg:261016010252S5", "401 Penang"]]),
  );
  const f = feed([
    { id: "MINE", trip_id: "261016010252S5", route_id: "401X" },
    { id: "OTHER", trip_id: "261016010999S1", route_id: "302", stop_id: "P9" },
  ]);
  let otherStopReads = 0;
  const other = f.entity[1].vehicle!;
  Object.defineProperty(other, "stop_id", {
    enumerable: true,
    get: () => {
      otherStopReads++;
      return "P9";
    },
  });
  const positions = positionsFromFeed(plan.feeds[0], f, NOW);
  assert.deepEqual(positions.map((p) => [p.vehicleId, p.routeId, p.tripId]), [
    ["MINE", "401 Penang", "pg:261016010252S5"],
  ]);
  assert.equal(otherStopReads, 0);
});

const FEEDER_EXTRA: PlannerFeedRoutes = {
  category: "rapid-bus-mrtfeeder",
  aliases: new Map([["30000025", "T816"], ["T816", "T816"]]),
  routes: ["T816"],
};
const KL_EXTRA: PlannerFeedRoutes = {
  category: "rapid-bus-kl",
  aliases: new Map([["U7700", "770"], ["770", "770"]]),
  routes: ["770"],
};

test("planner extras merge into a followed category at 30 s", () => {
  const plan = buildRealtimePlan(
    ["T789"],
    [{ code: "T789", route_id: "30000026", category: "rapid-bus-mrtfeeder" }],
    new Map(),
    [FEEDER_EXTRA],
  );
  assert.equal(plan.feeds.length, 1);
  const [f] = plan.feeds;
  assert.equal(f.category, "rapid-bus-mrtfeeder");
  assert.equal(f.intervalMs, 30_000);
  assert.deepEqual([...f.routes], ["T789", "T816"]);
  assert.equal(f.aliases.get("T816"), "T816");
  assert.equal(f.aliases.get("T789"), "T789");
  assert.deepEqual(plan.plannerSkipped, []);
  assert.equal(requestsPerMinute(plan), 2);
  // The planner's bus is in the feed's positions; the poller keeps `positions` to followed routes.
  const positions = positionsFromFeed(
    f,
    feed([
      { id: "MINE", trip_id: "a", route_id: "T789" },
      { id: "PLAN", trip_id: "b", route_id: "T816 Inbound" },
      { id: "OTHER", trip_id: "c", route_id: "T815" },
    ]),
    NOW,
  );
  assert.deepEqual(positions.map((p) => [p.vehicleId, p.routeId]), [["MINE", "T789"], ["PLAN", "T816"]]);
});

test("planner-only category polls at 60 s when budget allows", () => {
  const plan = buildRealtimePlan(
    ["T789"],
    [{ code: "T789", route_id: "30000026", category: "rapid-bus-mrtfeeder" }],
    new Map(),
    [KL_EXTRA],
  );
  assert.deepEqual(plan.feeds.map((f) => [f.category, f.intervalMs]), [
    ["rapid-bus-mrtfeeder", 30_000],
    ["rapid-bus-kl", 60_000],
  ]);
  assert.deepEqual([...plan.feeds[1].routes], ["770"]);
  assert.deepEqual(plan.plannerSkipped, []);
  assert.equal(requestsPerMinute(plan), 3);
  // Rapid KL sends its GTFS route_id.
  const positions = positionsFromFeed(plan.feeds[1], feed([{ id: "WVH1", trip_id: "weekday_U7700_x_2", route_id: "U7700" }]), NOW);
  assert.deepEqual(positions.map((p) => p.routeId), ["770"]);

  // With nothing followed, both planner categories fit: 1 + 1 per minute.
  const only = buildRealtimePlan([], [], new Map(), [FEEDER_EXTRA, KL_EXTRA]);
  assert.deepEqual(only.feeds.map((f) => [f.category, f.intervalMs]), [
    ["rapid-bus-mrtfeeder", 60_000],
    ["rapid-bus-kl", 60_000],
  ]);
  assert.equal(requestsPerMinute(only), 2);
});

test("planner-only category goes to plannerSkipped when two followed categories use the budget", () => {
  const plan = buildRealtimePlan(
    ["T789", "400"],
    [
      { code: "T789", route_id: "30000026", category: "rapid-bus-mrtfeeder" },
      { code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" },
    ],
    new Map(),
    [FEEDER_EXTRA, KL_EXTRA],
  );
  // Both planner categories are followed ones: they ride along, nothing skipped.
  assert.deepEqual(plan.plannerSkipped, []);
  assert.equal(requestsPerMinute(plan), 4);

  const penangAndKl = buildRealtimePlan(
    ["401 Penang", "400"],
    [
      { code: "401 Penang", route_id: "pg:30000019", category: "rapid-bus-penang" },
      { code: "400", route_id: "kl:U4000", category: "rapid-bus-kl" },
    ],
    new Map(),
    [FEEDER_EXTRA, KL_EXTRA],
  );
  assert.deepEqual(penangAndKl.feeds.map((f) => f.category), ["rapid-bus-penang", "rapid-bus-kl"]);
  assert.deepEqual(penangAndKl.plannerSkipped, ["rapid-bus-mrtfeeder"]);
  assert.ok(requestsPerMinute(penangAndKl) <= 4);
  assert.ok(penangAndKl.feeds[1].routes.has("770"), "the followed KL feed still carries the planner's route");
});

test("one followed category leaves room for two planner categories", () => {
  const plan = buildRealtimePlan(
    ["401 Penang"],
    [{ code: "401 Penang", route_id: "pg:30000019", category: "rapid-bus-penang" }],
    new Map(),
    [FEEDER_EXTRA, KL_EXTRA],
  );
  // 2 (followed, 30 s) + 1 + 1 (planner-only, 60 s) = the whole budget of 4.
  assert.deepEqual(plan.feeds.map((f) => [f.category, f.intervalMs]), [
    ["rapid-bus-penang", 30_000],
    ["rapid-bus-mrtfeeder", 60_000],
    ["rapid-bus-kl", 60_000],
  ]);
  assert.deepEqual(plan.plannerSkipped, []);
  assert.equal(requestsPerMinute(plan), 4);
});

test("extra routes from the planner and Go merge per category", () => {
  const planner: PlannerFeedRoutes[] = [
    { category: "rapid-bus-mrtfeeder", aliases: new Map([["30000025", "T816"]]), routes: ["T816"] },
  ];
  const go: PlannerFeedRoutes[] = [
    { category: "rapid-bus-mrtfeeder", aliases: new Map([["30000025", "X"], ["T815", "T815"]]), routes: ["T815", "T816"] },
    { category: "rapid-bus-kl", aliases: new Map([["U7800", "780"]]), routes: ["780"] },
  ];
  const merged = mergeExtraRoutes([planner, go]);
  assert.deepEqual(merged.map((m) => m.category), ["rapid-bus-mrtfeeder", "rapid-bus-kl"]);
  assert.deepEqual(merged[0].routes, ["T816", "T815"]);
  // The first owner's alias for a key wins; the input is untouched.
  assert.equal(merged[0].aliases.get("30000025"), "T816");
  assert.equal(merged[0].aliases.get("T815"), "T815");
  assert.deepEqual(planner[0].routes, ["T816"]);
  // One owner clearing leaves the other's.
  assert.deepEqual(mergeExtraRoutes([[], go]).map((m) => m.routes), [["T815", "T816"], ["780"]]);
  assert.deepEqual(mergeExtraRoutes([[], []]), []);
});
