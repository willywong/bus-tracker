import {
  computeScheduleDelay,
  toMalaysiaParts,
  type LatLng as SharedLatLng,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, {
  AnimatedRegion,
  Circle,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';

import { BusCallout } from '@/components/map/BusCallout';
import { GlassDemoSheet } from '@/components/tracker/GlassDemoSheet';
import { MapChooseBusCard } from '@/components/map/MapChooseBusCard';
import { MapLegendButton } from '@/components/map/MapLegendButton';
import { MapStatusCard } from '@/components/map/MapStatusCard';
import { MapStatusCardSkeleton } from '@/components/map/MapStatusCardSkeleton';
import { RecenterRouteButton } from '@/components/map/RecenterRouteButton';
import { RecenterStopButton } from '@/components/map/RecenterStopButton';
import { RouteSwitcher } from '@/components/tracker/RouteSwitcher';
import { ScheduledBusCallout } from '@/components/map/ScheduledBusCallout';
import { ScheduledBusMarker } from '@/components/map/ScheduledBusMarker';
import { StopCallout } from '@/components/map/StopCallout';
import { openDb } from '@/db/database';
import {
  getRoutePolyline,
  getRoutes,
  getScheduledStopTimeForTrip,
  getStops,
  getTrafficSignals,
  type PolylinePoint,
  type StopRow,
  type TrafficSignalRow,
} from '@/db/queries';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta } from '@/hooks/useEta';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { useRouteTransition } from '@/hooks/useRouteTransition';
import { useScheduledBusPosition } from '@/hooks/useScheduledBusPosition';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { tokens } from '@/theme/tokens';

const POSITION_TWEEN_MS = 30_000;
const BBOX_PAD_DEG = 0.008;

const EMPTY_STOPS: ReadonlyMap<string, SharedLatLng> = new Map();

type LatLng = { latitude: number; longitude: number };

interface StaticData {
  polyline: LatLng[];
  /** Same polyline in `{lat,lng}` shape, for shared-package consumers. */
  polylineLatLng: SharedLatLng[];
  stop: StopRow;
  /** All stops keyed by `stop_id` — used to interpolate scheduled bus positions. */
  stopsById: ReadonlyMap<string, SharedLatLng>;
  region: Region;
  trafficSignals: TrafficSignalRow[];
}

function computeRegion(points: PolylinePoint[]): Region | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, maxLat - minLat + BBOX_PAD_DEG * 2),
    longitudeDelta: Math.max(0.01, maxLng - minLng + BBOX_PAD_DEG * 2),
  };
}

