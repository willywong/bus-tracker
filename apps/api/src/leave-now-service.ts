import {
  computeEta,
  decodeFeed,
  entitiesToPositions,
  shouldNotify,
  type LatLng,
  type RouteId,
  type T816Bundle,
  type TripRouteMap,
  type VehiclePosition,
} from "@bus-tracker/shared";

import type { Kv } from "./kv.js";
import { defaultKv } from "./kv.js";
import { GtfsBundleService, defaultService } from "./gtfs-service.js";
import { GtfsRealtimeService } from "./gtfs-realtime-service.js";
import { loadPushRegistration } from "./push-service.js";

const ROUTE_CODE: RouteId = "T816";
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const KL_TIME_ZONE = "Asia/Kuala_Lumpur";
/** Hard-floor quiet hours enforced regardless of user config (brief §8.5 safety valve). */
const HARD_QUIET_START_MIN = 0 * 60;
const HARD_QUIET_END_MIN = 5 * 60;
const LAST_SENT_KEY = "bt:leave-now:lastSentAt";

export type LeaveNowOutcome =
  | "no_registration"
  | "no_approaching_bus"
  | "below_threshold"
  | "quiet_hours"
  | "quiet_hours_safety_valve"
  | "within_dedupe_window"
  | "push_failed"
  | "sent";

export interface LeaveNowRunResult {
  outcome: LeaveNowOutcome;
  etaMinutes: number | null;
  now: number;
  /** Local minute-of-day at `now` in Asia/Kuala_Lumpur. */
  localMinuteOfDay: number;
  detail?: string;
}

export interface LeaveNowDeps {
  gtfs: GtfsBundleService;
  kv: Kv;
  fetchRealtime: (signal?: AbortSignal) => Promise<Uint8Array>;
  sendPush: (msg: ExpoPushMessage) => Promise<void>;
  now: () => number;
  localClock: (date: Date) => { hour: number; minute: number };
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
}

const defaultSendPush = async (msg: ExpoPushMessage): Promise<void> => {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(msg),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`expo push ${res.status}: ${text}`);
  }
};

// Reads through the same KV-cached proxy as /api/gtfs-realtime so the cron
// never adds to the upstream request budget on its own.
const defaultFetchRealtime =
  (kv: Kv) =>
  async (): Promise<Uint8Array> => {
    const { bytes } = await new GtfsRealtimeService({ kv }).getFeed();
    return bytes;
  };

const defaultLocalClock = (date: Date): { hour: number; minute: number } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  // `en-GB` + hour12:false renders midnight as "00" but some ICU builds emit "24" — normalise.
  const hour = Number.parseInt(hourStr, 10) % 24;
  const minute = Number.parseInt(minuteStr, 10);
  return { hour, minute };
};

export class LeaveNowService {
  private readonly deps: LeaveNowDeps;

  constructor(deps: Partial<LeaveNowDeps> = {}) {
    const kv = deps.kv ?? defaultKv();
    this.deps = {
      gtfs: deps.gtfs ?? defaultService,
      kv,
      fetchRealtime: deps.fetchRealtime ?? defaultFetchRealtime(kv),
      sendPush: deps.sendPush ?? defaultSendPush,
      now: deps.now ?? Date.now,
      localClock: deps.localClock ?? defaultLocalClock,
    };
  }

