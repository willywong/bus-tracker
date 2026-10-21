import {
  computeEta,
  countIntermediateStops,
  estimateLiveMinutes,
  evaluateApproach,
  getMotionStatus,
  haversineMeters,
  projectOntoRoute,
  type LatLng,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { useEffect, useMemo, useState } from 'react';

import {
  buildBusDetail,
  buildStopDetail,
  type DetailModel,
} from '@/components/detail/model';
import { formatStopName } from '@/components/map/format';
import { formatClockHHMM } from '@/components/tracker/logic';
import { openDb } from '@/db/database';
import {
  getLiveTripHeadsign,
  getRoutesServingStop,
  getStopById,
  type ScheduledDeparture,
  type StopRow,
} from '@/db/queries';
import { useJourneyStops, type JourneyData } from '@/hooks/useJourneyStops';
import { useScheduledDepartures } from '@/hooks/useScheduledDepartures';
import { useTrip } from '@/state/TripContext';

export interface StopDetail {
  model: DetailModel;
  stop: StopRow | null;
  departures: ScheduledDeparture[];
  otherRoutes: string[];
}

/** Everything the stop sheet shows, for a stop on the active route. */
export function useStopDetail(stopId: string): StopDetail {
  const trip = useTrip();
  const route = trip.route;
  const routeCode = trip.routeCode;

  const fromRoute = route?.stops.find((s) => s.stop_id === stopId) ?? null;
  const [loaded, setLoaded] = useState<{ stop: StopRow | null; routes: string[] }>({
    stop: null,
    routes: [],
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await openDb();
      const [stop, routes] = await Promise.all([
        fromRoute ? Promise.resolve(fromRoute) : getStopById(db, stopId),
        getRoutesServingStop(db, stopId),
      ]);
      if (!cancelled) setLoaded({ stop, routes: routes.map((r) => r.code) });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stopId, fromRoute]);
  const stop = fromRoute ?? loaded.stop;
  const otherRoutes = loaded.routes.filter((c) => c !== routeCode);

  const sched = useScheduledDepartures({ stopId, routeCode, limit: 8 });

  // The nearest live bus approaching *this* stop, by the same pipeline as
  // the trip's own ETA.
  const live = useMemo(() => {
    if (!route || !stop || route.polyline.length < 2) return null;
    const point: LatLng = { lat: stop.stop_lat, lng: stop.stop_lon };
    const others = route.stops
      .filter((s) => s.stop_id !== stopId)
      .map((s) => ({ lat: s.stop_lat, lng: s.stop_lon }));
    const eta = computeEta({
      vehicles: trip.bus.positions as VehiclePosition[],
      stop: point,
      polyline: route.polyline,
      intermediateCandidates: others,
      loop: true,
    });
    if (eta.minutesToStop == null || !eta.busProjection) return null;
    const stopsAway = countIntermediateStops({
      bus: eta.busProjection,
      stop: eta.stopProjection,
      intermediateCandidates: others,
      polyline: route.polyline,
      loop: true,
    });
    return { minutes: eta.minutesToStop, stopsAway };
  }, [route, stop, stopId, trip.bus.positions]);

  const model = useMemo(() => {
    const ids = route?.stops.map((s) => s.stop_id) ?? [];
    const index = ids.indexOf(stopId);
    const userIndex = ids.indexOf(trip.stopId);
    return buildStopDetail({
      stopName: stop ? formatStopName(stop.stop_name) : 'Stop',
      routeCode,
      stopIndex: index >= 0 ? index : null,
      userStopIndex: userIndex >= 0 ? userIndex : null,
      stopCount: ids.length,
      live,
      scheduled: sched.upcoming.map((d) => d.departureEpochMs),
      now: trip.now,
      formatClock: formatClockHHMM,
      otherRoutes,
      wheelchair: stop?.wheelchair_boarding ?? null,
    });
  }, [route, stop, stopId, trip.stopId, routeCode, live, sched.upcoming, trip.now, otherRoutes]);

  return { model, stop, departures: sched.upcoming, otherRoutes };
}

export interface BusDetail {
  model: DetailModel;
  vehicle: VehiclePosition | null;
  /** Its stops from here to yours, for the timeline; not ready once passed. */
  journey: JourneyData;
}

/** Everything the bus sheet shows, for a live bus on the active route. */
export function useBusDetail(vehicleId: string): BusDetail {
  const trip = useTrip();
  const route = trip.route;
  const routeCode = trip.routeCode;

  // Keep the last fix so the sheet can say "stopped reporting" instead of
  // going blank when the bus drops out of the feed.
  const current =
    (trip.bus.positions.find((p) => p.vehicleId === vehicleId) as VehiclePosition | undefined) ??
    null;
  const [lastSeen, setLastSeen] = useState<VehiclePosition | null>(current);
  useEffect(() => {
    if (current) setLastSeen(current);
  }, [current]);
  const vehicle = current ?? lastSeen;

  const [headsign, setHeadsign] = useState<string | null>(null);
  const tripId = vehicle?.tripId ?? null;
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    openDb()
      .then((db) => getLiveTripHeadsign(db, tripId, routeCode))
      .then((h) => {
        if (!cancelled) setHeadsign(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId, routeCode]);

  const passed = trip.eta.passedVehicleIds.has(vehicleId);

  const derived = useMemo(() => {
    if (!vehicle || !route || route.polyline.length < 2) {
      return { toYourStop: null, nearStopName: null, motionLabel: null };
    }
    const position = { lat: vehicle.lat, lng: vehicle.lng };
    let nearest: StopRow | null = null;
    let best = Infinity;
    for (const s of route.stops) {
      const d = haversineMeters(position, { lat: s.stop_lat, lng: s.stop_lon });
      if (d < best) {
        best = d;
        nearest = s;
      }
    }
    const status = getMotionStatus({
      speedKmh: vehicle.speed,
      position,
      signals: route.signals,
    });
    const motionLabel = status && status.kind !== 'moving' ? status.label : null;

    const user = route.userStop;
    let toYourStop: { minutes: number; stopsAway: number | null; meters: number } | null = null;
    if (user) {
      const stopPoint = { lat: user.stop_lat, lng: user.stop_lon };
      const evaluation = evaluateApproach({
        bus: vehicle,
        stop: stopPoint,
        polyline: route.polyline,
        loop: true,
      });
      if (evaluation.verdict === 'approaching') {
        const others = route.stops
          .filter((s) => s.stop_id !== user.stop_id)
          .map((s) => ({ lat: s.stop_lat, lng: s.stop_lon }));
        const busProj = projectOntoRoute(position, route.polyline);
        const stopProj = projectOntoRoute(stopPoint, route.polyline);
        const minutes = estimateLiveMinutes({
          bus: busProj,
          stop: stopProj,
          forwardMeters: evaluation.forwardMeters,
          intermediateCandidates: others,
          polyline: route.polyline,
          loop: true,
        });
        const stopsAway = countIntermediateStops({
          bus: busProj,
          stop: stopProj,
          intermediateCandidates: others,
          polyline: route.polyline,
          loop: true,
        });
        toYourStop = { minutes, stopsAway, meters: evaluation.forwardMeters };
      }
    }
    return {
      toYourStop,
      nearStopName: nearest ? formatStopName(nearest.stop_name) : null,
      motionLabel,
    };
  }, [vehicle, route]);

  const journey = useJourneyStops({
    routeCode,
    stopId: trip.stopId,
    tripId: !passed ? (vehicle?.tripId ?? null) : null,
    currentStopSequence: vehicle?.currentStopSequence ?? null,
    currentStopId: vehicle?.currentStopId ?? null,
    busLat: !passed ? (vehicle?.lat ?? null) : null,
    busLng: !passed ? (vehicle?.lng ?? null) : null,
  });

  const model = useMemo(
    () =>
      buildBusDetail({
        routeCode,
        headsign: headsign ? formatStopName(headsign) : null,
        reporting: current != null,
        isYourBus: trip.eta.primaryArrival?.live?.vehicleId === vehicleId,
        speedKmh: vehicle?.speed ?? null,
        motionLabel: derived.motionLabel,
        observedAt: vehicle?.observedAt ?? null,
        now: Date.now(),
        formatClock: formatClockHHMM,
        nearStopName: derived.nearStopName,
        toYourStop: derived.toYourStop,
        passed,
        yourStopName: trip.stopName,
      }),
    [routeCode, headsign, current, trip.eta.primaryArrival, vehicleId, vehicle, derived, passed, trip.stopName],
  );

  return { model, vehicle, journey };
}
