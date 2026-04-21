import {
  computeScheduleDelay,
  toMalaysiaParts,
  type LatLng as SharedLatLng,
} from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';

import { BusCallout } from '@/components/map/BusCallout';
import { MapLegendButton } from '@/components/map/MapLegendButton';
import { MapStatusCard } from '@/components/map/MapStatusCard';
import { MapStatusCardSkeleton } from '@/components/map/MapStatusCardSkeleton';
import { RecenterStopButton } from '@/components/map/RecenterStopButton';
import { ScheduledBusCallout } from '@/components/map/ScheduledBusCallout';
import { ScheduledBusMarker } from '@/components/map/ScheduledBusMarker';
import { StopCallout } from '@/components/map/StopCallout';
import { TrafficSignalMarker } from '@/components/map/TrafficSignalMarker';
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
  const { positions, lastUpdated, nextRefreshAt, isRefreshing } =
    useBusPosition({
      routeCode: settings.preferredRouteCode,
    });
  const eta = useEta({
    stopId: settings.preferredStopId,
    routeCode: settings.preferredRouteCode,
    trafficProvider: settings.trafficProvider,
  });

  useEffect(() => {
    if (!gtfs.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route =
          routes.find((r) => r.code === settings.preferredRouteCode) ??
          routes[0];
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
        console.warn('[map] static data load failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gtfs.ready, settings.preferredStopId, settings.preferredRouteCode]);

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
      } catch {
        // silent fail — calling side treats missing entries as "no schedule".
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
      if (!seen.has(id)) regions.delete(id);
    }
  }, [positions]);

  if (!staticData) {
    return (
      <View style={styles.root}>
        <View style={styles.map} />
        <View style={styles.overlay} pointerEvents="box-none">
          <MapStatusCardSkeleton />
        </View>
      </View>
    );
  }

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
      >
        {staticData.polyline.length >= 2 && (
          <Polyline
            coordinates={staticData.polyline}
            strokeColor={tokens.color.accent as unknown as string}
            strokeWidth={4}
          />
        )}
        {staticData.trafficSignals.map((s) => (
          <TrafficSignalMarker
            key={s.osm_id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
          />
        ))}
        <Marker
          coordinate={{
            latitude: staticData.stop.stop_lat,
            longitude: staticData.stop.stop_lon,
          }}
          pinColor="green"
          calloutAnchor={{ x: 0.5, y: 0 }}
        >
          <StopCallout
            stopName={staticData.stop.stop_name}
            eta={eta}
            schedule={eta.scheduledUpcoming}
          />
        </Marker>
        {ghostScheduled && ghostPosition.coord ? (
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
        <MapStatusCard
          routeCode={settings.preferredRouteCode}
          eta={eta}
          stopName={staticData.stop.stop_name}
          lastUpdated={lastUpdated}
          livePosition={positions.find(
            (p) => p.vehicleId === eta.current?.vehicleId,
          )}
          nextRefreshAt={nextRefreshAt}
          isRefreshing={isRefreshing}
        />
      </View>
      <SafeAreaView
        edges={['top']}
        style={styles.fabTopRight}
        pointerEvents="box-none"
      >
        <View style={styles.fabStack}>
          <RecenterStopButton onPress={handleRecenterStop} />
          <MapLegendButton />
        </View>
      </SafeAreaView>
    </View>
  );
}

const busColor = tokens.color.accent as ColorValue;
const bgColor = tokens.color.bg as ColorValue;

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
    alignItems: 'flex-end',
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
});
