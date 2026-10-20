import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { formatStopName } from '@/components/map/format';
import type { StopRow } from '@/db/queries';

export interface RailStationMark {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Official line colours, one dot each. */
  colors: string[];
}

interface RouteLayerProps {
  polyline: { latitude: number; longitude: number }[];
  stops: StopRow[];
  userStop: StopRow | null;
  /** Where you get off, while riding. */
  destination: { lat: number; lng: number; name: string } | null;
  railStations: RailStationMark[];
  ink: string;
  casing: string;
  /** Marker fill, close to the map so markers read as outlines. */
  paper: string;
  labelHalo: string;
}

// Apple Maps ignores `anchor` and centres every marker view on its
// coordinate, re-centring when the view's size changes. So every marker
// here has a fixed size with its glyph at the exact centre.
const DOT = 10;
const RING = 24;
const LABEL_GAP = 4;
const LABEL_HEIGHT = 16;
const LABEL_BAND = LABEL_GAP + LABEL_HEIGHT;
const LABELLED_WIDTH = 168;
const RAIL = 20;
const DEST = 26;

/**
 * Static route geometry in Calm Mono: a thin ink line with a soft casing,
 * hollow rings for stops, a ring-and-dot for your stop (the one labelled
 * marker), a square for where you get off, and small squares with line-colour
 * dots for rail stations near your stop.
 *
 * Mounted only while the geometry matches the active route — the parent
 * unmounts it during a route switch rather than swapping coordinates in place
 * (rapid Polyline prop changes are fragile under Fabric).
 */
export const RouteLayer = memo(function RouteLayer({
  polyline,
  stops,
  userStop,
  destination,
  railStations,
  ink,
  casing,
  paper,
  labelHalo,
}: RouteLayerProps) {
  if (polyline.length < 2) return null;
  return (
    <>
      <Polyline
        coordinates={polyline}
        strokeColor={casing}
        strokeWidth={7}
        lineCap="round"
        lineJoin="round"
        zIndex={0}
      />
      <Polyline
        coordinates={polyline}
        strokeColor={ink}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        zIndex={0}
      />
      {stops.map((s) =>
        s.stop_id === userStop?.stop_id ? null : (
          <Marker
            key={s.stop_id}
            coordinate={{ latitude: s.stop_lat, longitude: s.stop_lon }}
            flat
            zIndex={1}
            displayPriority="low"
            accessibilityLabel={`Stop: ${formatStopName(s.stop_name)}`}
          >
            <View style={[styles.stopRing, { borderColor: ink, backgroundColor: paper }]} />
          </Marker>
        ),
      )}
      {railStations.map((r) => (
        <Marker
          key={`rail-${r.id}`}
          coordinate={{ latitude: r.lat, longitude: r.lng }}
          flat
          zIndex={1}
          displayPriority="high"
          accessibilityLabel={`Rail station: ${r.name}`}
        >
          <View
            style={[
              styles.rail,
              { borderColor: ink, backgroundColor: paper, width: RAIL + (r.colors.length - 1) * 9 },
            ]}
          >
            {r.colors.map((c) => (
              <View key={c} style={[styles.railDot, { backgroundColor: c }]} />
            ))}
          </View>
        </Marker>
      ))}
      {destination ? (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lng }}
          zIndex={2}
          displayPriority="required"
          accessibilityLabel={`Where you get off: ${destination.name}`}
        >
          <View style={[styles.dest, { borderColor: ink, backgroundColor: paper }]}>
            <View style={[styles.destCore, { backgroundColor: ink }]} />
          </View>
        </Marker>
      ) : null}
      {userStop ? (
        // Symmetric: an empty band above the ring as tall as the label below
        // it keeps the ring exactly on the stop at every zoom level.
        <Marker
          coordinate={{ latitude: userStop.stop_lat, longitude: userStop.stop_lon }}
          zIndex={2}
          displayPriority="required"
          accessibilityLabel={`Your stop: ${formatStopName(userStop.stop_name)}`}
        >
          <View style={styles.userStopWrap}>
            <View style={styles.labelBand} />
            <View style={[styles.userRing, { borderColor: ink }]}>
              <View style={[styles.userDot, { backgroundColor: ink }]} />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.userStopLabel, { color: ink, textShadowColor: labelHalo }]}
            >
              {formatStopName(userStop.stop_name)}
            </Text>
          </View>
        </Marker>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  stopRing: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
  rail: {
    height: RAIL,
    borderRadius: 4,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  railDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dest: {
    width: DEST,
    height: DEST,
    borderRadius: 4,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destCore: {
    width: 9,
    height: 9,
    borderRadius: 1.5,
  },
  userStopWrap: {
    alignItems: 'center',
    width: LABELLED_WIDTH,
    height: RING + 2 * LABEL_BAND,
  },
  labelBand: {
    height: LABEL_BAND,
  },
  userRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  userStopLabel: {
    marginTop: LABEL_GAP,
    width: LABELLED_WIDTH,
    height: LABEL_HEIGHT,
    lineHeight: LABEL_HEIGHT,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
