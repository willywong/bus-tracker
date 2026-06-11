import { StyleSheet, View } from 'react-native';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { ShimmerBar } from '@/components/shared/Skeleton';

import { glassTokens, surfaceColor } from './tokens';

/** Placeholder for the JourneyCard during a route switch. */
export function JourneyCardSkeleton() {
  return (
    <View style={styles.shadow}>
      <GlassGuard
        glassEffectStyle="regular"
        style={[styles.card, !isGlassAvailable() && styles.cardFallback]}
      >
        <View style={styles.header}>
          <ShimmerBar style={styles.ring} delay={0} />
          <ShimmerBar style={styles.statusLabel} delay={80} />
        </View>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.row}>
            <View style={styles.rail}>
              <ShimmerBar style={i === 0 ? styles.busDot : styles.dot} delay={120 + i * 70} />
            </View>
            <ShimmerBar style={[styles.line, i === 3 && styles.lineWide]} delay={160 + i * 70} />
          </View>
        ))}
      </GlassGuard>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: glassTokens.cardRadius,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  card: {
    borderRadius: glassTokens.cardRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    paddingHorizontal: glassTokens.cardPadH,
    paddingTop: 14,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  cardFallback: { backgroundColor: surfaceColor.grouped },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  ring: { width: 18, height: 18, borderRadius: 9 },
  statusLabel: { width: 90, height: 12, borderRadius: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  rail: { width: 30, alignItems: 'center', justifyContent: 'center' },
  busDot: { width: 26, height: 26, borderRadius: 13 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 150, height: 15, borderRadius: 7, marginLeft: 6 },
  lineWide: { width: 200, height: 18 },
});
