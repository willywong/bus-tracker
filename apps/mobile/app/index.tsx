import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Easing,
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
import { hex, pick, SHEET_DETENTS } from '@/theme/design';
import { haptics } from '@/utils/haptics';
import type { VehiclePosition } from '@bus-tracker/shared';

/** Greater Kuala Lumpur — where the map opens before a route is chosen. */
const KL_REGION = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

/** Markers glide between fixes over one poll interval. */
const POSITION_TWEEN_MS = 30_000;
/** Half-size (degrees, ~280 m) of the box framed around a lone point. */
const SINGLE_POINT_SPAN = 0.0025;
const EMPTY_STOPS = new Map<string, { lat: number; lng: number }>();
const NO_POSITIONS: VehiclePosition[] = [];

type Coord = { latitude: number; longitude: number };

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

  // The sheet covers the bottom of the map. At the large detent the map is
  // hidden anyway, so keep the glance framing.
  const sheetHeight = windowHeight * SHEET_DETENTS[Math.min(trip.detent, 1)];
  const legalLabelInsets = useMemo(
    () => ({ top: 0, right: 16, bottom: sheetHeight + 8, left: 16 }),
    [sheetHeight],
  );

  // --- Live bus markers ----------------------------------------------------
  const positions = route ? trip.bus.positions : NO_POSITIONS;
  const markers = useGlidingMarkers(positions, trip.routeCode);
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
  // Frames your stop + the bus heading to it in the area left visible above
  // the sheet and below the toolbar.
  const frameTrip = useCallback(
    (animated: boolean) => {
      const map = mapRef.current;
      if (!map || !route) return;
      const coords: Coord[] = [];
      if (route.userStop) {
        coords.push({
          latitude: route.userStop.stop_lat,
          longitude: route.userStop.stop_lon,
        });
      }
      if (primaryPosition) {
        coords.push({ latitude: primaryPosition.lat, longitude: primaryPosition.lng });
      } else if (ghost.coord) {
        coords.push({ latitude: ghost.coord.lat, longitude: ghost.coord.lng });
      }

      let target: Coord[] = coords.length > 0 ? coords : polyline;
      if (target.length === 1) {
        const c = target[0];
        target = [
          { latitude: c.latitude - SINGLE_POINT_SPAN, longitude: c.longitude - SINGLE_POINT_SPAN },
          { latitude: c.latitude + SINGLE_POINT_SPAN, longitude: c.longitude + SINGLE_POINT_SPAN },
        ];
      }
      if (target.length === 0) return;
      map.fitToCoordinates(target, {
        edgePadding: {
          top: insets.top + 80,
          right: 56,
          bottom: sheetHeight + 32,
          left: 56,
        },
        animated,
      });
    },
    [route, primaryPosition, ghost.coord, polyline, insets.top, sheetHeight],
  );
  const frameRef = useRef(frameTrip);
  frameRef.current = frameTrip;

  // Frame once per route/stop as soon as geometry arrives. The key is only
  // recorded when the frame actually runs, so a re-render that cancels the
  // pending timer just reschedules it.
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!route) return;
    const key = `${route.routeCode}|${route.stopId}`;
    if (framedKey.current === key) return;
    const t = setTimeout(() => {
      framedKey.current = key;
      setUserPanned(false);
      frameRef.current(false);
    }, 50);
    return () => clearTimeout(t);
  }, [route]);

  // Re-frame when the tracked bus or the sheet height changes — unless the
  // user has taken over the camera.
  useEffect(() => {
    if (userPanned) return;
    frameRef.current(true);
  }, [primaryVehicleId, trip.detent, userPanned]);

  const recenter = useCallback(() => {
    haptics.light();
    setUserPanned(false);
    frameRef.current(true);
  }, []);

  // Stable callback over the latest model so the toolbar doesn't rebuild on
  // every countdown tick.
  const shareRef = useRef<() => void>(() => {});
  shareRef.current = () => {
    const m = trip.model;
    if (!m.compact || !trip.stopName) return;
    const how = m.source === 'scheduled' ? 'scheduled' : 'live estimate';
    void Share.share({
      message: `${trip.routeCode} to ${trip.stopName}: ${m.compact} (${how}).`,
    });
  };
  const share = useCallback(() => shareRef.current(), []);

  const selectRoute = useCallback(
    (code: string) => {
      if (code === settings.preferredRouteCode) return;
      haptics.selection();
      settings.setPreferredRouteCode(code);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.preferredRouteCode, settings.setPreferredRouteCode],
  );

  const mapType: MapType = settings.mapType;
  const casing = pick(hex.casing, scheme);
  const labelColor = scheme === 'dark' ? '#FFFFFF' : '#1C1C1E';
  const labelHalo = scheme === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';

  return (
    <View style={styles.root}>
      <MapToolbar
        favorites={settings.favoritedRoutes}
        activeRoute={settings.preferredRouteCode}
        mapType={mapType}
        userPanned={userPanned}
        canShare={trip.model.compact != null}
        onRecenter={recenter}
        onShare={share}
        onSelectRoute={selectRoute}
        onSetMapType={settings.setMapType}
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
        legalLabelInsets={legalLabelInsets}
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
        {markers.map(({ vehicle, region }) => {
          const primary = vehicle.vehicleId === primaryVehicleId;
          const passed = trip.eta.passedVehicleIds.has(vehicle.vehicleId);
          return (
            <BusMarker
              key={vehicle.vehicleId}
              region={region}
              accent={accent}
              primary={primary}
              passed={passed}
              bearing={vehicle.bearing}
              accessibilityLabel={
                primary
                  ? `Your bus, ${trip.model.compact ?? ''}, live`
                  : passed
                    ? 'Bus that has passed your stop'
                    : 'Another bus on this route, live'
              }
            />
          );
        })}
      </MapView>
    </View>
  );
}

