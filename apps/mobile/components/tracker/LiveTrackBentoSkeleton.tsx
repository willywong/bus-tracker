import { StyleSheet, View } from 'react-native';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { ShimmerBar } from '@/components/shared/Skeleton';

import { bentoTokens, surfaceColor } from './tokens';

/**
 * Tile-shaped placeholder for the bento during a route switch — mirrors the
 * grid so the crossfade to the live tiles doesn't shift pixels.
 */
export function LiveTrackBentoSkeleton() {
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <Tile style={styles.ringTile}>
          <ShimmerBar style={styles.ring} delay={0} />
        </Tile>
        <Tile style={styles.statusTile}>
          <ShimmerBar style={styles.lineSm} delay={80} />
          <ShimmerBar style={styles.lineMd} delay={160} />
          <ShimmerBar style={styles.lineSm} delay={240} />
        </Tile>
      </View>
      <Tile style={styles.wideTile}>
        <ShimmerBar style={styles.lineSm} delay={300} />
        <ShimmerBar style={styles.chart} delay={360} />
      </Tile>
      <View style={styles.row}>
        <Tile style={styles.halfTile}>
          <ShimmerBar style={styles.lineSm} delay={420} />
          <ShimmerBar style={styles.lineLg} delay={480} />
        </Tile>
        <Tile style={styles.halfTile}>
          <ShimmerBar style={styles.lineSm} delay={520} />
          <ShimmerBar style={styles.lineLg} delay={580} />
        </Tile>
      </View>
    </View>
  );
}

function Tile({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <GlassGuard
      glassEffectStyle="regular"
      style={[styles.tile, !isGlassAvailable() && styles.tileFallback, style]}
    >
      {children}
    </GlassGuard>
  );
}

const styles = StyleSheet.create({
  grid: { gap: bentoTokens.gap },
  row: { flexDirection: 'row', gap: bentoTokens.gap, alignItems: 'stretch' },
  tile: {
    borderRadius: bentoTokens.tileRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    padding: bentoTokens.tilePad,
    overflow: 'hidden',
  },
  tileFallback: { backgroundColor: surfaceColor.grouped },
  ringTile: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  statusTile: { flex: 1, justifyContent: 'center', gap: 10 },
  wideTile: { gap: 8 },
  halfTile: { flex: 1, gap: 8, minHeight: 92, justifyContent: 'center' },
  ring: {
    width: bentoTokens.ringSize,
    height: bentoTokens.ringSize,
    borderRadius: bentoTokens.ringSize / 2,
  },
  chart: {
    width: '100%',
    height: bentoTokens.tilePad + 58,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  lineSm: { width: 90, height: 11, borderRadius: 5 },
  lineMd: { width: 150, height: 16, borderRadius: 7 },
  lineLg: { width: 120, height: 22, borderRadius: 7 },
});
