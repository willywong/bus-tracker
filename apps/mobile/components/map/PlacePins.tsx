import type { LatLng, TransitNetwork } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { MAX_PLACES, type NearbyPlace } from '@/components/sheet/nearby/model';

/** Fixed sizes, glyph centred (Apple Maps ignores `anchor`). */
const PIN = 20;
/** Invisible tap frame around a pin. */
const PIN_HIT = 32;
const SELECTED = 22;
/** A place this close to your stop is your stop: its pin already marks it. */
const SAME_STOP_M = 40;

/** Where a place is on the map: a stop's nearest member stop, a station's own point. */
export function placeCoord(net: TransitNetwork, place: NearbyPlace): LatLng | null {
  if (place.kind === 'stop') {
    const s = place.stopIndexes[0];
    return s == null ? null : { lat: net.stops.lat[s], lng: net.stops.lon[s] };
  }
  const st = net.stations.find((x) => x.id === place.stationId);
  return st ? { lat: st.lat, lng: st.lng } : null;
}

interface PlacePinsProps {
  places: readonly NearbyPlace[];
  network: TransitNetwork;
  ink: string;
  paper: string;
  /** A stop pushes its view in the sheet; a station opens its sheet, as the rows do. */
  onPress: (place: NearbyPlace) => void;
  /** Your stop, drawn by `RouteLayer`: no second pin on it. */
  userStop?: LatLng | null;
}

/**
 * Small pins for the places Nearby lists (plan 17/05; board A): a stop as a
 * paper disc with a bus glyph (round like the route's stops, the glyph saying
 * it's one of the list's), a station as a ring in its first line's colour.
 * Your stop is skipped: its own pin marks it. One per listed place (at most `MAX_PLACES`); tapping one
 * opens it as its row does. Pins never move the camera.
 *
 * Markers only: no overlay, so their stacking against `RailLayer` doesn't
 * matter. Keyed by the place, so the list refreshing its times leaves them
 * mounted.
 */
export const PlacePins = memo(function PlacePins({
  places,
  network,
  ink,
  paper,
  onPress,
  userStop = null,
}: PlacePinsProps) {
  const pins = useMemo(
    () =>
      places.slice(0, MAX_PLACES).flatMap((place) => {
        const at = placeCoord(network, place);
        if (!at || (userStop && metresBetween(at, userStop) < SAME_STOP_M)) return [];
        return [{ place, coord: { latitude: at.lat, longitude: at.lng } }];
      }),
    [places, network, userStop],
  );
  return (
    <>
      {pins.map(({ place, coord }) => (
        <Marker
          key={place.key}
          coordinate={coord}
          flat
          zIndex={1}
          displayPriority="required"
          onPress={() => onPress(place)}
          accessibilityLabel={place.kind === 'stop' ? `${place.name}, bus stop` : `${place.name} station`}
        >
          <View collapsable={false} style={styles.hit}>
            {place.kind === 'stop' ? (
              <View style={[styles.stop, { borderColor: ink, backgroundColor: paper }]}>
                <SymbolView name="bus.fill" size={10} weight="semibold" tintColor={ink} />
              </View>
            ) : (
              <View
                style={[
                  styles.station,
                  { borderColor: place.lines[0]?.color ?? ink, backgroundColor: paper },
                ]}
              />
            )}
          </View>
        </Marker>
      ))}
    </>
  );
});

interface PlaceWalkProps {
  from: LatLng;
  to: LatLng;
  name: string;
  ink: string;
  paper: string;
}

/**
 * The stop view's walk (plan 17/05, step 6): a dotted ink straight line from
 * you to the stop, and the stop as a selected (solid) marker. Apple's
 * walking path is out of scope here. Mounted after `RailLayer` and keyed
 * with its key, as every overlay that must sit on top of rail is.
 */
export const PlaceWalk = memo(function PlaceWalk({ from, to, name, ink, paper }: PlaceWalkProps) {
  const coords = useMemo(
    () => [
      { latitude: from.lat, longitude: from.lng },
      { latitude: to.lat, longitude: to.lng },
    ],
    [from.lat, from.lng, to.lat, to.lng],
  );
  return (
    <>
      {/* Its key carries the ends: a new fix remounts the line rather than changing it in place. */}
      <Polyline
        key={`walk-${from.lat},${from.lng}`}
        coordinates={coords}
        strokeColor={ink}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        lineDashPattern={[0.1, 6]}
      />
      <Marker
        coordinate={coords[1]}
        tracksViewChanges={false}
        flat
        zIndex={2}
        displayPriority="required"
        accessibilityLabel={`${name}, bus stop`}
      >
        <View collapsable={false} style={styles.hit}>
          <View style={[styles.selected, { borderColor: paper, backgroundColor: ink }]}>
            <SymbolView name="bus.fill" size={11} weight="semibold" tintColor={paper} />
          </View>
        </View>
      </Marker>
    </>
  );
});

/** Straight-line metres, flat-earth: plenty at a stop's scale. */
function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const styles = StyleSheet.create({
  hit: {
    width: PIN_HIT,
    height: PIN_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
  },
  station: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 3,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
  },
  selected: {
    width: SELECTED,
    height: SELECTED,
    borderRadius: SELECTED / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
});
