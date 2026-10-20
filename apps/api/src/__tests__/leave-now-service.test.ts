import assert from "node:assert/strict";
import test from "node:test";
import { getFeedMessage, type T816Bundle } from "@bus-tracker/shared";
import { GtfsBundleService } from "../gtfs-service.js";
import { createInMemoryKv, type Kv } from "../kv.js";
import {
  LAST_SENT_AT_KEY,
  LeaveNowService,
  type ExpoPushMessage,
} from "../leave-now-service.js";
import {
  PRIMARY_KEY,
  type PushRegistration,
} from "../push-service.js";

const REGISTRATION: PushRegistration = {
  deviceId: "device-abc",
  token: "ExponentPushToken[xxxxxxxxxxxxxxxxxx]",
  settings: {
    walkMinutes: 10,
    notifBufferMin: 1,
    preferredStopId: "STOP_A",
    quietStartMin: 22 * 60,
    quietEndMin: 6 * 60,
  },
  registeredAt: 1_700_000_000_000,
};

/**
 * Minimal T816 bundle: one route (r1 / T816), two stops (A is preferred,
 * B is an intermediate candidate), one trip referencing shape s1, and a
 * north-running polyline ~3km long. The route is treated as a loop, so it has
 * to be long enough that a bus ~0.7km south of stop A sits on the approach
 * side (less than half the loop away).
 */
function syntheticBundle(): T816Bundle {
  return {
    generatedAt: 1_700_000_000_000,
    routes: [{ route_id: "r1", code: "T816", long_name: "T816 loop" }],
    stops: [
      {
        stop_id: "STOP_A",
        stop_name: "Hotel Lisa De Inn",
        stop_lat: 3.107,
        stop_lon: 101.612,
      },
      {
        stop_id: "STOP_B",
        stop_name: "PJ210",
        stop_lat: 3.104,
        stop_lon: 101.612,
      },
    ],
    trips: [
      { route_id: "r1", service_id: "wd", trip_id: "trip-1", shape_id: "s1" },
    ],
    stopTimes: [],
    shapes: {
      s1: [
        { lat: 3.100, lng: 101.612, seq: 0 },
        { lat: 3.105, lng: 101.612, seq: 1 },
        { lat: 3.110, lng: 101.612, seq: 2 },
        { lat: 3.120, lng: 101.612, seq: 3 },
        { lat: 3.130, lng: 101.612, seq: 4 },
      ],
    },
    calendar: [],
  };
}

const NOON_MS = new Date("2026-04-21T12:00:00+08:00").getTime();
/** A fix 10 s old at NOON_MS — fixes outside "now" are dropped as implausible. */
const FIX_TIMESTAMP_S = Math.floor(NOON_MS / 1000) - 10;

function encodeFeed(vehicleLat: number, vehicleLng: number): Uint8Array {
  const FeedMessage = getFeedMessage();
  const payload = {
    header: { gtfs_realtime_version: "2.0", timestamp: FIX_TIMESTAMP_S },
    entity: [
      {
        id: "v1",
        vehicle: {
          trip: { trip_id: "trip-1" },
          vehicle: { id: "bus-1" },
          position: {
            latitude: vehicleLat,
            longitude: vehicleLng,
            bearing: 0,
          },
          timestamp: FIX_TIMESTAMP_S,
        },
      },
    ],
  };
  const err = FeedMessage.verify(payload);
  if (err) throw new Error(`invalid test payload: ${err}`);
  const msg = FeedMessage.create(payload);
  return FeedMessage.encode(msg).finish();
}

function stubGtfs(bundle: T816Bundle): GtfsBundleService {
  return {
    async getBundle() {
      return { bundle, cached: true };
    },
  } as unknown as GtfsBundleService;
}

interface Harness {
  kv: Kv;
  service: LeaveNowService;
  sent: ExpoPushMessage[];
}

async function makeHarness(opts: {
  /** Overrides the registration's walk time (default 10 min + 1 min buffer). */
  walkMinutes?: number;
  nowMs: number;
  localHour: number;
  localMinute: number;
  vehicleLat: number;
  vehicleLng: number;
  registered?: boolean;
}): Promise<Harness> {
  const kv = createInMemoryKv();
  if (opts.registered !== false) {
    await kv.set(PRIMARY_KEY, {
      ...REGISTRATION,
      settings: {
        ...REGISTRATION.settings,
        walkMinutes: opts.walkMinutes ?? REGISTRATION.settings.walkMinutes,
      },
    });
  }

  const sent: ExpoPushMessage[] = [];
  const service = new LeaveNowService({
    gtfs: stubGtfs(syntheticBundle()),
    kv,
    fetchRealtime: async () => encodeFeed(opts.vehicleLat, opts.vehicleLng),
    sendPush: async (msg) => {
      sent.push(msg);
    },
    now: () => opts.nowMs,
    localClock: () => ({ hour: opts.localHour, minute: opts.localMinute }),
  });
  return { kv, service, sent };
}



test("leave-now: sends push when live ETA within threshold outside quiet hours", async () => {
  const { service, sent, kv } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    vehicleLat: 3.101, // south of preferred stop → approaching
    vehicleLng: 101.612,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /^Leave now — bus in \d+ min$/);
  assert.equal(sent[0].to, REGISTRATION.token);

  const lastSent = await kv.get<number>(LAST_SENT_AT_KEY);
  assert.equal(lastSent, NOON_MS);
});

test("leave-now: dedupes within 15 minutes", async () => {
  const { service, sent, kv } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
  });

  await kv.set(LAST_SENT_AT_KEY, NOON_MS - 5 * 60 * 1000);
  const result = await service.runOnce();
  assert.equal(result.outcome, "within_dedupe_window");
  assert.equal(sent.length, 0);
});

test("leave-now: allows second send once dedupe window has elapsed", async () => {
  const { service, sent, kv } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
  });

  await kv.set(LAST_SENT_AT_KEY, NOON_MS - 16 * 60 * 1000);
  const result = await service.runOnce();
  assert.equal(result.outcome, "sent");
  assert.equal(sent.length, 1);
});

test("leave-now: stays quiet when ETA exceeds walk + buffer", async () => {
  const { service, sent } = await makeHarness({
    // Bus is ~0.7 km out (≈3 min incl. one stop's dwell) — more than 0 + 1 min.
    walkMinutes: 0,
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "below_threshold");
  assert.equal(sent.length, 0);
});

test("leave-now: no registration yields no_registration", async () => {
  const { service, sent } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
    registered: false,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "no_registration");
  assert.equal(sent.length, 0);
});

test("leave-now: hard safety valve blocks 03:00 local even with safe settings", async () => {
  const { service, sent } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 3,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "quiet_hours_safety_valve");
  assert.equal(sent.length, 0);
});

test("leave-now: user quiet hours suppress push inside window", async () => {
  // 23:00 local is inside the default 22:00–06:00 window.
  // Use a different harness with local time only just past the hard floor.
  const { service, sent } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 23,
    localMinute: 0,
    vehicleLat: 3.101,
    vehicleLng: 101.612,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "quiet_hours");
  assert.equal(sent.length, 0);
});

test("leave-now: no approaching bus yields no_approaching_bus", async () => {
  const { service, sent } = await makeHarness({
    nowMs: NOON_MS,
    localHour: 12,
    localMinute: 0,
    // Vehicle past the preferred stop and heading further → not approaching
    vehicleLat: 3.115,
    vehicleLng: 101.612,
  });

  const result = await service.runOnce();
  assert.equal(result.outcome, "no_approaching_bus");
  assert.equal(sent.length, 0);
});
