import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color } from '@/theme/design';

import type { Segment } from './results';

const HEIGHT = 4;
const MIN_SEGMENT = 6;
const DOT = 3;
const DOT_PITCH = 7;

/**
 * The proportional journey bar (spec §6.2): one 4pt segment per leg, sized
 * by time with a 6pt floor. Bus is ink, rail its line colour, a walk a row
 * of ink dots, and the wait before the first ride a hairline. Decorative:
 * the row's spoken label already says all of it.
 */
export function JourneyBar({ segments }: { segments: readonly Segment[] }) {
  return (
    <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {segments.map((s, i) => (
        <View key={i} style={[styles.segment, { flexGrow: s.seconds }]}>
          {s.kind === 'walk' ? (
            <Dots />
          ) : s.kind === 'wait' ? (
            <View style={styles.wait} />
          ) : (
            <View style={[styles.fill, { backgroundColor: s.kind === 'rail' && s.color ? s.color : color.ink }]} />
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * Dots counted from the measured width. Not `borderStyle: 'dotted'`: iOS
 * draws that only when all four borders match.
 */
function Dots() {
  const [count, setCount] = useState(0);
  return (
    <View
      style={styles.dots}
      onLayout={(e) => {
        const n = Math.max(1, Math.floor((e.nativeEvent.layout.width + DOT_PITCH - DOT) / DOT_PITCH));
        if (n !== count) setCount(n);
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.dot} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEIGHT,
    gap: 2,
  },
  segment: {
    flexBasis: 0,
    minWidth: MIN_SEGMENT,
    height: HEIGHT,
    justifyContent: 'center',
  },
  fill: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
  },
  wait: {
    height: 1,
    backgroundColor: color.hairline,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DOT_PITCH - DOT,
    height: HEIGHT,
    overflow: 'hidden',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: color.ink,
  },
});
