import { ScrollView, StyleSheet, View } from 'react-native';

import { ShimmerBar } from '@/components/shared/Skeleton';

import { surfaceColor } from './tokens';

const PLACEHOLDER_COUNT = 5;

/**
 * Row of chip-shaped shimmer bars matching `TimetableChip`'s 92×60 footprint
 * so the crossfade to the real `TimetableStrip` doesn't shift layout.
 */
export function TimetableStripSkeleton() {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
          <View key={i} style={styles.chipWrap}>
            <View style={styles.chip}>
              <ShimmerBar style={styles.clockBar} delay={i * 90} />
              <ShimmerBar style={styles.countdownBar} delay={i * 90 + 60} />
            </View>
          </View>
        ))}
        <View style={styles.tailSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  scroll: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  chipWrap: {
    marginRight: 10,
  },
  chip: {
    width: 92,
    height: 60,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    backgroundColor: surfaceColor.grouped,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  clockBar: {
    width: 56,
    height: 16,
    borderRadius: 8,
  },
  countdownBar: {
    width: 44,
    height: 10,
    borderRadius: 5,
  },
  tailSpacer: {
    width: 8,
  },
});
