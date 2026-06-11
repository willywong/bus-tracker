import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { surfaceColor } from './tokens';

interface AuroraBackdropProps {
  /** Hex color the glow tints toward — usually from `statusColor(screenStatus)`. */
  glowColor: string;
  children: ReactNode;
}

/**
 * A soft, state-colored glow behind the Tracker's glass tiles. Liquid Glass
 * only refracts when there's something colorful behind it, so we float a few
 * large, low-opacity colored circles over the dark canvas. The color animates
 * between states (green approaching → amber holding → red slipping → blue
 * schedule/walk) so a glance at the whole screen reads the bus's mood.
 *
 * No gradient library required — the "radial" softness comes from stacking a
 * couple of concentric circles at low opacity.
 */
export function AuroraBackdrop({ glowColor, children }: AuroraBackdropProps) {
  // Animate a 0→1 progress between the previous and next color each time
  // `glowColor` changes, then interpolate on the UI thread.
  const fromColor = useSharedValue(glowColor);
  const toColor = useSharedValue(glowColor);
  const t = useSharedValue(1);

  useEffect(() => {
    if (toColor.value === glowColor) return;
    fromColor.value = toColor.value;
    toColor.value = glowColor;
    t.value = 0;
    t.value = withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) });
  }, [glowColor, fromColor, toColor, t]);

  const color = useDerivedValue(() =>
    interpolateColor(t.value, [0, 1], [fromColor.value, toColor.value]),
  );

  const blobTop = useAnimatedStyle(() => ({ backgroundColor: color.value }));
  const blobSide = useAnimatedStyle(() => ({ backgroundColor: color.value }));

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.blob, styles.blobTop, blobTop]} />
        <Animated.View style={[styles.blob, styles.blobTopInner, blobTop]} />
        <Animated.View style={[styles.blob, styles.blobSide, blobSide]} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surfaceColor.canvas,
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
  },
  // Big soft wash up top, behind the ring/status row.
  blobTop: {
    width: 460,
    height: 460,
    top: -180,
    left: -60,
    opacity: 0.16,
  },
  // A tighter, slightly brighter core for a pseudo-radial falloff.
  blobTopInner: {
    width: 240,
    height: 240,
    top: -70,
    left: 40,
    opacity: 0.2,
  },
  // A secondary glow on the lower-right to keep the whole screen alive.
  blobSide: {
    width: 320,
    height: 320,
    top: 220,
    right: -140,
    opacity: 0.12,
  },
});
