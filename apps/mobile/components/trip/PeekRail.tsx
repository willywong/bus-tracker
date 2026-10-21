import { SymbolView } from 'expo-symbols';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import type { SourceKind } from '@/components/trip/model';
import { color, hex, pick } from '@/theme/design';

/** Height of the band the rail (or the plain hairline) sits in. */
export const PEEK_RAIL_HEIGHT = 18;
const END = 16;
const TICK = 5;
/** More stops than this would turn into a dotted line; it's a sketch. */
const MAX_TICKS = 12;
const BEAD = 12;

/** Your stop ends the rail as the map's pin; any other stop as its bead. */
export type RailEnd = 'you' | 'stop';

/**
 * The peek's small horizontal journey: the bus on the left, a tick for each
 * stop between, and where it's heading on the right (your stop as the map
 * pin in miniature, another stop as its bead). While the data is fresh, a
 * soft light travels the line from the bus onward, like the route on the
 * map. Decorative: the number beside it carries the meaning.
 */
export function PeekRail({
  stopsAhead,
  source,
  end = 'you',
}: {
  stopsAhead: number;
  source: SourceKind;
  end?: RailEnd;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  const paper = pick(hex.paper, scheme);
  const ticks = Math.min(MAX_TICKS, Math.max(0, stopsAhead));
  const shimmer = source === 'live' && !reduceMotion;

  return (
    <View
      style={styles.rail}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.end}>
        <SymbolView name="bus.fill" size={9} tintColor={color.paper} resizeMode="scaleAspectFit" />
      </View>
      <View style={styles.track}>
        <View style={styles.line} />
        {shimmer ? (
          <Animated.View style={[StyleSheet.absoluteFill, SWEEP]}>
            <View
              style={[
                styles.glint,
                {
                  backgroundImage: `linear-gradient(90deg, ${paper}00 0%, ${paper} 50%, ${paper}00 100%)`,
                },
              ]}
            />
          </Animated.View>
        ) : null}
        <View style={styles.ticks}>
          {Array.from({ length: ticks }, (_, i) => (
            <View key={i} style={styles.tick} />
          ))}
        </View>
      </View>
      {end === 'you' ? (
        <View style={styles.end}>
          <SymbolView
            name="figure.stand"
            size={10}
            weight="semibold"
            tintColor={color.paper}
            resizeMode="scaleAspectFit"
          />
        </View>
      ) : (
        <View style={styles.bead} />
      )}
    </View>
  );
}

// The carrier spans the track and slides from one track-width left of it to
// its own place; the glint rides its right edge, so it crosses the track
// from the bus to your stop. It fades at both ends, then rests.
const SWEEP_KEYFRAMES = {
  '0%': { opacity: 0, transform: [{ translateX: '-100%' }] },
  '8%': { opacity: 1 },
  '50%': { opacity: 1 },
  '58%': { opacity: 0, transform: [{ translateX: '0%' }] },
  '100%': { opacity: 0, transform: [{ translateX: '0%' }] },
};
const SWEEP = {
  animationName: SWEEP_KEYFRAMES,
  animationDuration: 3000,
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as const;

const styles = StyleSheet.create({
  rail: {
    height: PEEK_RAIL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  end: {
    width: END,
    height: END,
    borderRadius: END / 2,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bead: {
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 2.5,
    borderColor: color.ink,
    backgroundColor: color.paper,
  },
  track: {
    flex: 1,
    height: PEEK_RAIL_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: color.ink,
  },
  glint: {
    position: 'absolute',
    right: 0,
    width: 40,
    height: 4,
    top: (PEEK_RAIL_HEIGHT - 4) / 2,
    borderRadius: 2,
  },
  ticks: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  tick: {
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    borderWidth: 1.5,
    borderColor: color.ink,
    backgroundColor: color.paper,
  },
});
