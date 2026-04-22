import { StyleSheet, View } from 'react-native';

import { ShimmerBar } from '@/components/shared/Skeleton';

import { surfaceColor, trackerSpacing } from './tokens';

/**
 * Placeholder for `CurrentBusCard` during a route switch. Matches the card
 * chrome (padding, radius, hairline border, inset tray) so the crossfade to
 * the real card doesn't shift pixels.
 */
export function CurrentBusCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.sectionPad}>
        <View style={styles.statusRow}>
          <ShimmerBar style={styles.statusDot} delay={0} />
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

      <View style={styles.tray}>
        <View style={styles.infoGrid}>
          <View style={styles.infoRow}>
            <InfoCellSkeleton delay={400} />
            <InfoCellSkeleton delay={460} />
          </View>
          <View style={styles.infoRow}>
            <InfoCellSkeleton delay={520} />
            <InfoCellSkeleton delay={580} />
          </View>
        </View>
      </View>
    </View>
  );
}

function InfoCellSkeleton({ delay }: { delay: number }) {
  return (
    <View style={styles.infoCell}>
      <ShimmerBar style={styles.infoLabelBar} delay={delay} />
      <ShimmerBar style={styles.infoValueBar} delay={delay + 40} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: surfaceColor.grouped,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  sectionPad: {
    paddingVertical: trackerSpacing.cardSectionV,
    gap: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: surfaceColor.hairline as unknown as string,
    marginHorizontal: -18,
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
  statusLabel: {
    width: 90,
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
    width: 96,
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
    width: 110,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  inlineClockBar: {
    width: 80,
    height: 14,
    borderRadius: 7,
  },
  tray: {
    backgroundColor: surfaceColor.inset,
    marginHorizontal: -18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
  },
  infoGrid: {
    gap: 14,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 16,
  },
  infoCell: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  infoLabelBar: {
    width: 60,
    height: 10,
    borderRadius: 5,
  },
  infoValueBar: {
    width: 84,
    height: 14,
    borderRadius: 7,
  },
});
