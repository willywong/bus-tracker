import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type ColorValue } from 'react-native';
import {
  AnimatedRegion,
  MapMarker,
  MarkerAnimated,
} from 'react-native-maps';

import { tokens } from '@/theme/tokens';

interface LiveBusMarkerProps {
  /** Animated region tracking the live GPS position. */
  region: AnimatedRegion;
  /**
   * True when this specific bus has passed the user's selected stop. Swaps
   * the marker to a gray dashed treatment to signal "already gone, no longer
   * your bus." Per-frame stateless classification — the parent recomputes it
   * each render from `eta.passedVehicleIds`.
   */
  isPassed: boolean;
  /** Compass bearing (degrees) — drives the heading arrow ring on live buses. Hidden when passed. */
  bearing?: number | null;
  markerRef?: (marker: MapMarker | null) => void;
  onPress?: () => void;
  children?: React.ReactNode;
}

/**
 * Live bus marker. Two visual states sharing the same 44×44 frame (with a
 * 32×32 inner disc) so the pin doesn't jitter when isPassed flips:
 *   - approaching: solid accent-blue disc with white bus icon + white border,
 *     plus an outer heading-arrow ring when bearing is known.
 *   - passed: hollow white disc, dashed gray border, muted gray icon, no
 *     heading ring. Reads as "de-emphasized" without alarming. Visually
 *     distinct from ScheduledBusMarker (which uses the same hollow+dashed
 *     vocabulary but in blue) so users don't confuse "ghost scheduled bus"
 *     with "passed bus."
 */
export function LiveBusMarker({
  region,
  isPassed,
  bearing,
  markerRef,
  onPress,
  children,
}: LiveBusMarkerProps) {
  const showBearing =
    !isPassed &&
    typeof bearing === 'number' &&
    Number.isFinite(bearing);

  return (
    <MarkerAnimated
      ref={markerRef}
      coordinate={
        region as unknown as React.ComponentProps<
          typeof MarkerAnimated
        >['coordinate']
      }
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      calloutAnchor={{ x: 0.5, y: 0 }}
      tracksViewChanges={false}
      onPress={onPress}
    >
      <View style={styles.wrap}>
        <View style={isPassed ? styles.markerPassed : styles.markerLive}>
          <SymbolView
            name="bus.fill"
            size={18}
            tintColor={isPassed ? passedIconColor : '#FFFFFF'}
            resizeMode="scaleAspectFit"
          />
        </View>
        {showBearing ? (
          <View
            style={[
              styles.headingRing,
              { transform: [{ rotate: `${bearing}deg` }] },
            ]}
            pointerEvents="none"
          >
            <SymbolView
              name="location.north.fill"
              size={10}
              tintColor={busColor}
              resizeMode="scaleAspectFit"
              style={styles.headingArrow}
            />
          </View>
        ) : null}
      </View>
      {children}
    </MarkerAnimated>
  );
}

const busColor = tokens.color.accent as ColorValue;
// Hardcoded hex for the passed state: dashed borders and RGBA fills don't
// survive RN's iOS DynamicColor bridging in the native MapMarker host.
const passedBorderColor = '#8E8E93';
const passedIconColor = '#8E8E93';

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerLive: {
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
  markerPassed: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: passedBorderColor,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
  },
  headingRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
  },
  headingArrow: {
    marginTop: -2,
  },
});
