import { StyleSheet, View } from 'react-native';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { ShimmerBar } from '@/components/shared/Skeleton';

import { glassTokens, surfaceColor, trackerSpacing } from './tokens';

/**
 * Placeholder for `LiveTrackCard` during a route switch. Matches the glass card
 * chrome (radius, hairline border, section rhythm) so the crossfade to the real
 * card doesn't shift pixels.
 */
export function LiveTrackCardSkeleton() {
  return (
    <View style={styles.shadow}>
      <GlassGuard
        glassEffectStyle="regular"
        style={[styles.card, !isGlassAvailable() && styles.cardFallback]}
      >
        <View style={styles.sectionPad}>
          <View style={styles.statusRow}>
            <ShimmerBar style={styles.ring} delay={0} />
            <ShimmerBar style={styles.statusLabel} delay={80} />
            <View style={styles.flexSpacer} />
            <ShimmerBar style={styles.statusMeta} delay={160} />
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.sectionPad}>
          <ShimmerBar style={styles.eyebrowBar} delay={160} />
          <View style={styles.arrivalRow}>
            <ShimmerBar style={styles.valueBar} delay={240} />
            <ShimmerBar style={styles.inlineClockBar} delay={320} />
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.sectionPad}>
          <ShimmerBar style={styles.eyebrowBar} delay={360} />
          <ShimmerBar style={styles.trendBar} delay={420} />
        </View>

        <View style={styles.divider} />

        <View style={styles.sectionPad}>
          <ShimmerBar style={styles.motionBar} delay={520} />
        </View>
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
    overflow: 'hidden',
  },
  cardFallback: {
    backgroundColor: surfaceColor.grouped,
  },
  sectionPad: {
    paddingVertical: trackerSpacing.cardSectionV,
    gap: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: surfaceColor.hairline as unknown as string,
    marginHorizontal: -glassTokens.cardPadH,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ring: {
    width: glassTokens.ringSize,
    height: glassTokens.ringSize,
    borderRadius: glassTokens.ringSize / 2,
  },
  statusLabel: {
    width: 80,
    height: 11,
    borderRadius: 5,
  },
  statusMeta: {
    width: 74,
    height: 11,
    borderRadius: 5,
  },
  flexSpacer: {
    flex: 1,
  },
  eyebrowBar: {
    width: 110,
    height: 11,
    borderRadius: 5,
  },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 2,
  },
  valueBar: {
    width: 120,
    height: 42,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  inlineClockBar: {
    width: 80,
    height: 14,
    borderRadius: 7,
  },
  trendBar: {
    width: '100%',
    height: glassTokens.trendChartHeight,
    borderRadius: 10,
    borderCurve: 'continuous',
    marginTop: 2,
  },
  motionBar: {
    width: 200,
    height: 14,
    borderRadius: 7,
  },
});
