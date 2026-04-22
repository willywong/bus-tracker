import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ShimmerBar } from '@/components/shared/Skeleton';

import { RouteSwitcher } from './RouteSwitcher';
import { trackerSpacing } from './tokens';

const NUMBER_HEIGHT = 130;

interface HeroCountdownSkeletonProps {
  selectedRoute: string | null;
  routeOptions: readonly string[];
  onSelectRoute: (code: string) => void;
  onAddBus: () => void;
  trailing?: ReactNode;
}

/**
 * Mirrors `HeroCountdown` dimensions so the crossfade between skeleton and
 * real content doesn't shift layout. The route-switcher stays live — it
 * already reflects the new selection immediately.
 */
export function HeroCountdownSkeleton({
  selectedRoute,
  routeOptions,
  onSelectRoute,
  onAddBus,
  trailing,
}: HeroCountdownSkeletonProps) {
  return (
    <View style={styles.container}>
      <View style={styles.switcherRow}>
        <RouteSwitcher
          selected={selectedRoute}
          options={routeOptions}
          onSelect={onSelectRoute}
          onAddBus={onAddBus}
        />
        {trailing ? <View style={styles.trailingSlot}>{trailing}</View> : null}
      </View>

      <ShimmerBar style={styles.eyebrowBar} delay={0} />

      <View style={styles.numberClip}>
        <ShimmerBar style={styles.numberBar} delay={120} />
      </View>

      <ShimmerBar style={styles.unitBar} delay={240} />

      <ShimmerBar style={styles.subtitleBar} delay={360} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: trackerSpacing.heroTopPad,
    paddingBottom: trackerSpacing.heroBottomPad,
    alignItems: 'center',
  },
  switcherRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: trackerSpacing.rowH,
    marginBottom: 16,
  },
  trailingSlot: {
    position: 'absolute',
    right: trackerSpacing.rowH,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  eyebrowBar: {
    width: 110,
    height: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  numberClip: {
    height: NUMBER_HEIGHT,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  numberBar: {
    width: 180,
    height: 88,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  unitBar: {
    width: 78,
    height: 14,
    borderRadius: 7,
    marginTop: 6,
  },
  subtitleBar: {
    width: 180,
    height: 14,
    borderRadius: 7,
    marginTop: 18,
  },
});
