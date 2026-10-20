import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { formatStopName } from '@/components/map/format';
import type { StopRow } from '@/db/queries';

interface RouteLayerProps {
  polyline: { latitude: number; longitude: number }[];
  stops: StopRow[];
  userStop: StopRow | null;
  accent: string;
  casing: string;
  stopFill: string;
  labelColor: string;
  labelHalo: string;
}

/**
 * Static route geometry: a cased polyline, a small dot per stop, and the
 * user's boarding stop as the one labelled, emphasised marker.
 *
 * Mounted only while the geometry matches the active route — the parent
 * unmounts it during a route switch rather than swapping coordinates in place
 * (rapid Polyline prop changes are fragile under Fabric).
 */
export const RouteLayer = memo(function RouteLayer({
  polyline,
  stops,
  userStop,
  accent,
  casing,
  stopFill,
  labelColor,
  labelHalo,
}: RouteLayerProps) {
  if (polyline.length < 2) return null;
  return (
    <>
      <Polyline
        coordinates={polyline}
        strokeColor={casing}
        strokeWidth={8}
        lineCap="round"
        lineJoin="round"
        zIndex={0}
      />
      <Polyline
        coordinates={polyline}
        strokeColor={accent}
        strokeWidth={5}
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
            <View style={[styles.stopDot, { borderColor: accent, backgroundColor: stopFill }]} />
          </Marker>
        ),
      )}
      {userStop ? (
        // Apple Maps ignores `anchor` and centres the marker view on the
        // coordinate, re-centring it whenever the view's size changes. So the
        // view has a fixed size and is symmetric: an empty band above the dot
        // as tall as the label below it puts the dot exactly on the stop at
        // every zoom level.
        <Marker
          coordinate={{ latitude: userStop.stop_lat, longitude: userStop.stop_lon }}
          zIndex={2}
          displayPriority="required"
          accessibilityLabel={`Your stop: ${formatStopName(userStop.stop_name)}`}
        >
          <View style={styles.userStopWrap}>
            <View style={styles.labelBand} />
            <View style={[styles.userStop, { backgroundColor: accent }]}>
              <View style={[styles.userStopCore, { backgroundColor: '#FFFFFF' }]} />
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.userStopLabel,
                {
                  color: labelColor,
                  textShadowColor: labelHalo,
                },
              ]}
            >
              {formatStopName(userStop.stop_name)}
            </Text>
          </View>
        </Marker>
      ) : null}
    </>
  );
});

const DOT = 20;
const LABEL_GAP = 4;
const LABEL_HEIGHT = 16;
const LABEL_BAND = LABEL_GAP + LABEL_HEIGHT;
const USER_STOP_WIDTH = 168;

const styles = StyleSheet.create({
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  userStopWrap: {
    alignItems: 'center',
    width: USER_STOP_WIDTH,
    height: DOT + 2 * LABEL_BAND,
  },
  labelBand: {
    height: LABEL_BAND,
  },
  userStop: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
  },
  userStopCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  userStopLabel: {
    marginTop: LABEL_GAP,
    width: USER_STOP_WIDTH,
    height: LABEL_HEIGHT,
    lineHeight: LABEL_HEIGHT,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
