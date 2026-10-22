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
import MapView, { AnimatedRegion, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BusMarker, GhostBusMarker } from '@/components/map/BusMarker';
import { RailLayer } from '@/components/map/RailLayer';
import {
  railLines,
  railStationMarks,
  railStationsFor,
  railZoomBand,
  zoomFromRegion,
  type RailZoomBand,
} from '@/components/map/railModel';
import { RouteLayer, type RailStationMark } from '@/components/map/RouteLayer';
import { RouteShimmer } from '@/components/map/RouteShimmer';
import { splitRoute } from '@/components/map/routeSplit';
import { mapRailFocus } from '@/components/rail/railFocus';
import { shouldPresentTrip, type NavStateLike } from '@/components/trip/sheetStack';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { useRailShapes } from '@/hooks/useRailShapes';
import { useScheduledBusPosition } from '@/hooks/useScheduledBusPosition';
import { useSettings, type MapLayers, type MapType } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import { hex, pick, sheetDetents } from '@/theme/design';
import { haptics } from '@/utils/haptics';
import {
  nearbyRailStations,
  snapToRoute,
  type LatLng,
  type VehiclePosition,
} from '@bus-tracker/shared';

/** Greater Kuala Lumpur — where the map opens before a route is chosen. */
const KL_REGION = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

