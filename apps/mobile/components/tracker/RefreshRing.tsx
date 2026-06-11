import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { LiveDot } from '@/components/tracker/LiveDot';
import { glassTokens } from '@/components/tracker/tokens';

interface RefreshRingProps {
  /**
   * Fraction of the poll window still remaining, 0..1 (1 = just refreshed, 0 =
   * an update is due now). Null hides the sweep — render a plain dot, e.g. when
   * the store isn't polling.
   */
  remainingFraction: number | null;
  /** Sweep + ring accent color (usually the live/stale source color). */
  color: string;
  /** Center dot color. */
  dotColor: string;
  /** Render the center dot static (no pulse). */
  dotStatic?: boolean;
  size?: number;
  stroke?: number;
}

/**
 * A compact countdown ring around the live status dot. A small accent dot
 * sweeps once around the track over each ~30 s poll window so the user can see
 * at a glance how fresh the live data is and when the next update lands —
 * built with Reanimated (no SVG dependency).
 */
export function RefreshRing({
  remainingFraction,
  color,
  dotColor,
  dotStatic,
  size = glassTokens.ringSize,
  stroke = glassTokens.ringStroke,
}: RefreshRingProps) {
  const angle = useSharedValue(0);
  const orbit = Math.max(4, stroke + 3);

  useEffect(() => {
    if (remainingFraction == null) return;
    // Elapsed sweep: full window → 0°, due now → 360°. Clockwise from 12 o'clock.
    const target = (1 - Math.max(0, Math.min(1, remainingFraction))) * 360;
    angle.value = withTiming(target, {
      duration: 320,
      easing: Easing.out(Easing.quad),
    });
  }, [angle, remainingFraction]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }],
  }));

  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <View
        style={[
          styles.track,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
            borderColor: color,
            opacity: 0.28,
          },
        ]}
      />
      {remainingFraction != null ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.sweep, { width: size, height: size }, spinStyle]}
        >
          <View
            style={{
              width: orbit,
              height: orbit,
              borderRadius: orbit / 2,
              backgroundColor: color,
              marginTop: -(orbit / 2 - stroke / 2),
            }}
          />
        </Animated.View>
      ) : null}
      <LiveDot color={dotColor} size={Math.round(size * 0.34)} static={dotStatic} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
  },
  sweep: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});
