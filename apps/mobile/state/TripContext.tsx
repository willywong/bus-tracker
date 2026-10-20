import { getMotionStatus, type LatLng } from '@bus-tracker/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { formatStopName } from '@/components/map/format';
import { formatClockHHMM } from '@/components/tracker/logic';
import {
  buildTripModel,
  type ArrivalLike,
  type TripModel,
} from '@/components/trip/model';
import { openDb } from '@/db/database';
import {
  getRoutePolyline,
  getRoutes,
  getStops,
  getStopsForRouteOrdered,
  getTrafficSignals,
  type StopRow,
} from '@/db/queries';
import { useBusLiveActivity } from '@/hooks/useBusLiveActivity';
import { useBusPosition, type UseBusPositionResult } from '@/hooks/useBusPosition';
import { useEta, type UseEtaResult } from '@/hooks/useEta';
import { useJourneyStops, type JourneyData } from '@/hooks/useJourneyStops';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { useRainNudge, useTripSideEffects } from '@/hooks/useTripSideEffects';
import { useWalkTimer, type UseWalkTimerResult } from '@/hooks/useWalkTimer';
import { SHEET_INITIAL_DETENT, type DetentIndex } from '@/theme/design';
import { devNow } from '@/utils/devClock';
import { ensureNotificationPermission } from '@/services/reminders/notifications';
import type { RainNudge } from '@/services/weather';
import { haptics } from '@/utils/haptics';

/** Static geometry + names for the active route, loaded from SQLite. */
export interface RouteStatic {
  routeCode: string;
  stopId: string;
  longName: string | null;
  polyline: LatLng[];
  stops: StopRow[];
  stopsById: ReadonlyMap<string, LatLng>;
  userStop: StopRow | null;
  signals: { id: number; lat: number; lng: number }[];
}

