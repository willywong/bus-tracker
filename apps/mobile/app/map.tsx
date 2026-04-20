import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';

import { BusCallout } from '@/components/map/BusCallout';
import { MapStatusCard } from '@/components/map/MapStatusCard';
import { MapStatusCardSkeleton } from '@/components/map/MapStatusCardSkeleton';
import { StopCallout } from '@/components/map/StopCallout';
import { openDb } from '@/db/database';
import {
  getRoutePolyline,
  getRoutes,
  getStops,
  type PolylinePoint,
  type StopRow,
} from '@/db/queries';
import { useBusPosition } from '@/hooks/useBusPosition';
import { useEta } from '@/hooks/useEta';
import { useSettings } from '@/hooks/useSettings';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { tokens } from '@/theme/tokens';

const POSITION_TWEEN_MS = 30_000;
const BBOX_PAD_DEG = 0.008;

type LatLng = { latitude: number; longitude: number };

interface StaticData {
  polyline: LatLng[];
  stop: StopRow;
  region: Region;
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
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const { positions, lastUpdated } = useBusPosition({
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
        const polyPoints = await getRoutePolyline(db, route.route_id);
        const region = computeRegion(polyPoints);
        if (!region || cancelled) return;
        setStaticData({
          polyline: polyPoints.map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
          })),
          stop,
          region,
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
        <Marker
          coordinate={{
            latitude: staticData.stop.stop_lat,
            longitude: staticData.stop.stop_lon,
          }}
          pinColor="green"
          calloutAnchor={{ x: 0.5, y: 0 }}
        >
          <StopCallout stopName={staticData.stop.stop_name} eta={eta} />
        </Marker>
        {positions.map((p) => {
          const region = regionsRef.current.get(p.vehicleId);
          if (!region) return null;
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
              <BusCallout position={p} />
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
        />
      </View>
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
