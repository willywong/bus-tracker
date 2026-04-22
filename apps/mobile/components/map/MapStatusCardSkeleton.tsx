import { DynamicColorIOS, StyleSheet, View } from 'react-native';

import { GlassGuard } from '@/components/GlassGuard';
import { ShimmerBar } from '@/components/shared/Skeleton';

const SCRIM_COLOR = DynamicColorIOS({
  light: 'rgba(255, 255, 255, 0.5)',
  dark: 'rgba(0, 0, 0, 0.45)',
});

export function MapStatusCardSkeleton() {
  return (
    <GlassGuard
      style={styles.card}
      glassEffectStyle="regular"
      blurIntensity={60}
    >
      <View style={styles.scrim} />
      <View style={styles.inner}>
        <View style={styles.statusRow}>
          <ShimmerBar style={styles.statusDot} delay={0} />
          <ShimmerBar style={styles.statusBar} delay={120} />
        </View>

        <View style={styles.bodyRow}>
          <View style={styles.heroCol}>
            <ShimmerBar style={styles.eyebrowBar} delay={240} />
            <ShimmerBar style={styles.numberBar} delay={360} />
          </View>
          <ShimmerBar style={styles.distanceBar} delay={480} />
        </View>

        <View style={styles.metaRow}>
          <ShimmerBar style={styles.metaBar} delay={600} />
        </View>
      </View>
    </GlassGuard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SCRIM_COLOR,
  },
  inner: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusBar: {
    width: 96,
    height: 10,
    borderRadius: 5,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
  },
  heroCol: {
    flex: 1,
    gap: 8,
  },
  eyebrowBar: {
    width: 120,
    height: 12,
    borderRadius: 6,
  },
  numberBar: {
    width: 140,
    height: 28,
    borderRadius: 8,
  },
  distanceBar: {
    width: 78,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaBar: {
    width: 220,
    height: 12,
    borderRadius: 6,
  },
});