export interface TripContextValue {
  hasFavorites: boolean;
  routeCode: string;
  stopId: string;
  stopName: string | null;
  route: RouteStatic | null;
  eta: UseEtaResult;
  bus: UseBusPositionResult;
  journey: JourneyData;
  walk: UseWalkTimerResult;
  model: TripModel;
  /** The active route's timetable failed to download. */
  routeLoadFailed: boolean;
  retryRouteLoad: () => void;
  now: number;
  isFollowing: boolean;
  follow: () => void;
  unfollow: () => void;
  startWalking: () => void;
  cancelWalking: () => void;
  /** MET Malaysia rain/flood nudge for the stop's area, when there is one. */
  rainNudge: RainNudge | null;
  /** Boarding-stop coordinates of every favourite (arrival geofences). */
  favoriteStops: { routeCode: string; stopId: string; lat: number; lng: number }[];
  /** Notify ~10 min before leaving for today's last bus. */
  lastBusReminder: boolean;
  setLastBusReminder: (on: boolean) => void;
  /** Current trip sheet detent (0 peek · 1 glance · 2 large). */
  detent: DetentIndex;
  setDetent: (d: DetentIndex) => void;
}

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const gtfs = useStaticGtfs();
  const routeCode = settings.preferredRouteCode ?? '';
  const stopId = settings.preferredStopId;
  const hasFavorites = settings.favoritedRoutes.length > 0;

  const eta = useEta({ stopId, routeCode });
  const bus = useBusPosition({ routeCode: routeCode || undefined });
  const route = useRouteStatic(routeCode, stopId, [
    gtfs.ready,
    gtfs.result,
    gtfs.lastSettledAt,
  ]);
  const walk = useWalkTimer(settings.walkMinutes);

  const [now, setNow] = useState(() => devNow());
  useEffect(() => {
    const t = setInterval(() => setNow(devNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  const [detent, setDetent] = useState<DetentIndex>(SHEET_INITIAL_DETENT);
  const [isFollowing, setIsFollowing] = useState(false);
  // A notification tap can switch route *and* follow; remember which route.
  const pendingFollow = useRef<string | null>(null);
  // A new route or stop is a new trip — stop following the old one.
  useEffect(() => {
    setIsFollowing(pendingFollow.current === routeCode && routeCode !== '');
    pendingFollow.current = null;
  }, [routeCode, stopId]);

  const trackedLive = eta.primaryArrival?.kind === 'live'
    ? bus.positions.find((p) => p.vehicleId === eta.primaryArrival?.live?.vehicleId)
    : undefined;

  const journey = useJourneyStops({
    routeCode,
    stopId,
    tripId: trackedLive?.tripId ?? null,
    currentStopSequence: trackedLive?.currentStopSequence ?? null,
    currentStopId: trackedLive?.currentStopId ?? null,
    busLat: trackedLive?.lat ?? null,
    busLng: trackedLive?.lng ?? null,
  });

  const motionLabel = useMemo(() => {
    if (!trackedLive || !route) return null;
    const status = getMotionStatus({
      speedKmh: trackedLive.speed,
      position: { lat: trackedLive.lat, lng: trackedLive.lng },
      signals: route.signals,
    });
    if (!status || status.kind === 'moving') return null;
    return status.label;
  }, [trackedLive, route]);

  const stopName = route?.userStop ? formatStopName(route.userStop.stop_name) : null;

  useBusLiveActivity({
    routeCode,
    stopName: route?.userStop?.stop_name ?? null,
    primaryArrival: eta.primaryArrival,
    resolved: eta.resolved,
    arrivalStatus: eta.arrivalStatus,
    isStale: eta.isStale,
    beforeServiceStart: eta.beforeServiceStart,
    firstBusToday: eta.firstBusToday,
    lastUpdated: bus.lastUpdated,
    enabled: isFollowing,
  });

  const laterArrivals = useMemo<ArrivalLike[]>(() => {
    const out: ArrivalLike[] = [];
    if (eta.secondaryArrival) out.push(eta.secondaryArrival);
    for (const d of eta.scheduledUpcoming) {
      out.push({ kind: 'sched', epochMs: d.departureEpochMs, tripId: d.tripId });
    }
    return out.sort((a, b) => a.epochMs - b.epochMs);
  }, [eta.secondaryArrival, eta.scheduledUpcoming]);

  const userStopRow = route?.userStop ?? null;
  const stopPoint = useMemo(
    () => (userStopRow ? { lat: userStopRow.stop_lat, lng: userStopRow.stop_lon } : null),
    [userStopRow],
  );
  const rainNudge = useRainNudge(stopPoint, now);
  const rainText = rainNudge ? `${rainNudge.title}. ${rainNudge.message}.` : null;

  const model = useMemo(
    () =>
      buildTripModel({
        hasFavorites,
        ready: route != null && !!stopId,
        now,
        mode: eta.resolved.mode,
        minutesToStop: eta.resolved.minutesToStop,
        primaryArrival: eta.primaryArrival,
        laterArrivals,
        arrivalStatus: eta.arrivalStatus,
        delay: eta.resolved.delay,
        serviceEnded: eta.serviceEnded,
        beforeServiceStart: eta.beforeServiceStart,
        firstBusToday: eta.firstBusToday,
        lastBusToday: eta.lastBusToday,
        liveBusCount: bus.positions.length,
        lastUpdated: bus.lastUpdated,
        feedError: bus.error != null,
        stopsAhead: trackedLive ? journey.stopsAhead : null,
        motionLabel,
        walkMinutes: settings.walkMinutes,
        walkRemainingSeconds: walk.remainingSeconds,
        isFollowing,
        formatClock: formatClockHHMM,
        routeCode,
        feedVehicleCount: bus.feedVehicleCount,
        busNearStopName: trackedLive && journey.busStop ? formatStopName(journey.busStop.name) : null,
        rainNudge: rainText,
      }),
    [
      hasFavorites,
      route,
      stopId,
      now,
      eta.resolved,
      eta.primaryArrival,
      laterArrivals,
      eta.arrivalStatus,
      eta.serviceEnded,
      eta.beforeServiceStart,
      eta.firstBusToday,
      eta.lastBusToday,
      bus.positions.length,
      bus.lastUpdated,
      bus.error,
      trackedLive,
      journey.stopsAhead,
      journey.busStop,
      bus.feedVehicleCount,
      routeCode,
      rainText,
      motionLabel,
      settings.walkMinutes,
      settings.clockFormat,
      walk.remainingSeconds,
      isFollowing,
    ],
  );

  useMomentHaptics(model, eta.arrivalStatus, isFollowing);

  const favoriteTargets = useFavoriteStopPoints(
    settings.favoritedRoutes,
    settings.preferredStopByRoute,
    gtfs.lastSettledAt,
  );
  const { setPreferredRouteCode } = settings;
  const onFollowRequest = useCallback(
    (code: string) => {
      if (code === routeCode) {
        setIsFollowing(true);
      } else if (settings.favoritedRoutes.includes(code)) {
        pendingFollow.current = code;
        setPreferredRouteCode(code);
      }
    },
    [routeCode, settings.favoritedRoutes, setPreferredRouteCode],
  );
  const side = useTripSideEffects({
    routeCode,
    stopId,
    stopName,
    primaryArrival: eta.primaryArrival,
    laterArrivals,
    lastBusToday: eta.lastBusToday,
    lastUpdated: bus.lastUpdated,
    model,
    now,
    isFollowing,
    walkMinutes: settings.walkMinutes,
    favorites: favoriteTargets,
    onFollowRequest,
  });

  const follow = useCallback(() => {
    setIsFollowing(true);
    haptics.success();
    // The "Leave now" alert needs it; asked on this tap, never at launch.
    void ensureNotificationPermission().catch(() => {});
  }, []);
  const unfollow = useCallback(() => {
    setIsFollowing(false);
    haptics.light();
  }, []);
  const startWalking = useCallback(() => {
    setIsFollowing(true);
    void walk.start();
    haptics.success();
  }, [walk]);
  const cancelWalking = useCallback(() => {
    void walk.cancel();
    haptics.light();
  }, [walk]);

  const routeLoadFailed = !!routeCode && route == null && gtfs.failed.has(routeCode);
  const retryRouteLoad = useCallback(() => {
    if (routeCode) void gtfs.retry(routeCode);
  }, [gtfs, routeCode]);

  const value = useMemo<TripContextValue>(
    () => ({
      hasFavorites,
      routeLoadFailed,
      retryRouteLoad,
      routeCode,
      stopId,
      stopName,
      route,
      eta,
      bus,
      journey,
      walk,
      model,
      now,
      isFollowing,
      follow,
      unfollow,
      startWalking,
      cancelWalking,
      rainNudge,
      favoriteStops: favoriteTargets,
      lastBusReminder: side.lastBusReminder,
      setLastBusReminder: side.setLastBusReminder,
      detent,
      setDetent,
    }),
    [
      hasFavorites,
      routeLoadFailed,
      retryRouteLoad,
      routeCode,
      stopId,
      stopName,
      route,
      eta,
      bus,
      journey,
      walk,
      model,
      now,
      isFollowing,
      follow,
      unfollow,
      startWalking,
      cancelWalking,
      rainNudge,
      favoriteTargets,
      side.lastBusReminder,
      side.setLastBusReminder,
      detent,
    ],
  );

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used inside <TripProvider>');
  return ctx;
}

/**
 * The two moments worth a haptic while the user is following a bus: the
 * leave-now window opening and the bus arriving at their stop. Never on
 * ticks or refreshes.
 */
function useMomentHaptics(
  model: TripModel,
  arrivalStatus: string,
  isFollowing: boolean,
) {
  const prevAction = useRef(model.action.kind);
  const prevArrival = useRef(arrivalStatus);
  useEffect(() => {
    const was = prevAction.current;
    prevAction.current = model.action.kind;
    if (isFollowing && model.action.kind === 'leave-now' && was === 'follow') {
      haptics.warning();
    }
  }, [model.action.kind, isFollowing]);
  useEffect(() => {
    const was = prevArrival.current;
    prevArrival.current = arrivalStatus;
    if (isFollowing && arrivalStatus === 'arriving' && was === 'en-route') {
      haptics.arriving();
    }
  }, [arrivalStatus, isFollowing]);
}

function useRouteStatic(
  routeCode: string,
  stopId: string,
  reloadKeys: readonly unknown[],
): RouteStatic | null {
  const [data, setData] = useState<RouteStatic | null>(null);

  useEffect(() => {
    if (!routeCode) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const [routes, allStops] = await Promise.all([getRoutes(db), getStops(db)]);
        const row = routes.find((r) => r.code === routeCode);
        if (!row) return;
        const [poly, ordered, signals] = await Promise.all([
          getRoutePolyline(db, row.route_id),
          getStopsForRouteOrdered(db, routeCode),
          getTrafficSignals(db, routeCode),
        ]);
        if (cancelled) return;
        setData({
          routeCode,
          stopId,
          longName:
            row.long_name && row.long_name.trim() !== routeCode
              ? row.long_name.trim()
              : null,
          polyline: poly.map((p) => ({ lat: p.lat, lng: p.lng })),
          stops: ordered,
          stopsById: new Map(
            allStops.map((s) => [s.stop_id, { lat: s.stop_lat, lng: s.stop_lon }]),
          ),
          userStop: allStops.find((s) => s.stop_id === stopId) ?? null,
          signals: signals.map((s) => ({ id: s.osm_id, lat: s.lat, lng: s.lng })),
        });
      } catch (err) {
        console.warn('[trip] failed to load route data', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCode, stopId, ...reloadKeys]);

  // Never hand out the previous route's geometry for the new selection — the
  // map unmounts route overlays while this is null (Fabric is fragile with
  // in-place polyline swaps).
  if (data && (data.routeCode !== routeCode || data.stopId !== stopId)) {
    return null;
  }
  return data;
}

/** Boarding-stop coordinates for each favourite, for the arrival geofences. */
function useFavoriteStopPoints(
  routes: readonly string[],
  stopByRoute: Readonly<Record<string, string>>,
  reloadKey: unknown,
): { routeCode: string; stopId: string; lat: number; lng: number }[] {
  const [points, setPoints] = useState<
    { routeCode: string; stopId: string; lat: number; lng: number }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const byId = new Map((await getStops(db)).map((s) => [s.stop_id, s]));
        const out = routes.flatMap((code) => {
          const s = byId.get(stopByRoute[code] ?? '');
          return s ? [{ routeCode: code, stopId: s.stop_id, lat: s.stop_lat, lng: s.stop_lon }] : [];
        });
        if (!cancelled) setPoints(out);
      } catch {
        // Geofences are optional; keep the last good list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, stopByRoute, reloadKey]);
  return points;
}