/** Markers glide between fixes over one poll interval. */
const POSITION_TWEEN_MS = 30_000;
/** No pan events for this long means the finger is off the map. */
const PAN_QUIET_MS = 250;
/** Half-size (degrees, ~280 m) of the box framed around a lone point. */
const SINGLE_POINT_SPAN = 0.0025;
const EMPTY_STOPS = new Map<string, { lat: number; lng: number }>();
const NO_POSITIONS: VehiclePosition[] = [];
const NO_RAIL_STATIONS: RailStationMark[] = [];
/** The station sheet's resting detent (`_layout.tsx`): a focused station is framed above it. */
const STATION_SHEET_DETENT = 0.5;

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
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useLocationPermission();
  usePresentTripSheet();

  const mapRef = useRef<MapView>(null);
  const [userPanned, setUserPanned] = useState(false);

  const ride = useRide();
  // A fresh object each render would defeat RouteLayer's memo while riding.
  const rideDest = ride.active ? ride.destination : null;
  const rideDestination = useMemo(
    () => (rideDest ? { lat: rideDest.lat, lng: rideDest.lng, name: rideDest.name } : null),
    [rideDest?.lat, rideDest?.lng, rideDest?.name],
  );
  const route = trip.route;
  const polyline = useMemo(
    () =>
      route?.polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })) ?? [],
    [route],
  );

  // The sheet covers the bottom of the map. At the large detent the map is
  // hidden anyway, so keep the glance framing.
  const sheetHeight =
    (windowHeight - insets.top) * sheetDetents(windowHeight, insets.top)[Math.min(trip.detent, 1)] +
    (trip.detent === 0 ? insets.bottom : 0);
  const legalLabelInsets = useMemo(
    () => ({ top: 0, right: 16, bottom: sheetHeight + 8, left: 16 }),
    [sheetHeight],
  );

  // --- Rail stations within a short walk of your stop ------------------------
  const railStations = useMemo<RailStationMark[]>(() => {
    const u = route?.userStop;
    if (!u) return [];
    return nearbyRailStations({ lat: u.stop_lat, lng: u.stop_lon }).map(({ station }) => ({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      colors: [...new Set(station.lines.map((l) => l.color))],
    }));
  }, [route?.userStop]);

  // --- Rail layer: every line and station (plan 13/02) ----------------------
  const layers = settings.mapLayers;
  const { network } = useTransitNetwork();
  const railShapes = useRailShapes(network);
  const railLineDraws = useMemo(() => railLines(network, railShapes), [network, railShapes]);
  const railStationDraws = useMemo(() => railStationMarks(railStationsFor(network)), [network]);
  // Zoom matters only at two thresholds, so it's kept as a band and set from
  // onRegionChangeComplete: no render per camera frame.
  const [zoomBand, setZoomBand] = useState<RailZoomBand>(() =>
    railZoomBand(zoomFromRegion(KL_REGION.longitudeDelta, windowWidth)),
  );
  const railDim = zoomBand === 0;
  // An open station or line sheet (plan 13/05), later the itinerary (15/05).
  const focus = trip.railFocus;
  const railFocus = useMemo(
    () => mapRailFocus(focus, railLineDraws.map((l) => l.routeId)),
    [focus, railLineDraws],
  );
  const selectedStationId = focus?.stationId ?? null;
  // Apple Maps stacks overlays in add order and ignores Polyline.zIndex.
  // Whenever the rail lines restyle or change, RailLayer and RouteLayer both
  // remount (RailLayer first), so the bus route is re-added on top of rail.
  const railLinesSig = useMemo(
    () => railLineDraws.map((l) => `${l.routeId}:${l.coords.length}`).join(','),
    [railLineDraws],
  );
  // Rail off: a constant, so zooming across 11 doesn't remount the bus route.
  const railKey = layers.rail
    ? `${railDim}|${railFocus?.join(',') ?? ''}|${layers.rail}|${railLinesSig}`
    : 'rail-off';
  // `navigate`, not `push`: with a station sheet on top, another square
  // updates that sheet's params in place instead of stacking a second one.
  // Otherwise it pushes. (Not `dangerouslySingular` on the screen: that
  // would pull a station out from under an open line sheet to the top.)
  const openStation = useCallback(
    (stationId: string) => router.navigate({ pathname: '/station', params: { station: stationId } }),
    [router],
  );

  // --- Live bus markers ----------------------------------------------------
  // Drawn in the lane, with the arrow along the road (see snapPositions).
  const feedPositions = route ? trip.bus.positions : NO_POSITIONS;
  const routeLine = route?.polyline;
  const positions = useMemo(
    () => snapPositions(feedPositions, routeLine),
    [feedPositions, routeLine],
  );
  const markers = useGlidingMarkers(positions, trip.routeCode);
  // My buses off: stop every glide first and unmount the markers on the next
  // render. Unmounting one mid-animation trips Fabric (see useGlidingMarkers).
  const [busMarkersShown, setBusMarkersShown] = useState(layers.myBuses);
  useEffect(() => {
    if (!layers.myBuses) for (const m of markers) stopAnimation(m.region);
    setBusMarkersShown(layers.myBuses);
    // Only on the toggle; `markers` is this render's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.myBuses]);
  const primaryVehicleId =
    trip.eta.primaryArrival?.kind === 'live'
      ? trip.eta.primaryArrival.live?.vehicleId ?? null
      : null;
  const primaryPosition = positions.find((p) => p.vehicleId === primaryVehicleId);

  // --- Route stretches: behind the bus, on its way to you, past your stop --
  const busLat = primaryPosition?.lat ?? null;
  const busLng = primaryPosition?.lng ?? null;
  const split = useMemo(() => {
    const u = route?.userStop;
    return splitRoute(
      route?.polyline ?? [],
      busLat != null && busLng != null ? { lat: busLat, lng: busLng } : null,
      u ? { lat: u.stop_lat, lng: u.stop_lon } : null,
    );
  }, [route, busLat, busLng]);
  const aheadPath = useMemo(() => split.ahead.flat(), [split]);

  // The shimmer is drawn over the map in screen space, so it hides while the
  // camera moves and re-projects when it settles. State flips only on the
  // transitions, never per frame.
  const [cameraSettled, setCameraSettled] = useState(true);
  const [cameraTick, setCameraTick] = useState(0);
  const cameraMoving = useRef(false);
  const onRegionChange = useCallback(() => {
    if (cameraMoving.current) return;
    cameraMoving.current = true;
    setCameraSettled(false);
  }, []);
  // The sheet holds at peek while the map is dragged (see trip.tsx). It's
  // released once the map settles and the finger is off it: a camera move of
  // our own can settle mid-drag, so wait until pan events have stopped too.
  const { holdPeek, setHoldPeek } = trip;
  const lastPanAt = useRef(0);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
  }, []);
  const onRegionChangeComplete = useCallback((region: Region) => {
    cameraMoving.current = false;
    setCameraSettled(true);
    setCameraTick((t) => t + 1);
    // Same band: React bails out, nothing re-renders for the rail layer.
    setZoomBand(railZoomBand(zoomFromRegion(region.longitudeDelta, windowWidth)));
    if (!holdPeek) return;
    const release = () => {
      const quiet = Date.now() - lastPanAt.current;
      if (quiet >= PAN_QUIET_MS) setHoldPeek(false);
      else releaseTimer.current = setTimeout(release, PAN_QUIET_MS - quiet);
    };
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    release();
  }, [holdPeek, setHoldPeek, windowWidth]);

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

  // --- Selection ------------------------------------------------------------
  // Tapping a stop or bus swaps the sheet to its detail; tapping your own
  // stop goes back to the trip.
  const { select, selection } = trip;
  const selectStop = useCallback(
    (stopId: string) => select({ kind: 'stop', stopId }),
    [select],
  );
  const clearSelection = useCallback(() => select(null), [select]);
  const selectBus = useCallback(
    (vehicleId: string) => select({ kind: 'bus', vehicleId }),
    [select],
  );
  const selectedStopId = selection?.kind === 'stop' ? selection.stopId : null;
  const selectedBusId = selection?.kind === 'bus' ? selection.vehicleId : null;
  const selectedPoint = useMemo(() => {
    if (selectedStopId) {
      const s = route?.stops.find((x) => x.stop_id === selectedStopId);
      return s ? { lat: s.stop_lat, lng: s.stop_lon } : null;
    }
    if (selectedBusId) {
      const v = positions.find((p) => p.vehicleId === selectedBusId);
      return v ? { lat: v.lat, lng: v.lng } : null;
    }
    return null;
  }, [selectedStopId, selectedBusId, route, positions]);
  const selectionKey = selectedStopId ?? selectedBusId;

  // --- Camera ---------------------------------------------------------------
  // Frames your stop + the bus heading to it (or the selected stop or bus)
  // in the area left visible above the sheet and below the toolbar. An open
  // station frames the station and your stop above its 0.5 sheet instead.
  const focusPoint = focus?.point ?? null;
  const frameTrip = useCallback(
    (animated: boolean) => {
      const map = mapRef.current;
      if (!map || (!route && !focusPoint)) return;
      const coords: Coord[] = [];
      if (route?.userStop) {
        coords.push({
          latitude: route.userStop.stop_lat,
          longitude: route.userStop.stop_lon,
        });
      }
      let bottom = sheetHeight + 32;
      if (focusPoint) {
        coords.push({ latitude: focusPoint.lat, longitude: focusPoint.lng });
        bottom = (windowHeight - insets.top) * STATION_SHEET_DETENT + 32;
      } else if (selectedPoint) {
        coords.push({ latitude: selectedPoint.lat, longitude: selectedPoint.lng });
      } else if (primaryPosition) {
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
          bottom,
          left: 56,
        },
        animated,
      });
    },
    [
      route,
      focusPoint,
      primaryPosition,
      selectedPoint,
      ghost.coord,
      polyline,
      insets.top,
      sheetHeight,
      windowHeight,
    ],
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

  // A new selection (or going back) always re-frames, even after a pan.
  const lastSelection = useRef(selectionKey);
  useEffect(() => {
    if (lastSelection.current === selectionKey) return;
    lastSelection.current = selectionKey;
    setUserPanned(false);
    frameRef.current(true);
  }, [selectionKey]);

  // Opening, switching or closing a station or line re-frames too; closing
  // goes back to the trip.
  const focusKey = focus?.stationId ?? focus?.routeIds.join() ?? null;
  const lastFocus = useRef(focusKey);
  useEffect(() => {
    if (lastFocus.current === focusKey) return;
    lastFocus.current = focusKey;
    setUserPanned(false);
    frameRef.current(true);
  }, [focusKey]);

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
  // Satellite imagery is dark and busy whatever the system scheme, so map
  // overlays use the dark (white ink) palette on it.
  const mapScheme = mapType === 'satellite' ? 'dark' : scheme;
  const ink = pick(hex.ink, mapScheme);
  const mapPaper = pick(hex.mapPaper, mapScheme);
  const casing = pick(hex.casing, mapScheme);

  return (
    <View style={styles.root}>
      <MapToolbar
        favorites={settings.favoritedRoutes}
        activeRoute={settings.preferredRouteCode}
        mapType={mapType}
        myBusesOn={layers.myBuses}
        railOn={layers.rail}
        userPanned={userPanned}
        canShare={trip.model.compact != null}
        onRecenter={recenter}
        onShare={share}
        onSelectRoute={selectRoute}
        onSetMapType={settings.setMapType}
        onSetMapLayer={settings.setMapLayer}
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
          lastPanAt.current = Date.now();
          // Moving the map means looking at it: get the sheet out of the way
          // until the map settles.
          if (trip.detent === 1 && !trip.holdPeek) trip.setHoldPeek(true);
        }}
        onRegionChange={onRegionChange}
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {/* First child: rail sits under the bus route (see railKey). */}
        {layers.rail ? (
          <RailLayer
            key={railKey}
            lines={railLineDraws}
            stations={railStationDraws}
            focus={railFocus}
            dim={railDim}
            showAllStations={zoomBand === 2}
            paper={mapPaper}
            ink={ink}
            selectedStationId={selectedStationId}
            onStationPress={openStation}
          />
        ) : null}
        {route && layers.myBuses ? (
          <RouteLayer
            key={`${route.routeCode}|${route.stopId}|${railKey}`}
            polyline={polyline}
            split={split}
            stops={route.stops}
            userStop={route.userStop}
            destination={rideDestination}
            railStations={layers.rail ? NO_RAIL_STATIONS : railStations}
            ink={ink}
            inkMuted={`${ink}59`}
            casing={casing}
            paper={mapPaper}
            selectedStopId={selectedStopId}
            onStopPress={selectStop}
            onUserStopPress={clearSelection}
          />
        ) : null}
        {route && layers.myBuses && ghost.coord && positions.length === 0 ? (
          <GhostBusMarker
            coordinate={{ latitude: ghost.coord.lat, longitude: ghost.coord.lng }}
            color={ink}
            background={mapPaper}
          />
        ) : null}
        {(busMarkersShown ? markers : []).map(({ vehicle, region }) => {
          const primary = vehicle.vehicleId === primaryVehicleId;
          const passed = trip.eta.passedVehicleIds.has(vehicle.vehicleId);
          return (
            <BusMarker
              key={vehicle.vehicleId}
              region={region}
              ink={ink}
              paper={mapPaper}
              live={pick(hex.live, mapScheme)}
              primary={primary}
              passed={passed}
              bearing={vehicle.bearing}
              selected={vehicle.vehicleId === selectedBusId}
              vehicleId={vehicle.vehicleId}
              onSelect={selectBus}
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
      {route && layers.myBuses ? (
        <RouteShimmer
          mapRef={mapRef}
          path={aheadPath}
          settled={cameraSettled && trip.detent < 2}
          cameraTick={cameraTick}
          color={mapPaper}
        />
      ) : null}
    </View>
  );
}

interface MapToolbarProps {
  favorites: string[];
  activeRoute: string | null;
  mapType: MapType;
  myBusesOn: boolean;
  railOn: boolean;
  userPanned: boolean;
  canShare: boolean;
  onRecenter: () => void;
  onShare: () => void;
  onSelectRoute: (code: string) => void;
  onSetMapType: (t: MapType) => void;
  onSetMapLayer: (key: keyof MapLayers, on: boolean) => void;
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
  myBusesOn,
  railOn,
  userPanned,
  canShare,
  onRecenter,
  onShare,
  onSelectRoute,
  onSetMapType,
  onSetMapLayer,
}: MapToolbarProps) {
  const router = useRouter();
  // Each toggle is a decision: a selection tick, then the change.
  const toggleLayer = (key: keyof MapLayers, on: boolean) => {
    haptics.selection();
    onSetMapLayer(key, on);
  };
  const toggleSatellite = () => {
    haptics.selection();
    onSetMapType(mapType === 'satellite' ? 'standard' : 'satellite');
  };

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
        <Stack.Toolbar.Menu icon="square.3.layers.3d" accessibilityLabel="Map layers">
          <Stack.Toolbar.MenuAction
            icon="bus.fill"
            isOn={myBusesOn}
            onPress={() => toggleLayer('myBuses', !myBusesOn)}
          >
            My buses
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="bus" disabled subtitle="Soon">
            Buses nearby
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="tram.fill"
            isOn={railOn}
            onPress={() => toggleLayer('rail', !railOn)}
          >
            Rail lines
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="globe.asia.australia"
            isOn={mapType === 'satellite'}
            onPress={toggleSatellite}
          >
            Satellite
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon={userPanned ? 'location' : 'location.fill'}
          accessibilityLabel="Recenter map"
          onPress={onRecenter}
        />
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
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

/**
 * Presents the persistent trip sheet whenever it isn't on the stack — on
 * launch, and again if anything (e.g. Android back) ever pops it. It waits
 * while a station or line sheet is open (a cold `t816://station/…`), and
 * comes back once they close.
 */
function usePresentTripSheet() {
  const router = useRouter();
  const nav = useRootNavigationState();
  const ready = nav?.key != null;
  const present = shouldPresentTrip(nav as NavStateLike);
  useEffect(() => {
    if (!ready || !present) return;
    router.push('/trip');
  }, [ready, present, router]);
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
  /** Where each marker is gliding to, so a repeated fix doesn't restart it. */
  const targets = useRef(new Map<string, LatLng>());
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
      // A bus that's stopped reporting repeats its last fix: hold it there.
      // Re-timing to the same point would restart the glide and drag out
      // whatever is left of it.
      const target = targets.current.get(p.vehicleId);
      if (target && target.lat === p.lat && target.lng === p.lng) continue;
      targets.current.set(p.vehicleId, { lat: p.lat, lng: p.lng });
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
      targets.current.delete(id);
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
      targets.current.clear();
    };
  }, [routeCode]);

  const out: GlidingMarker[] = [];
  for (const [id, region] of regions.current) {
    const vehicle = lastSeen.current.get(id);
    if (vehicle) out.push({ vehicle, region });
  }
  return out;
}

/**
 * Puts each bus on the route line. Raw GPS wanders a lane or two off the
 * road, and a bus that's stopped reporting would sit wherever its last fix
 * fell. Snapped, it's drawn in the lane, its arrow follows the road, and a
 * glide between two fixes stays close to the line. A fix well off the route
 * (a detour, a depot) is left where it is.
 *
 * Buses are never moved on timetable alone: no live fix, no movement.
 */
function snapPositions(
  positions: VehiclePosition[],
  polyline: readonly LatLng[] | undefined,
): VehiclePosition[] {
  if (!polyline || polyline.length < 2 || positions.length === 0) return positions;
  return positions.map((p) => {
    const snap = snapToRoute({ lat: p.lat, lng: p.lng }, polyline, { heading: p.bearing });
    return snap.snapped
      ? { ...p, lat: snap.point.lat, lng: snap.point.lng, bearing: snap.bearing }
      : p;
  });
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
