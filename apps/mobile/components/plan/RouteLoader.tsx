import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { color } from '@/theme/design';

const TRACK = 64;
const BEAD = 6;
const LOOP_MS = 900;
const STAGGER_MS = 150;

/** One bead's run along the track: it fades in, travels, fades out. */
const TRAVEL = {
  '0%': { opacity: 0, transform: [{ translateX: 0 }] },
  '20%': { opacity: 1 },
  '80%': { opacity: 1 },
  '100%': { opacity: 0, transform: [{ translateX: TRACK - BEAD }] },
};

/**
 * "Finding routes" (spec §7.7): three ink beads travel a short hairline,
 * like buses along a route; never a spinner. Shown only when `plan()` takes
 * more than 150 ms. A Reanimated CSS animation, so it runs on the UI thread
 * while the JS thread steps the engine. Static beads under Reduce Motion.
 */
export function RouteLoader() {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.wrap} accessible accessibilityRole="progressbar" accessibilityLabel="Finding routes">
      <View style={styles.track}>
        <View style={styles.line} />
        {[0, 1, 2].map((i) =>
          reduceMotion ? (
            <View key={i} style={[styles.bead, { transform: [{ translateX: (i + 1) * (TRACK / 4) - BEAD / 2 }] }]} />
          ) : (
            <Animated.View
              key={i}
              style={[
                styles.bead,
                {
                  opacity: 0,
                  animationName: TRAVEL,
                  animationDuration: LOOP_MS,
                  animationDelay: i * STAGGER_MS,
                  animationIterationCount: 'infinite',
                  animationTimingFunction: 'ease-in-out',
                },
              ]}
            />
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  track: {
    width: TRACK,
    height: BEAD,
    justifyContent: 'center',
  },
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
  },
  bead: {
    position: 'absolute',
    left: 0,
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    backgroundColor: color.ink,
  },
});
