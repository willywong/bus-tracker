import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Share,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { AnimatedRegion, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BusMarker, GhostBusMarker } from '@/components/map/BusMarker';
import { RouteLayer } from '@/components/map/RouteLayer';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { useScheduledBusPosition } from '@/hooks/useScheduledBusPosition';
import { useSettings, type MapType } from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { hex, motion, pick, SHEET_DETENTS } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/** Greater Kuala Lumpur — where the map opens before a route is chosen. */
const KL_REGION = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

/** Markers glide between fixes over one poll interval. */
const POSITION_TWEEN_MS = 30_000;
const EMPTY_STOPS = new Map<string, { lat: number; lng: number }>();

/**
 * The map canvas. Everything about the trip lives in the persistent sheet
 * (`app/trip.tsx`); this screen frames the evidence — your stop and the bus
 * heading to it — and hosts the glass toolbar controls.
 */
export default function MapScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const settings = useSettings();
  const trip = useTrip();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useLocationPermission();
  usePresentTripSheet();

  const mapRef = useRef<MapView>(null);
  const [userPanned, setUserPanned] = useState(false);

  const accent = pick(hex.accent, scheme);
  const route = trip.route;
  const polyline = useMemo(
    () =>
      route?.polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })) ?? [],
    [route],
  );

  // Sheet-aware camera padding: keep the trip visible above the sheet. At the
  // large detent the map is hidden anyway, so keep the glance framing.
  const sheetHeight = windowHeight * SHEET_DETENTS[Math.min(trip.detent, 1)];
  const topChrome = insets.top + 56;
  const mapPadding = useMemo(
    () => ({ top: topChrome, right: 0, bottom: sheetHeight, left: 0 }),
    [topChrome, sheetHeight],
  );

  // --- Live bus markers ----------------------------------------------------
  const positions = trip.bus.positions;
  const regions = useAnimatedRegions(positions, trip.routeCode);
  const primaryVehicleId =
    trip.eta.primaryArrival?.kind === 'live'
      ? trip.eta.primaryArrival.live?.vehicleId ?? null
      : null;
  const primaryPosition = positions.find((p) => p.vehicleId === primaryVehicleId);

  // --- Ghost (scheduled) bus when nothing live is reporting ----------------
  const ghostDeparture =
    positions.length === 0 ? trip.eta.scheduledUpcoming[0] ?? null : null;
  const ghost = useScheduledBusPosition({
    tripId: ghostDeparture?.tripId ?? null,
    polyline: route?.polyline ?? [],
    stopsById: route?.stopsById ?? EMPTY_STOPS,
    serviceDayMidnightUtcMs: ghostDeparture?.serviceDayMidnightUtcMs ?? null,
    loop: true,
  });

  // --- Camera ---------------------------------------------------------------
  const frameTrip = useCallback(
    (animated = true) => {
      const map = mapRef.current;
      if (!map || !route) return;
      const coords: { latitude: number; longitude: number }[] = [];
      if (route.userStop) {
        coords.push({
          latitude: route.userStop.stop_lat,
          longitude: route.userStop.stop_lon,
        });
      }
      const busCoord = primaryPosition
        ? { latitude: primaryPosition.lat, longitude: primaryPosition.lng }
        : ghost.coord
          ? { latitude: ghost.coord.lat, longitude: ghost.coord.lng }
          : null;
      if (busCoord) coords.push(busCoord);

      if (coords.length === 1) {
        map.animateCamera(
          { center: coords[0], altitude: 1600, heading: 0, pitch: 0 },
          { duration: animated ? motion.reposition : 0 },
        );
        return;
      }
      const target = coords.length > 0 ? coords : polyline;
      if (target.length === 0) return;
      map.fitToCoordinates(target, {
        edgePadding: { top: 64, right: 56, bottom: 64, left: 56 },
        animated,
      });
    },
    [route, primaryPosition, ghost.coord, polyline],
  );

  // Frame once per route/stop as soon as geometry arrives, then again when
  // the bus we're tracking changes or the sheet changes height — unless the
  // user has taken over the camera.
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!route) return;
    const key = `${route.routeCode}|${route.stopId}`;
    if (framedKey.current === key) return;
    framedKey.current = key;
    setUserPanned(false);
    // Let the map apply the new padding first.
    const t = setTimeout(() => frameTrip(false), 50);
    return () => clearTimeout(t);
  }, [route, frameTrip]);

  useEffect(() => {
    if (userPanned) return;
    frameTrip(true);
    // Intentionally keyed on identity changes, not every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryVehicleId, trip.detent, userPanned]);

  const recenter = useCallback(() => {
    haptics.light();
    setUserPanned(false);
    frameTrip(true);
  }, [frameTrip]);

  const share = useCallback(() => {
    const m = trip.model;
    if (!m.compact || !trip.stopName) return;
    const how = m.source === 'scheduled' ? 'scheduled' : 'live estimate';
    void Share.share({
      message: `${trip.routeCode} to ${trip.stopName}: ${m.compact} (${how}).`,
    });
  }, [trip.model, trip.routeCode, trip.stopName]);

  const mapType: MapType = settings.mapType;
  const casing = pick(hex.casing, scheme);
  const labelColor = scheme === 'dark' ? '#FFFFFF' : '#1C1C1E';
  const labelHalo = scheme === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';

  return (
    <View style={styles.root}>
      <MapToolbar
        onRecenter={recenter}
        userPanned={userPanned}
        onShare={trip.model.compact ? share : undefined}
      />
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={KL_REGION}
        mapType={mapType === 'satellite' ? 'hybrid' : 'mutedStandard'}
        pointsOfInterestFilter={['publicTransport']}
        showsUserLocation
        showsCompass={false}
        showsMyLocationButton={false}
        pitchEnabled={false}
        mapPadding={mapPadding}
        onPanDrag={() => {
          if (!userPanned) setUserPanned(true);
        }}
      >
        {route ? (
          <RouteLayer
            key={`${route.routeCode}|${route.stopId}`}
            polyline={polyline}
            stops={route.stops}
            userStop={route.userStop}
            accent={accent}
            casing={casing}
            stopFill={pick(hex.stopFill, scheme)}
            labelColor={labelColor}
            labelHalo={labelHalo}
          />
        ) : null}
        {route && ghost.coord && positions.length === 0 ? (
          <GhostBusMarker
            coordinate={{ latitude: ghost.coord.lat, longitude: ghost.coord.lng }}
            color={pick(hex.secondaryLabel, scheme)}
            background={pick(hex.stopFill, scheme)}
          />
        ) : null}
        {route
          ? positions.map((p) => {
              const region = regions.get(p.vehicleId);
              if (!region) return null;
              const primary = p.vehicleId === primaryVehicleId;
              const passed = trip.eta.passedVehicleIds.has(p.vehicleId);
              return (
                <BusMarker
                  key={p.vehicleId}
                  region={region}
                  accent={accent}
                  primary={primary}
                  passed={passed}
                  bearing={p.bearing}
                  accessibilityLabel={
                    primary
                      ? `Your bus, ${trip.model.compact ?? ''}, live`
                      : passed
                        ? 'Bus that has passed your stop'
                        : 'Another bus on this route, live'
                  }
                />
              );
            })
          : null}
      </MapView>
    </View>
  );
}

/**
 * Native glass toolbar over the map: the route switcher (leading) and the
 * recenter / more cluster (trailing). System-drawn, so it gets Liquid Glass,
 * grouping, sizing and accessibility for free.
 */
function MapToolbar({
  onRecenter,
  userPanned,
  onShare,
}: {
  onRecenter: () => void;
  userPanned: boolean;
  onShare?: () => void;
}) {
  const router = useRouter();
  const settings = useSettings();
  const trip = useTrip();
  const favorites = settings.favoritedRoutes;

  const selectRoute = (code: string) => {
    if (code === settings.preferredRouteCode) return;
    haptics.selection();
    settings.setPreferredRouteCode(code);
  };

  return (
    <>
      <Stack.Toolbar placement="left">
        {favorites.length === 0 ? (
          <Stack.Toolbar.Button icon="plus" onPress={() => router.push('/add-route')}>
            <Stack.Toolbar.Label>Add Route</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Menu
            accessibilityLabel={`Route ${trip.routeCode}. Switch route`}
          >
            <Stack.Toolbar.Label>{trip.routeCode || 'Route'}</Stack.Toolbar.Label>
            <Stack.Toolbar.Menu inline title="Your routes">
              {favorites.map((code) => (
                <Stack.Toolbar.MenuAction
                  key={code}
                  icon="bus.fill"
                  isOn={code === settings.preferredRouteCode}
                  onPress={() => selectRoute(code)}
                >
                  {code}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction icon="plus" onPress={() => router.push('/add-route')}>
              Add Route…
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="pencil" onPress={() => router.push('/settings')}>
              Edit Routes…
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={userPanned ? 'location' : 'location.fill'}
          accessibilityLabel="Recenter map"
          onPress={onRecenter}
        />
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.Menu inline title="Map">
            <Stack.Toolbar.MenuAction
              icon="map"
              isOn={settings.mapType === 'standard'}
              onPress={() => settings.setMapType('standard')}
            >
              Standard
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="globe.asia.australia"
              isOn={settings.mapType === 'satellite'}
              onPress={() => settings.setMapType('satellite')}
            >
              Satellite
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          {onShare ? (
            <Stack.Toolbar.MenuAction icon="square.and.arrow.up" onPress={onShare}>
              Share Arrival
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Settings
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}

/** Presents the persistent trip sheet once the navigator is ready. */
function usePresentTripSheet() {
  const router = useRouter();
  const nav = useRootNavigationState();
  const hasTrip = nav?.routes?.some((r) => r.name === 'trip') ?? false;
  const ready = nav?.key != null;
  useEffect(() => {
    if (!ready || hasTrip) return;
    router.push('/trip');
  }, [ready, hasTrip, router]);
}

/**
 * One AnimatedRegion per vehicle so markers glide between fixes. Regions are
 * stopped before they're dropped — unmounting a marker mid-animation trips
 * Fabric's view-recycle assertion — and all cleared on route change so a
 * previous route's buses never flash on the new one.
 */
function useAnimatedRegions(
  positions: { vehicleId: string; lat: number; lng: number }[],
  routeCode: string,
): Map<string, AnimatedRegion> {
  const ref = useRef(new Map<string, AnimatedRegion>());

  useEffect(() => {
    const regions = ref.current;
    for (const id of Array.from(regions.keys())) {
      stop(regions.get(id));
      regions.delete(id);
    }
  }, [routeCode]);

  const regions = ref.current;
  const seen = new Set<string>();
  for (const p of positions) {
    seen.add(p.vehicleId);
    if (!regions.has(p.vehicleId)) {
      regions.set(
        p.vehicleId,
        new AnimatedRegion({
          latitude: p.lat,
          longitude: p.lng,
          latitudeDelta: 0,
          longitudeDelta: 0,
        }),
      );
    }
  }

  useEffect(() => {
    for (const p of positions) {
      const region = regions.get(p.vehicleId);
      region
        ?.timing({
          latitude: p.lat,
          longitude: p.lng,
          latitudeDelta: 0,
          longitudeDelta: 0,
          duration: POSITION_TWEEN_MS,
          useNativeDriver: false,
        } as Parameters<AnimatedRegion['timing']>[0])
        .start();
    }
    for (const id of Array.from(regions.keys())) {
      if (seen.has(id)) continue;
      stop(regions.get(id));
      regions.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  return regions;
}

function stop(region: AnimatedRegion | undefined) {
  try {
    (region as unknown as { stopAnimation?: () => void })?.stopAnimation?.();
  } catch {
    // best effort
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
