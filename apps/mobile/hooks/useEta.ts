import {
  computeEta,
  type ComputeEtaResult,
  type EtaSource,
  type LatLng,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { openDb } from "@/db/database";
import {
  getRoutePolyline,
  getRoutes,
  getStops,
  type PolylinePoint,
  type StopRow,
} from "@/db/queries";
import { useBusPosition } from "@/hooks/useBusPosition";
import { fetchTrafficEta } from "@/services/trafficEta";

const TRAFFIC_REFRESH_MS = 30_000;
const STALE_AFTER_MS = 60_000;
const ROUTE_CODE = "T816";

export interface UseEtaResult {
  minutesToStop: number | null;
  isStale: boolean;
  source: EtaSource | null;
  vehicleId: string | null;
  lastComputedAt: number | null;
  error: Error | null;
}

interface StaticCtx {
  stop: LatLng;
  polyline: LatLng[];
  intermediateCandidates: LatLng[];
}

export function useEta({ stopId }: { stopId: string }): UseEtaResult {
  const { positions, error: rtError } = useBusPosition();

  const [staticCtx, setStaticCtx] = useState<StaticCtx | null>(null);
  const [staticError, setStaticError] = useState<Error | null>(null);
  const [trafficMinutes, setTrafficMinutes] = useState<number | null>(null);
  const [trafficError, setTrafficError] = useState<Error | null>(null);
  const [lastComputedAt, setLastComputedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const previousByVehicleRef = useRef(
    new Map<string, { lat: number; lng: number }>(),
  );
  const lastTrafficFetchRef = useRef<{ at: number; key: string } | null>(null);
  const trafficInflightRef = useRef<AbortController | null>(null);

  // 1. Load static data once per stopId.
  useEffect(() => {
    let cancelled = false;
    setStaticError(null);
    setStaticCtx(null);
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route =
          routes.find((r) => r.code === ROUTE_CODE) ?? routes[0] ?? null;
        if (!route) throw new Error(`no route ${ROUTE_CODE} in cache`);

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
  }, [stopId]);

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

  // 5. Fetch traffic ETA when the picked vehicle changes or ≥ 30s has passed.
  useEffect(() => {
    if (!composition || !composition.busProjection || !staticCtx) return;
    const busLat = composition.busProjection.projected.lat;
    const busLng = composition.busProjection.projected.lng;
    const key = [
      composition.vehicleId ?? "",
      busLat.toFixed(3),
      busLng.toFixed(3),
    ].join("|");

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
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        setTrafficMinutes(res.trafficMinutes);
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
  }, [composition?.vehicleId, composition?.busProjection?.projected.lat, composition?.busProjection?.projected.lng, composition, staticCtx, now]);

  // 6. When no approaching vehicle, clear stale traffic so we don't keep showing old minutes.
  useEffect(() => {
    if (composition && composition.vehicleId == null) {
      setTrafficMinutes(null);
      lastTrafficFetchRef.current = null;
    }
  }, [composition?.vehicleId, composition]);

  const error = staticError ?? trafficError ?? rtError;
  const isStale =
    lastComputedAt == null ? true : now - lastComputedAt > STALE_AFTER_MS;

  return {
    minutesToStop: composition?.minutesToStop ?? null,
    isStale,
    source: composition?.source ?? null,
    vehicleId: composition?.vehicleId ?? null,
    lastComputedAt,
    error,
  };
}
