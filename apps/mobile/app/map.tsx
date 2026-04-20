import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';

import { GlassGuard } from '@/components/GlassGuard';
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
import { useStaticGtfs } from '@/hooks/useStaticGtfs';
import { tokens, typeStyle } from '@/theme/tokens';

const ROUTE_CODE = 'T816';
const DEFAULT_STOP_ID = 'HOTEL_LISA_DE_INN';
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
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const { positions } = useBusPosition();
  const eta = useEta({ stopId: DEFAULT_STOP_ID });

  useEffect(() => {
    if (!gtfs.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route = routes.find((r) => r.code === ROUTE_CODE) ?? routes[0];
        if (!route) return;
        const stop =
          stops.find((s) => s.stop_id === DEFAULT_STOP_ID) ?? stops[0];
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
  }, [gtfs.ready]);

  const regionsRef = useRef(new Map<string, AnimatedRegion>());
  const [bearings, setBearings] = useState<Record<string, number>>({});

  useEffect(() => {
    if (positions.length === 0) return;
    const regions = regionsRef.current;
    const seen = new Set<string>();
    const nextBearings: Record<string, number> = {};
    for (const p of positions) {
      seen.add(p.vehicleId);
      nextBearings[p.vehicleId] = p.bearing ?? 0;
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
    setBearings(nextBearings);
  }, [positions]);

  const overlayLabel = useMemo(() => {
    if (eta.minutesToStop == null) return 'Waiting for bus…';
    return `Bus in ${eta.minutesToStop} min`;
  }, [eta.minutesToStop]);

  if (!staticData) {
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.root}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={staticData.region}
        showsUserLocation
        showsMyLocationButton={false}
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
          title={staticData.stop.stop_name}
          description={
            eta.minutesToStop != null
              ? `Live ETA: ${eta.minutesToStop} min${eta.isStale ? ' (stale)' : ''}`
              : 'Waiting for live ETA…'
          }
          pinColor="green"
        />
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
              rotation={bearings[p.vehicleId] ?? 0}
              flat
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.busMarker}>
                <View style={styles.busInner} />
              </View>
            </MarkerAnimated>
          );
        })}
      </MapView>
      <GlassGuard style={styles.overlay} glassEffectStyle="clear">
        <Text style={styles.overlayTitle}>{overlayLabel}</Text>
        <Text style={styles.overlaySubtitle}>
          to {staticData.stop.stop_name}
          {eta.isStale ? ' · stale' : ''}
        </Text>
      </GlassGuard>
    </View>
  );
}

const busColor = tokens.color.accent as ColorValue;
const bgColor = tokens.color.bg as ColorValue;
const fgColor = tokens.color.fg as ColorValue;
const mutedColor = tokens.color.muted as ColorValue;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: bgColor },
  loading: { flex: 1, backgroundColor: bgColor },
  map: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 100,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 24,
    overflow: 'hidden',
  },
  overlayTitle: {
    ...typeStyle.title,
    fontSize: 22,
    lineHeight: 26,
    color: fgColor,
  },
  overlaySubtitle: {
    ...typeStyle.caption,
    marginTop: 4,
    color: mutedColor,
  },
  busMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: busColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
});
