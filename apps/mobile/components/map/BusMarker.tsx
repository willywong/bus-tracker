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
// Every marker is a fixed 48pt square with its glyph at the exact centre:
// Apple Maps ignores `anchor` and re-centres views whose size changes.
const FRAME = 48;

interface BusMarkerProps {
  /** Animated region that glides between position fixes. */
  region: AnimatedRegion;
  ink: string;
  paper: string;
  live: string;
  /** The bus heading to your stop — larger, live dot, always on top. */
  primary: boolean;
  /** Already past your stop — faded so it doesn't read as "your bus". */
  passed: boolean;
  bearing?: number | null;
  accessibilityLabel: string;
  onPress?: () => void;
}

/**
 * A live bus in Calm Mono: a paper disc with an ink ring and a direction
 * chevron rotated to the bus's bearing. Your bus gets the green live dot
 * (the app's only colour); other buses are smaller and lighter.
 */
export function BusMarker({
  region,
  ink,
  paper,
  live,
  primary,
  passed,
  bearing,
  accessibilityLabel,
  onPress,
}: BusMarkerProps) {
  const size = primary ? 34 : 28;
  const hasHeading = typeof bearing === 'number' && Number.isFinite(bearing);
  const inset = (FRAME - size) / 2;

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
      <View style={[styles.frame, { opacity: passed ? 0.4 : primary ? 1 : 0.7 }]}>
        <View
          style={[
            styles.disc,
            {
              left: inset,
              top: inset,
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: ink,
              borderWidth: primary ? 2 : 1.5,
              backgroundColor: paper,
            },
          ]}
        >
          {hasHeading ? (
            <View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
              <SymbolView
                name="location.north.fill"
                size={primary ? 15 : 12}
                tintColor={ink}
                resizeMode="scaleAspectFit"
              />
            </View>
          ) : (
            <SymbolView
              name="bus.fill"
              size={primary ? 14 : 11}
              tintColor={ink}
              resizeMode="scaleAspectFit"
            />
          )}
        </View>
        {primary && !passed ? (
          <View
            style={[
              styles.liveDot,
              {
                left: inset + size - 9,
                top: inset - 3,
                backgroundColor: live,
                borderColor: paper,
              },
            ]}
          />
        ) : null}
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
 * A dashed ring with a dot: never filled, never a chevron, so it can't be
 * mistaken for a live bus.
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
        <View style={[styles.ghost, { borderColor: color, backgroundColor: background }]}>
          <View style={[styles.ghostDot, { backgroundColor: color }]} />
        </View>
      </View>
    </Marker>
  );
}

const GHOST = 28;

const styles = StyleSheet.create({
  frame: {
    width: FRAME,
    height: FRAME,
  },
  disc: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  liveDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
  },
  ghost: {
    position: 'absolute',
    left: (FRAME - GHOST) / 2,
    top: (FRAME - GHOST) / 2,
    width: GHOST,
    height: GHOST,
    borderRadius: GHOST / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
