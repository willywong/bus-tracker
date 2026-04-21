import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { LiveDot } from '@/components/tracker/LiveDot';
import { sourceColor } from '@/components/tracker/tokens';

export type SourceBadgeKind = 'live' | 'stale' | 'scheduled';

interface SourceBadgeProps {
  kind: SourceBadgeKind;
  /** Override the label text (defaults to the kind in caps). */
  label?: string;
}

const DEFAULT_LABEL: Record<SourceBadgeKind, string> = {
  live: 'Live',
  stale: 'Stale',
  scheduled: 'Scheduled',
};

export function SourceBadge({ kind, label }: SourceBadgeProps) {
  const text = label ?? DEFAULT_LABEL[kind];
  const color = sourceColor[kind];
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        kind === 'scheduled' ? 'Scheduled data' : kind === 'stale' ? 'Stale data' : 'Live data'
      }
    >
      {kind === 'scheduled' ? (
        <SymbolView
          name="clock.fill"
          size={10}
          tintColor={color}
          weight="semibold"
        />
      ) : (
        <LiveDot color={color} size={7} static={kind === 'stale'} />
      )}
      <Text style={[styles.label, { color }]} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
