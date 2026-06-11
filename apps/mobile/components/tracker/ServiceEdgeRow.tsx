import { SymbolView } from 'expo-symbols';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { formatClockHHMM } from './logic';
import { bentoTokens, surfaceColor } from './tokens';

export type ServiceEdgeVariant = 'before-first' | 'after-last';

interface ServiceEdgeRowProps {
  variant: ServiceEdgeVariant;
  /** First bus of today's service, epoch ms (before-first). */
  firstEpochMs?: number | null;
  /** Last bus of today's service, epoch ms (after-last). */
  lastEpochMs?: number | null;
  /** First bus tomorrow (epoch ms) — only shown on after-last when known. */
  firstTomorrowEpochMs?: number | null;
}

export function ServiceEdgeRow({
  variant,
  firstEpochMs,
  lastEpochMs,
  firstTomorrowEpochMs,
}: ServiceEdgeRowProps) {
  let title: string;
  let caption: string;
  if (variant === 'before-first') {
    title =
      firstEpochMs != null
        ? `First bus at ${formatClockHHMM(firstEpochMs)}`
        : 'Service has not started';
    caption = 'Timetable service hasn’t started for the day.';
  } else {
    const last = lastEpochMs != null ? formatClockHHMM(lastEpochMs) : null;
    const firstT =
      firstTomorrowEpochMs != null
        ? formatClockHHMM(firstTomorrowEpochMs)
        : null;
    title = last ? `Service ended · Last bus ${last}` : 'Service ended';
    caption = firstT
      ? `First bus tomorrow at ${firstT}.`
      : 'Check back tomorrow morning.';
  }

  return (
    <GlassGuard
      glassEffectStyle="regular"
      style={[styles.row, !isGlassAvailable() && styles.rowFallback]}
    >
      <SymbolView name="clock.fill" size={22} tintColor="#8E8E93" />
      <View style={styles.textCol}>
        <Text style={styles.title} selectable>
          {title}
        </Text>
        <Text style={styles.caption} selectable>
          {caption}
        </Text>
      </View>
    </GlassGuard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 64,
    gap: 14,
    borderRadius: bentoTokens.tileRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColor.hairline,
    overflow: 'hidden',
  },
  rowFallback: {
    backgroundColor: surfaceColor.grouped,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
  },
});
