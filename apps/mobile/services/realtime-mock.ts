import type { VehiclePosition } from "@bus-tracker/shared";
import { openDb } from "@/db/database";
import { getRoutePolyline, getRoutes } from "@/db/queries";
import type { RealtimeSnapshot, RealtimeStore } from "./realtime";

const MOCK_ROUTE_CODE = "T816";
const MOCK_VEHICLE_ID = "MOCK-T816-01";
const MOCK_TRIP_ID = "MOCK-TRIP";
const TICK_MS = 5_000;
/** ~22 km/h average — matches real T816 speeds through PJ traffic. */
const ADVANCE_METERS_PER_TICK = 30;
const START_OFFSET_METERS = 2_500;

interface PolyPoint {
  lat: number;
  lng: number;
  cumMeters: number;
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function pointAtDistance(points: PolyPoint[], meters: number) {
  const total = points[points.length - 1]?.cumMeters ?? 0;
  const clamped = Math.max(0, Math.min(total, meters));
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].cumMeters < clamped) lo = mid + 1;
    else hi = mid;
  }
  const b = points[lo];
  const a = points[Math.max(0, lo - 1)];
  if (a === b) return { lat: b.lat, lng: b.lng };
  const span = b.cumMeters - a.cumMeters || 1;
  const t = (clamped - a.cumMeters) / span;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

export function createMockRealtimeStore(): RealtimeStore {
  let snapshot: RealtimeSnapshot = {
    positions: [],
    lastUpdated: null,
    lastError: null,
  };
  const listeners = new Set<() => void>();
  let refCount = 0;
  let points: PolyPoint[] = [];
  let cursor = 0;
  let lastPoint: { lat: number; lng: number } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Constant synthetic speed matching ADVANCE_METERS_PER_TICK / TICK_MS (m/s). */
  const MOCK_SPEED_MPS = ADVANCE_METERS_PER_TICK / (TICK_MS / 1000);

  async function loadRoute(): Promise<void> {
    try {
      const db = await openDb();
      const routes = await getRoutes(db);
      const route = routes.find((r) => r.code === MOCK_ROUTE_CODE);
      if (!route) {
        snapshot = {
          ...snapshot,
          lastError: new Error(
            `[mock] route ${MOCK_ROUTE_CODE} not cached — open the app once online first`,
          ),
        };
        notify();
        return;
      }
      const raw = await getRoutePolyline(db, route.route_id);
      if (raw.length < 2) {
        snapshot = {
          ...snapshot,
          lastError: new Error("[mock] polyline has <2 points"),
        };
        notify();
        return;
      }
      let cum = 0;
      points = raw.map((p, i) => {
        if (i > 0) cum += haversineMeters(raw[i - 1], p);
        return { lat: p.lat, lng: p.lng, cumMeters: cum };
      });
      const total = points[points.length - 1].cumMeters;
      cursor = Math.max(0, total - START_OFFSET_METERS);
    } catch (err) {
      snapshot = {
        ...snapshot,
        lastError: err instanceof Error ? err : new Error(String(err)),
      };
      notify();
    }
  }

  function notify(): void {
    for (const l of listeners) l();
  }

  function emit(): void {
    if (points.length === 0) return;
    const total = points[points.length - 1].cumMeters;
    const pt = pointAtDistance(points, cursor);
    const bearing =
      lastPoint != null ? bearingDeg(lastPoint, pt) : undefined;
    const position: VehiclePosition = {
      vehicleId: MOCK_VEHICLE_ID,
      tripId: MOCK_TRIP_ID,
      routeId: MOCK_ROUTE_CODE,
      lat: pt.lat,
      lng: pt.lng,
      bearing,
      speed: MOCK_SPEED_MPS,
      observedAt: Date.now(),
    };
    lastPoint = pt;
    snapshot = {
      positions: [position],
      lastUpdated: Date.now(),
      lastError: null,
    };
    notify();
    cursor += ADVANCE_METERS_PER_TICK;
    if (cursor > total) cursor = Math.max(0, total - START_OFFSET_METERS);
  }

  function startTicking(): void {
    void loadRoute().then(() => {
      emit();
      timer = setInterval(emit, TICK_MS);
    });
  }

  function stopTicking(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    start() {
      refCount += 1;
      if (refCount === 1) startTicking();
    },
    stop() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) stopTicking();
    },
    setFilter() {
      // no-op in mock mode
    },
    resetFilterState() {
      // no-op in mock mode
    },
    __forTests: {
      reset() {
        stopTicking();
        listeners.clear();
        refCount = 0;
        lastPoint = null;
        snapshot = { positions: [], lastUpdated: null, lastError: null };
      },
      refCount: () => refCount,
      tick: async () => emit(),
    },
  };
}

export const mockRealtimeStore: RealtimeStore = createMockRealtimeStore();