interface MapToolbarProps {
  favorites: string[];
  activeRoute: string | null;
  mapType: MapType;
  userPanned: boolean;
  canShare: boolean;
  onRecenter: () => void;
  onShare: () => void;
  onSelectRoute: (code: string) => void;
  onSetMapType: (t: MapType) => void;
}

/**
 * Native glass toolbar over the map: the route switcher (leading) and the
 * recenter / more cluster (trailing). System-drawn, so it gets Liquid Glass,
 * grouping, sizing and accessibility for free. Memoised on primitive props so
 * live data ticks don't rebuild the header items (and close an open menu).
 */
const MapToolbar = memo(function MapToolbar({
  favorites,
  activeRoute,
  mapType,
  userPanned,
  canShare,
  onRecenter,
  onShare,
  onSelectRoute,
  onSetMapType,
}: MapToolbarProps) {
  const router = useRouter();

  return (
    <>
      <Stack.Toolbar placement="left">
        {favorites.length === 0 ? (
          <Stack.Toolbar.Button icon="plus" onPress={() => router.push('/add-route')}>
            <Stack.Toolbar.Label>Add Route</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Menu accessibilityLabel={`Route ${activeRoute ?? ''}. Switch route`}>
            <Stack.Toolbar.Label>{activeRoute ?? 'Route'}</Stack.Toolbar.Label>
            <Stack.Toolbar.Menu inline title="Your routes">
              {favorites.map((code) => (
                <Stack.Toolbar.MenuAction
                  key={code}
                  icon="bus.fill"
                  isOn={code === activeRoute}
                  onPress={() => onSelectRoute(code)}
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
              isOn={mapType === 'standard'}
              onPress={() => onSetMapType('standard')}
            >
              Standard
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="globe.asia.australia"
              isOn={mapType === 'satellite'}
              onPress={() => onSetMapType('satellite')}
            >
              Satellite
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          {canShare ? (
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
});

type NavStateLike = { routes?: { name: string; state?: NavStateLike }[] } | undefined;

function containsRoute(state: NavStateLike, name: string): boolean {
  if (!state?.routes) return false;
  return state.routes.some((r) => r.name === name || containsRoute(r.state, name));
}

/**
 * Presents the persistent trip sheet whenever it isn't on the stack — on
 * launch, and again if anything (e.g. Android back) ever pops it.
 */
function usePresentTripSheet() {
  const router = useRouter();
  const nav = useRootNavigationState();
  const ready = nav?.key != null;
  const hasTrip = containsRoute(nav as NavStateLike, 'trip');
  useEffect(() => {
    if (!ready || hasTrip) return;
    router.push('/trip');
  }, [ready, hasTrip, router]);
}

interface GlidingMarker {
  vehicle: VehiclePosition;
  region: AnimatedRegion;
}

/**
 * One AnimatedRegion per vehicle so markers glide linearly between fixes.
 *
 * A bus that drops out of the feed keeps its marker for one more commit: its
 * animation is stopped first, then it's removed on the following render.
 * Unmounting a marker while its native timing animation is still running
 * trips Fabric's view-recycle assertion. Everything is cleared on route
 * change.
 */
function useGlidingMarkers(
  positions: VehiclePosition[],
  routeCode: string,
): GlidingMarker[] {
  const regions = useRef(new Map<string, AnimatedRegion>());
  const lastSeen = useRef(new Map<string, VehiclePosition>());
  const [, setPruneTick] = useState(0);

  for (const p of positions) {
    lastSeen.current.set(p.vehicleId, p);
    if (!regions.current.has(p.vehicleId)) {
      regions.current.set(
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
    const live = new Set(positions.map((p) => p.vehicleId));
    let pruned = false;
    for (const p of positions) {
      regions.current
        .get(p.vehicleId)
        ?.timing({
          latitude: p.lat,
          longitude: p.lng,
          latitudeDelta: 0,
          longitudeDelta: 0,
          duration: POSITION_TWEEN_MS,
          easing: Easing.linear,
          useNativeDriver: false,
        } as Parameters<AnimatedRegion['timing']>[0])
        .start();
    }
    for (const id of Array.from(regions.current.keys())) {
      if (live.has(id)) continue;
      stopAnimation(regions.current.get(id));
      regions.current.delete(id);
      lastSeen.current.delete(id);
      pruned = true;
    }
    // Drop the now-stopped markers on the next render.
    if (pruned) setPruneTick((n) => n + 1);
  }, [positions]);

  // Route switch: stop and drop every region (cleanup), then re-render so
  // the previous route's markers unmount with their animations already
  // stopped.
  useEffect(() => {
    setPruneTick((n) => n + 1);
    return () => {
      for (const r of regions.current.values()) stopAnimation(r);
      regions.current.clear();
      lastSeen.current.clear();
    };
  }, [routeCode]);

  const out: GlidingMarker[] = [];
  for (const [id, region] of regions.current) {
    const vehicle = lastSeen.current.get(id);
    if (vehicle) out.push({ vehicle, region });
  }
  return out;
}

function stopAnimation(region: AnimatedRegion | undefined) {
  try {
    (region as unknown as { stopAnimation?: () => void })?.stopAnimation?.();
  } catch {
    // best effort
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
