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
import {
  TrafficEtaService,
  type TrafficEtaResult,
} from "../traffic-service.js";

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
 * B is an intermediate candidate), one trip referencing shape s1, and a 3-point
 * polyline roughly 1km long.
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
      ],
    },
    calendar: [],
  };
}

function encodeFeed(vehicleLat: number, vehicleLng: number): Uint8Array {
  const FeedMessage = getFeedMessage();
  const payload = {
    header: { gtfs_realtime_version: "2.0", timestamp: 1_700_000_010 },
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
          timestamp: 1_700_000_010,
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

function stubTraffic(minutes: number | null): TrafficEtaService {
  return {
    async getEta() {
      if (minutes == null) throw new Error("traffic unavailable");
      const result: TrafficEtaResult = {
        trafficMinutes: minutes,
        source: "here",
        generatedAt: 0,
      };
      return { result, cached: false };
    },
  } as unknown as TrafficEtaService;
}

interface Harness {
  kv: Kv;
  service: LeaveNowService;
  sent: ExpoPushMessage[];
}

async function makeHarness(opts: {
  trafficMinutes: number | null;
  nowMs: number;
  localHour: number;
  localMinute: number;
  vehicleLat: number;
  vehicleLng: number;
  registered?: boolean;
}): Promise<Harness> {
  const kv = createInMemoryKv();
  if (opts.registered !== false) {
    await kv.set(PRIMARY_KEY, REGISTRATION);
  }

  const sent: ExpoPushMessage[] = [];
  const service = new LeaveNowService({
    gtfs: stubGtfs(syntheticBundle()),
    traffic: stubTraffic(opts.trafficMinutes),
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

const NOON_MS = new Date("2026-04-21T12:00:00+08:00").getTime();

test("leave-now: sends push when traffic ETA within threshold outside quiet hours", async () => {
  const { service, sent, kv } = await makeHarness({
    trafficMinutes: 6,
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
    trafficMinutes: 6,
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
    trafficMinutes: 6,
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
    trafficMinutes: 25,
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
    trafficMinutes: 6,
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
    trafficMinutes: 6,
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
    trafficMinutes: 6,
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
    trafficMinutes: 6,
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
