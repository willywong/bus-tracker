import { SymbolView } from 'expo-symbols';
import { Animated, StyleSheet, View } from 'react-native';
import {
  AnimatedRegion,
  MapMarker,
  Marker,
  MarkerAnimated as RawMarkerAnimated,
  type MapMarkerProps,
} from 'react-native-maps';

// react-native-maps types MarkerAnimated as `AnimatedComponent<typeof MapMarker>`,
// but RN 0.88's `AnimatedComponent` is generic over props, not the component.
const MarkerAnimated = RawMarkerAnimated as unknown as Animated.AnimatedComponent<
  MapMarkerProps,
  MapMarker
>;

// Marker views are hosted natively by MapKit; DynamicColorIOS / PlatformColor
// don't survive that bridge, so colours arrive as resolved hex strings.

interface BusMarkerProps {
  /** Animated region that glides between position fixes. */
  region: AnimatedRegion;
  accent: string;
  /** The bus heading to your stop — larger and always on top. */
  primary: boolean;
  /** Already past your stop — dimmed so it doesn't read as "your bus". */
  passed: boolean;
  bearing?: number | null;
  accessibilityLabel: string;
  onPress?: () => void;
}

export function BusMarker({
  region,
  accent,
  primary,
  passed,
  bearing,
  accessibilityLabel,
  onPress,
}: BusMarkerProps) {
  const size = primary ? 36 : 28;
  const showHeading =
    !passed && typeof bearing === 'number' && Number.isFinite(bearing);

  return (
    <MarkerAnimated
      coordinate={
        region as unknown as React.ComponentProps<typeof MarkerAnimated>['coordinate']
      }
      flat
      zIndex={primary ? 3 : 2}
      displayPriority="required"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.frame, { opacity: passed ? 0.45 : primary ? 1 : 0.8 }]}>
        {showHeading ? (
          <View
            style={[styles.headingRing, { transform: [{ rotate: `${bearing}deg` }] }]}
            pointerEvents="none"
          >
            <View style={[styles.wedge, { borderBottomColor: accent }]} />
          </View>
        ) : null}
        <View
          style={[
            styles.disc,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: passed ? '#8E8E93' : accent,
            },
          ]}
        >
          <SymbolView
            name="bus.fill"
            size={primary ? 17 : 14}
            weight="semibold"
            tintColor="#FFFFFF"
            resizeMode="scaleAspectFit"
          />
        </View>
      </View>
    </MarkerAnimated>
  );
}

interface GhostBusMarkerProps {
  coordinate: { latitude: number; longitude: number };
  color: string;
  background: string;
}

/**
 * Where the next *scheduled* bus should be when nothing live is reporting.
 * Hollow + dashed so it can never be mistaken for a live bus.
 */
export function GhostBusMarker({ coordinate, color, background }: GhostBusMarkerProps) {
  return (
    <Marker
      coordinate={coordinate}
      flat
      zIndex={1}
      accessibilityLabel="Scheduled bus position, not live"
    >
      <View style={styles.frame}>
        <View
          style={[
            styles.ghost,
            { borderColor: color, backgroundColor: background },
          ]}
        >
          <SymbolView
            name="clock"
            size={13}
            weight="semibold"
            tintColor={color}
            resizeMode="scaleAspectFit"
          />
        </View>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
  },
  headingRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
  },
  wedge: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ghost: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