export default function MapScreen() {
  const gtfs = useStaticGtfs();
  const settings = useSettings();
  useLocationPermission();
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [showAddBus, setShowAddBus] = useState(false);
  const openAddBus = useCallback(() => setShowAddBus(true), []);
  const closeAddBus = useCallback(() => setShowAddBus(false), []);
  const hasFavorites = settings.favoritedRoutes.length > 0;
  const activeRoute = settings.preferredRouteCode ?? '';
  const { positions, lastUpdated, nextRefreshAt, isRefreshing } =
    useBusPosition({
      routeCode: settings.preferredRouteCode ?? undefined,
    });
  const eta = useEta({
    stopId: settings.preferredStopId,
    routeCode: activeRoute,
    trafficProvider: settings.trafficProvider,
  });
  const isTransitioning = useRouteTransition({
    preferredRouteCode: settings.preferredRouteCode,
    preferredStopId: settings.preferredStopId,
    lastComputedAt: eta.lastComputedAt,
  });

  useEffect(() => {
    if (!gtfs.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route = settings.preferredRouteCode
          ? routes.find((r) => r.code === settings.preferredRouteCode) ??
            routes[0]
          : routes[0];
        if (!route) return;
        const stop =
          stops.find((s) => s.stop_id === settings.preferredStopId) ?? stops[0];
        if (!stop) return;
        const [polyPoints, trafficSignals] = await Promise.all([
          getRoutePolyline(db, route.route_id),
          getTrafficSignals(db, route.code),
        ]);
        const region = computeRegion(polyPoints);
        if (!region || cancelled) return;
        const stopsById = new Map<string, SharedLatLng>(
          stops.map((s) => [s.stop_id, { lat: s.stop_lat, lng: s.stop_lon }]),
        );
        setStaticData({
          polyline: polyPoints.map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
          })),
          polylineLatLng: polyPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
          stop,
          stopsById,
          region,
          trafficSignals,
        });
      } catch (err) {
        console.error(
          '[map] static data load failed',
          'routeCode=', settings.preferredRouteCode,
          'stopId=', settings.preferredStopId,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // `gtfs.result` is listed so the effect re-runs once `useStaticGtfs`
    // finishes bootstrapping a newly favorited route into SQLite. Without
    // this, adding a second bus flips `preferredRouteCode` before the new
    // route's polyline row exists — the effect runs with stale DB data and
    // the map keeps showing the old route until the next mount.
  }, [
    gtfs.ready,
    gtfs.result,
    settings.preferredStopId,
    settings.preferredRouteCode,
  ]);

  const regionsRef = useRef(new Map<string, AnimatedRegion>());
  const mapRef = useRef<MapView>(null);

  const handleRecenterStop = useCallback(() => {
    const stop = staticData?.stop;
    if (!stop) return;
    // ~660 m span — close enough to see the stop context, not claustrophobic.
    mapRef.current?.animateToRegion(
      {
        latitude: stop.stop_lat,
        longitude: stop.stop_lon,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      },
      450,
    );
  }, [staticData]);

  const handleRecenterRoute = useCallback(() => {
    const region = staticData?.region;
    if (!region) return;
    mapRef.current?.animateToRegion(region, 550);
  }, [staticData]);

  // Per-bus scheduled arrival (for BusCallout). Keyed by vehicleId. We look up
  // the scheduled departure from the user's stop for each visible trip. If a
  // live vehicle's tripId doesn't match our static cache (the GTFS-RT doc
  // warns matching can be flaky), we silently omit the schedule line.
  const [tripSeconds, setTripSeconds] = useState<Record<string, number>>({});
  const tripIds = useMemo(
    () => [...new Set(positions.map((p) => p.tripId).filter(Boolean))],
    [positions],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const entries: [string, number][] = [];
        for (const tripId of tripIds) {
          const s = await getScheduledStopTimeForTrip(
            db,
            tripId,
            settings.preferredStopId,
          );
          if (s != null) entries.push([tripId, s]);
        }
        if (!cancelled) {
          setTripSeconds(Object.fromEntries(entries));
        }
      } catch (err) {
        console.error(
          '[map] tripSeconds load failed',
          'stopId=', settings.preferredStopId,
          'tripIds=', tripIds,
          'name=', (err as { name?: string })?.name,
          'message=', (err as { message?: string })?.message,
          'stack=', (err as { stack?: string })?.stack,
          'raw=', err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripIds, settings.preferredStopId]);

  // Pick the next scheduled departure that no live vehicle is broadcasting
  // for. When a real bus eventually picks up that tripId, this returns null
  // and the ghost disappears — the live MarkerAnimated takes over.
  const liveTripIds = useMemo(
    () =>
      new Set(
        positions
          .map((p) => p.tripId)
          .filter((id): id is string => !!id),
      ),
    [positions],
  );
  const ghostScheduled = useMemo(() => {
    for (const dep of eta.scheduledUpcoming) {
      if (liveTripIds.has(dep.tripId)) continue;
      return dep;
    }
    return null;
  }, [eta.scheduledUpcoming, liveTripIds]);

  const ghostPosition = useScheduledBusPosition({
    tripId: ghostScheduled?.tripId ?? null,
    polyline: staticData?.polylineLatLng ?? [],
    stopsById: staticData?.stopsById ?? EMPTY_STOPS,
    serviceDayMidnightUtcMs: ghostScheduled?.serviceDayMidnightUtcMs ?? null,
    loop: true,
  });

  useEffect(() => {
    if (positions.length === 0) return;
    const regions = regionsRef.current;
    const seen = new Set<string>();
    for (const p of positions) {
      seen.add(p.vehicleId);
      const existing = regions.get(p.vehicleId);
      if (!existing) {
        regions.set(
          p.vehicleId,
          new AnimatedRegion({
            latitude: p.lat,
            longitude: p.lng,
            latitudeDelta: 0,
            longitudeDelta: 0,
          }),
        );
      } else {
        // react-native-maps' TimingAnimationConfig type inherits `toValue` from
        // RN's base animation config even though AnimatedRegion ignores it.
        existing
          .timing({
            latitude: p.lat,
            longitude: p.lng,
            latitudeDelta: 0,
            longitudeDelta: 0,
            duration: POSITION_TWEEN_MS,
            useNativeDriver: false,
          } as Parameters<AnimatedRegion['timing']>[0])
          .start();
      }
    }
    for (const id of Array.from(regions.keys())) {
      if (seen.has(id)) continue;
      // Stop any in-flight native timing animation before dropping the ref.
      // Leaving an animation queued on the native UI thread while the
      // MarkerAnimated unmounts causes Fabric's view-recycle assertion to
      // fire (SIGABRT inside _enqueueComponentViewWithComponentHandle).
      const r = regions.get(id) as unknown as {
        stopAnimation?: () => void;
      };
      try {
        r?.stopAnimation?.();
      } catch {
        // stopAnimation is best-effort; no-op if the RN version lacks it.
      }
      regions.delete(id);
    }
  }, [positions]);

  // Clear all regions when the active route changes. Keeps route-A vehicles
  // from lingering in the ref map across route switches, which can otherwise
  // make the next render show stale markers for a frame and stress Fabric's
  // mount recycler.
  useEffect(() => {
    const regions = regionsRef.current;
    for (const id of Array.from(regions.keys())) {
      const r = regions.get(id) as unknown as { stopAnimation?: () => void };
      try {
        r?.stopAnimation?.();
      } catch {
        /* no-op */
      }
      regions.delete(id);
    }
  }, [activeRoute]);

  // Pick a meter-radius for the traffic-signal circles that keeps them
  // visually ~10 px in diameter regardless of zoom level.
  const signalRadiusMeters = useMemo(() => {
    const r = mapRegion ?? staticData?.region;
    if (!r || mapSize.width === 0) return 8;
    const metersPerDegLng = 111_320 * Math.cos((r.latitude * Math.PI) / 180);
    const mpp = (r.longitudeDelta * metersPerDegLng) / mapSize.width;
    return Math.max(2, 5 * mpp);
  }, [
    mapRegion?.latitude,
    mapRegion?.longitudeDelta,
    mapSize.width,
    staticData?.region,
  ]);

  if (!staticData) {
    return (
      <View style={styles.root}>
        <View style={styles.map} />
        <View style={styles.overlay} pointerEvents="box-none">
          {hasFavorites ? (
            <MapStatusCardSkeleton />
          ) : (
            <MapChooseBusCard onAddBus={openAddBus} />
          )}
        </View>
        <GlassDemoSheet isPresented={showAddBus} onDismiss={closeAddBus} />
      </View>
    );
  }

  // `staticData` is loaded async, so when the user switches routes it briefly
  // still holds the PREVIOUS route's polyline / circles / stop. If we render
  // those against the live MapView and then in-place-update their props when
  // staticData catches up, react-native-maps @ 1.27.2 under Fabric crashes
  // (Polyline coordinates + Circle list rapid prop updates are fragile).
  // Skipping the route-specific children while staticData is stale lets
  // everything unmount together, then mount together on the next commit.
  const staticFresh =
    staticData.stop.stop_id === settings.preferredStopId;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={staticData.region}
        showsUserLocation
        showsMyLocationButton={false}
        showsTraffic
        onRegionChange={setMapRegion}
        onLayout={(e) => setMapSize(e.nativeEvent.layout)}
      >
        {staticFresh && staticData.polyline.length >= 2 && (
          <Polyline
            coordinates={staticData.polyline}
            strokeColor={tokens.color.accent as unknown as string}
            strokeWidth={4}
          />
        )}
        {staticFresh
          ? staticData.trafficSignals.map((s) => (
              <Circle
                key={s.osm_id}
                center={{ latitude: s.lat, longitude: s.lng }}
                radius={signalRadiusMeters}
                fillColor={SIGNAL_RED_FILL}
                strokeColor={SIGNAL_RED_STROKE}
                strokeWidth={1}
                zIndex={0}
              />
            ))
          : null}
        {staticFresh ? (
          <Marker
            coordinate={{
              latitude: staticData.stop.stop_lat,
              longitude: staticData.stop.stop_lon,
            }}
            flat
            anchor={{ x: 0.5, y: 0.5 }}
            calloutAnchor={{ x: 0.5, y: 0 }}
            tracksViewChanges={false}
          >
            <View style={styles.stopMarker}>
              <SymbolView
                name="signpost.right.fill"
                size={16}
                tintColor="#FFFFFF"
                resizeMode="scaleAspectFit"
              />
            </View>
            <StopCallout
              stopName={staticData.stop.stop_name}
              eta={eta}
              schedule={eta.scheduledUpcoming}
            />
          </Marker>
        ) : null}
        {staticFresh && ghostScheduled && ghostPosition.coord ? (
          <ScheduledBusMarker
            coordinate={{
              latitude: ghostPosition.coord.lat,
              longitude: ghostPosition.coord.lng,
            }}
          >
            <ScheduledBusCallout
              routeCode={ghostScheduled.routeCode}
              scheduledEpochMs={ghostScheduled.departureEpochMs}
            />
          </ScheduledBusMarker>
        ) : null}
        {positions.map((p) => {
          const region = regionsRef.current.get(p.vehicleId);
          if (!region) return null;
          const secs = p.tripId ? tripSeconds[p.tripId] : undefined;
          const scheduledArrival = (() => {
            if (secs == null) return null;
            // Use today's Malaysia midnight as the service-day anchor for
            // display. If the trip spilled from yesterday (25:xx:00) this
            // becomes next-day display; acceptable for a callout.
            const parts = toMalaysiaParts(new Date());
            const at = parts.midnightUtcMs + secs * 1000;
            const projected = Date.now() + (eta.minutesToStop ?? 0) * 60_000;
            const delay =
              eta.current?.vehicleId === p.vehicleId &&
              eta.minutesToStop != null
                ? computeScheduleDelay({
                    scheduledDepartureSeconds: secs,
                    projectedArrivalEpochMs: projected,
                    serviceDayMidnightUtcMs: parts.midnightUtcMs,
                  })
                : null;
            return { at, delay };
          })();
          return (
            <MarkerAnimated
              key={p.vehicleId}
              coordinate={
                region as unknown as React.ComponentProps<
                  typeof MarkerAnimated
                >['coordinate']
              }
              flat
              anchor={{ x: 0.5, y: 0.5 }}
              calloutAnchor={{ x: 0.5, y: 0 }}
              tracksViewChanges={false}
            >
              <View style={styles.busMarker}>
                <SymbolView
                  name="bus.fill"
                  size={18}
                  tintColor="#FFFFFF"
                  resizeMode="scaleAspectFit"
                />
              </View>
              <BusCallout position={p} scheduledArrival={scheduledArrival} />
            </MarkerAnimated>
          );
        })}
      </MapView>
      <View style={styles.overlay} pointerEvents="box-none">
        {!hasFavorites ? (
          <MapChooseBusCard onAddBus={openAddBus} />
        ) : isTransitioning ? (
          <Animated.View
            key="status-skel"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(180)}
          >
            <MapStatusCardSkeleton />
          </Animated.View>
        ) : (
          <Animated.View
            key="status-real"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(180)}
          >
            <MapStatusCard
              routeCode={activeRoute}
              eta={eta}
              stopName={staticData.stop.stop_name}
              lastUpdated={lastUpdated}
              livePosition={positions.find(
                (p) => p.vehicleId === eta.current?.vehicleId,
              )}
              nextRefreshAt={nextRefreshAt}
              isRefreshing={isRefreshing}
            />
          </Animated.View>
        )}
      </View>
      {hasFavorites ? (
        <SafeAreaView
          edges={['top']}
          style={styles.fabTopLeft}
          pointerEvents="box-none"
        >
          <RouteSwitcher
            selected={settings.preferredRouteCode}
            options={settings.favoritedRoutes}
            onSelect={settings.setPreferredRouteCode}
            onAddBus={openAddBus}
          />
        </SafeAreaView>
      ) : null}
      <SafeAreaView
        edges={['top']}
        style={styles.fabTopRight}
        pointerEvents="box-none"
      >
        <View style={styles.fabStack}>
          <RecenterStopButton onPress={handleRecenterStop} />
          <RecenterRouteButton onPress={handleRecenterRoute} />
          <MapLegendButton />
        </View>
      </SafeAreaView>
      <GlassDemoSheet isPresented={showAddBus} onDismiss={closeAddBus} />
    </View>
  );
}

const busColor = tokens.color.accent as ColorValue;
const bgColor = tokens.color.bg as ColorValue;
const SIGNAL_RED_FILL = 'rgba(208, 2, 27, 1)';
const SIGNAL_RED_STROKE = 'rgba(255, 255, 255, 0.9)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: bgColor },
  map: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 110,
  },
  fabTopRight: {
    position: 'absolute',
    top: 0,
    right: 16,
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  fabTopLeft: {
    position: 'absolute',
    top: 0,
    left: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  fabStack: {
    alignItems: 'flex-end',
    gap: 10,
  },
  busMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: busColor,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  },
  stopMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#2BA84A',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  },
});
