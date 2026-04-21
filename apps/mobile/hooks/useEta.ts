import {
  computeEta,
  pickApproachingVehicle,
  type ComputeEtaResult,
  type EtaSource,
  type LatLng,
  type RouteId,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import {
  getRoutePolyline,
  getRoutes,
  getStops,
  type PolylinePoint,
  type StopRow,
} from "@/db/queries";
import { useBusPosition } from "@/hooks/useBusPosition";
import { fetchTrafficEta, type TrafficProvider } from "@/services/trafficEta";

const TRAFFIC_REFRESH_MS = 30_000;
const STALE_AFTER_MS = 60_000;
/** Rough bus speed used to project a "next vehicle" ETA when we don't hit /traffic-eta for the second bus. */
const FALLBACK_BUS_METERS_PER_MINUTE = 20_000 / 60;

export interface ApproachingBus {
  minutesToStop: number | null;
  vehicleId: string;
  forwardMeters: number;
  source: EtaSource | null;
}

export interface UseEtaResult {
  minutesToStop: number | null;
  isStale: boolean;
  source: EtaSource | null;
  /** Traffic provider that produced the most recent traffic minutes, or null if ETA is schedule-based. */
  trafficSource: TrafficProvider | null;
  vehicleId: string | null;
  lastComputedAt: number | null;
  /** Combined error (static load, traffic fetch, or realtime feed). */
  error: Error | null;
  /** Just the traffic-API error, separated so callers can distinguish a degraded ETA from a fatal load. */
  trafficError: Error | null;
  /** The closest approaching bus with its traffic-adjusted ETA (same as top-level fields). */
  current: ApproachingBus | null;
  /** The second-closest approaching bus, with a rough distance-based ETA (no traffic call). */
  next: ApproachingBus | null;
}

interface StaticCtx {
  stop: LatLng;
  polyline: LatLng[];
  intermediateCandidates: LatLng[];
}

export function useEta({
  stopId,
  routeCode,
  trafficProvider,
}: {
  stopId: string;
  routeCode: RouteId;
  trafficProvider?: TrafficProvider;
}): UseEtaResult {
  const { positions, error: rtError } = useBusPosition({ routeCode });

  const [staticCtx, setStaticCtx] = useState<StaticCtx | null>(null);
  const [staticError, setStaticError] = useState<Error | null>(null);
  const [trafficMinutes, setTrafficMinutes] = useState<number | null>(null);
  const [trafficSource, setTrafficSource] = useState<TrafficProvider | null>(
    null,
  );
  const [trafficError, setTrafficError] = useState<Error | null>(null);
  const [lastComputedAt, setLastComputedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const previousByVehicleRef = useRef(
    new Map<string, { lat: number; lng: number }>(),
  );
  const lastTrafficFetchRef = useRef<{ at: number; key: string } | null>(null);
  const trafficInflightRef = useRef<AbortController | null>(null);
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active",
  );

  // Pause the traffic-ETA poll when the app isn't foregrounded — the biggest
  // single source of wasted HERE transactions is an app left open on a desk.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      setAppActive(status === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  // 1. Load static data once per (stopId, routeCode).
  useEffect(() => {
    let cancelled = false;
    setStaticError(null);
    setStaticCtx(null);
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route =
          routes.find((r) => r.code === routeCode) ?? routes[0] ?? null;
        if (!route) throw new Error(`no route ${routeCode} in cache`);

        const stop = stops.find((s: StopRow) => s.stop_id === stopId);
        if (!stop) throw new Error(`stop ${stopId} not found in cache`);

        const polyPoints = await getRoutePolyline(db, route.route_id);
        if (polyPoints.length < 2) {
          throw new Error(`polyline for route ${route.route_id} is empty`);
        }

        if (cancelled) return;
        const polyline: LatLng[] = polyPoints.map((p: PolylinePoint) => ({
          lat: p.lat,
          lng: p.lng,
        }));
        const intermediateCandidates: LatLng[] = stops
          .filter((s) => s.stop_id !== stopId)
          .map((s) => ({ lat: s.stop_lat, lng: s.stop_lon }));

        setStaticCtx({
          stop: { lat: stop.stop_lat, lng: stop.stop_lon },
          polyline,
          intermediateCandidates,
        });
      } catch (err) {
        if (cancelled) return;
        setStaticError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stopId, routeCode]);

  // 2. Drive `now` forward every 15s so `isStale` stays current.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // 3. Maintain `previousByVehicleId` map whenever live positions change.
  useEffect(() => {
    const map = previousByVehicleRef.current;
    for (const p of positions) {
      map.set(p.vehicleId, { lat: p.lat, lng: p.lng });
    }
  }, [positions]);

  // 4. Compose the ETA result without triggering a network call — that's step 5.
  const composition: ComputeEtaResult | null = useMemo(() => {
    if (!staticCtx) return null;
    return computeEta({
      vehicles: positions as VehiclePosition[],
      previousByVehicleId: previousByVehicleRef.current,
      stop: staticCtx.stop,
      polyline: staticCtx.polyline,
      intermediateCandidates: staticCtx.intermediateCandidates,
      trafficMinutes,
      loop: true,
    });
  }, [staticCtx, positions, trafficMinutes]);

  // 4b. Pick the second-closest approaching vehicle for the "Next" row.
  const nextBus: ApproachingBus | null = useMemo(() => {
    if (!staticCtx || !composition?.vehicleId) return null;
    const picked = pickApproachingVehicle({
      vehicles: (positions as VehiclePosition[]).filter(
        (v) => v.vehicleId !== composition.vehicleId,
      ),
      previousByVehicleId: previousByVehicleRef.current,
      stop: staticCtx.stop,
      polyline: staticCtx.polyline,
      loop: true,
    });
    if (!picked) return null;
    const minutes = Math.round(
      picked.evaluation.forwardMeters / FALLBACK_BUS_METERS_PER_MINUTE,
    );
    return {
      minutesToStop: Math.max(0, minutes),
      vehicleId: picked.vehicle.vehicleId,
      forwardMeters: picked.evaluation.forwardMeters,
      source: null,
    };
  }, [staticCtx, positions, composition?.vehicleId]);

  // 5. Fetch traffic ETA when the picked vehicle changes or ≥ 30s has passed.
  //    Key is intentionally coarse (vehicleId + provider only) — the server
  //    already caches per-coordinate for 60s, and the 30s floor below is what
  //    really throttles us. Including lat/lng here just forced an early
  //    refetch every time the bus moved, defeating the purpose of the floor.
  useEffect(() => {
    if (!appActive) return;
    if (!composition || !composition.busProjection || !staticCtx) return;
    const busLat = composition.busProjection.projected.lat;
    const busLng = composition.busProjection.projected.lng;
    const key = [composition.vehicleId ?? "", trafficProvider ?? ""].join("|");

    const last = lastTrafficFetchRef.current;
    const fresh = last && last.key === key && now - last.at < TRAFFIC_REFRESH_MS;
    if (fresh) return;

    trafficInflightRef.current?.abort();
    const ctrl = new AbortController();
    trafficInflightRef.current = ctrl;
    lastTrafficFetchRef.current = { at: Date.now(), key };

    (async () => {
      try {
        const res = await fetchTrafficEta(
          { lat: busLat, lng: busLng },
          staticCtx.stop,
          { signal: ctrl.signal, provider: trafficProvider },
        );
        if (ctrl.signal.aborted) return;
        setTrafficMinutes(res.trafficMinutes);
        setTrafficSource(res.source);
        setTrafficError(null);
        setLastComputedAt(Date.now());
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setTrafficError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [composition?.vehicleId, composition, staticCtx, now, trafficProvider, appActive]);

  // 6. When no approaching vehicle, clear stale traffic so we don't keep showing old minutes.
  useEffect(() => {
    if (composition && composition.vehicleId == null) {
      setTrafficMinutes(null);
      setTrafficSource(null);
      lastTrafficFetchRef.current = null;
    }
  }, [composition?.vehicleId, composition]);

  // 6b. Clear cached traffic minutes when the provider changes so the next render
  //     falls back to schedule-based ETA until the new provider replies.
  useEffect(() => {
    setTrafficMinutes(null);
    setTrafficSource(null);
    lastTrafficFetchRef.current = null;
  }, [trafficProvider]);

  const error = staticError ?? trafficError ?? rtError;
  const isStale =
    lastComputedAt == null ? true : now - lastComputedAt > STALE_AFTER_MS;

  const roundedMinutes =
    composition?.minutesToStop != null
      ? Math.round(composition.minutesToStop)
      : null;

  const current: ApproachingBus | null =
    composition?.vehicleId != null && composition.forwardMeters != null
      ? {
          minutesToStop: roundedMinutes,
          vehicleId: composition.vehicleId,
          forwardMeters: composition.forwardMeters,
          source: composition.source,
        }
      : null;

  return {
    minutesToStop: roundedMinutes,
    isStale,
    source: composition?.source ?? null,
    trafficSource: composition?.source === "traffic" ? trafficSource : null,
    vehicleId: composition?.vehicleId ?? null,
    lastComputedAt,
    error,
    trafficError,
    current,
    next: nextBus,
  };
}
