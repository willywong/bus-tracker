import { SymbolView } from 'expo-symbols';
import { forwardRef } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { MapMarker, Marker, type LatLng } from 'react-native-maps';

import { tokens } from '@/theme/tokens';

interface ScheduledBusMarkerProps {
  coordinate: LatLng;
  children?: React.ReactNode;
  onPress?: () => void;
}

/**
 * "Ghost" marker for the next scheduled bus when no live GPS exists for it.
 * Visually distinct from the live marker (hollow + dashed accent border +
 * lower opacity) so users read it as an estimate, not a real position.
 */
export const ScheduledBusMarker = forwardRef<
  MapMarker,
  ScheduledBusMarkerProps
>(function ScheduledBusMarker(
  { coordinate, children, onPress }: ScheduledBusMarkerProps,
  ref,
) {
  return (
    <Marker
      ref={ref}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      calloutAnchor={{ x: 0.5, y: 0 }}
      tracksViewChanges={false}
      flat
      zIndex={1}
      onPress={onPress}
    >
      <View style={styles.marker}>
        <SymbolView
          name="bus.fill"
          size={16}
          tintColor={accentColor}
          resizeMode="scaleAspectFit"
        />
      </View>
      {children}
    </Marker>
  );
});

const accentColor = tokens.color.accent as ColorValue;
const accentString = '#0A84FF';

const styles = StyleSheet.create({
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: accentString,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
  },
});