  async runOnce(): Promise<LeaveNowRunResult> {
    const now = this.deps.now();
    const localDate = new Date(now);
    const { hour, minute } = this.deps.localClock(localDate);
    const localMinuteOfDay = hour * 60 + minute;

    // Safety valve: never fire in the hard-coded middle-of-the-night window,
    // even if user config is broken or the clock drifts. (Task 04 requirement.)
    if (
      localMinuteOfDay >= HARD_QUIET_START_MIN &&
      localMinuteOfDay < HARD_QUIET_END_MIN
    ) {
      return {
        outcome: "quiet_hours_safety_valve",
        etaMinutes: null,
        now,
        localMinuteOfDay,
      };
    }

    const registration = await loadPushRegistration(this.deps.kv);
    if (!registration) {
      return {
        outcome: "no_registration",
        etaMinutes: null,
        now,
        localMinuteOfDay,
      };
    }

    const { bundle } = await this.deps.gtfs.getBundle();
    const stop = findStop(bundle, registration.settings.preferredStopId);
    const polyline = findPolyline(bundle, ROUTE_CODE);
    const tripMap = buildTripMap(bundle);
    const feedBytes = await this.deps.fetchRealtime();
    const feed = decodeFeed(feedBytes);
    const positions = entitiesToPositions(feed, tripMap, now);
    const intermediateCandidates = otherStops(bundle, stop);

    const eta = computeEta({
      vehicles: positions,
      stop,
      polyline,
      intermediateCandidates,
      loop: true,
    });
    if (eta.minutesToStop == null) {
      return {
        outcome: "no_approaching_bus",
        etaMinutes: null,
        now,
        localMinuteOfDay,
      };
    }

    const fire = shouldNotify({
      etaMinutes: eta.minutesToStop,
      walkMinutes: registration.settings.walkMinutes,
      bufferMinutes: registration.settings.notifBufferMin,
      now: localMinuteOfDay,
      quietStartMin: registration.settings.quietStartMin,
      quietEndMin: registration.settings.quietEndMin,
    });

    if (!fire) {
      const threshold =
        registration.settings.walkMinutes +
        registration.settings.notifBufferMin;
      const outcome: LeaveNowOutcome =
        eta.minutesToStop > threshold ? "below_threshold" : "quiet_hours";
      return {
        outcome,
        etaMinutes: eta.minutesToStop,
        now,
        localMinuteOfDay,
      };
    }

    const lastSentAt = (await this.deps.kv.get<number>(LAST_SENT_KEY)) ?? 0;
    if (now - lastSentAt < DEDUPE_WINDOW_MS) {
      return {
        outcome: "within_dedupe_window",
        etaMinutes: eta.minutesToStop,
        now,
        localMinuteOfDay,
      };
    }

    try {
      await this.deps.sendPush({
        to: registration.token,
        title: "T816 bus",
        body: `Leave now — bus in ${Math.round(eta.minutesToStop)} min`,
        sound: "default",
        data: {
          type: "leave-now",
          etaMinutes: eta.minutesToStop,
          at: now,
        },
      });
    } catch (err) {
      return {
        outcome: "push_failed",
        etaMinutes: eta.minutesToStop,
        now,
        localMinuteOfDay,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    await this.deps.kv.set(LAST_SENT_KEY, now);
    return {
      outcome: "sent",
      etaMinutes: eta.minutesToStop,
      now,
      localMinuteOfDay,
    };
  }
}

function findStop(bundle: T816Bundle, stopId: string): LatLng & { id: string } {
  const stop = bundle.stops.find((s) => s.stop_id === stopId);
  if (!stop) {
    throw new Error(`stop ${stopId} not in bundle (route data stale?)`);
  }
  return { lat: stop.stop_lat, lng: stop.stop_lon, id: stop.stop_id };
}

function findPolyline(bundle: T816Bundle, routeCode: RouteId): LatLng[] {
  const route = bundle.routes.find((r) => r.code === routeCode);
  if (!route) throw new Error(`route ${routeCode} not in bundle`);
  const shapeIds = new Set<string>();
  for (const t of bundle.trips) {
    if (t.route_id !== route.route_id) continue;
    if (typeof t.shape_id === "string" && t.shape_id.length > 0) {
      shapeIds.add(t.shape_id);
    }
  }
  let best: { lat: number; lng: number; seq: number }[] | null = null;
  for (const id of shapeIds) {
    const pts = bundle.shapes[id];
    if (!pts) continue;
    if (!best || pts.length > best.length) best = pts;
  }
  if (!best || best.length < 2) {
    throw new Error(`no polyline for ${routeCode}`);
  }
  return best.map((p) => ({ lat: p.lat, lng: p.lng }));
}

function buildTripMap(bundle: T816Bundle): TripRouteMap {
  const routesById = new Map<string, RouteId>();
  for (const r of bundle.routes) {
    routesById.set(r.route_id, r.code as RouteId);
  }
  const map = new Map<string, RouteId>();
  for (const t of bundle.trips) {
    const code = routesById.get(t.route_id);
    if (code) map.set(t.trip_id, code);
  }
  return map;
}

function otherStops(bundle: T816Bundle, preferred: LatLng): LatLng[] {
  const out: LatLng[] = [];
  for (const s of bundle.stops) {
    if (s.stop_lat === preferred.lat && s.stop_lon === preferred.lng) continue;
    out.push({ lat: s.stop_lat, lng: s.stop_lon });
  }
  return out;
}

export const LAST_SENT_AT_KEY = LAST_SENT_KEY;
