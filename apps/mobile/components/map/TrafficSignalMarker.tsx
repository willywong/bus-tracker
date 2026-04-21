import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, type LatLng } from 'react-native-maps';

interface TrafficSignalMarkerProps {
  coordinate: LatLng;
}

/**
 * Passive traffic-signal dot. Helps users interpret a stationary bus as
 * "waiting at a red light" instead of "broken down". Not interactive — no
 * callout, no tap target. Data © OpenStreetMap contributors.
 */
function TrafficSignalMarkerImpl({ coordinate }: TrafficSignalMarkerProps) {
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      flat
      zIndex={0}
    >
      <View style={styles.dot} />
    </Marker>
  );
}

export const TrafficSignalMarker = memo(TrafficSignalMarkerImpl);

const SIGNAL_RED = '#D0021B';

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: SIGNAL_RED,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
