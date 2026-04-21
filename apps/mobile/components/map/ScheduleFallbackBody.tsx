import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { SourceBadge } from '@/components/shared/SourceBadge';
import { formatClockHHMM } from '@/components/tracker/logic';

interface ScheduleFallbackBodyProps {
  /** Minutes from now to the next scheduled departure. */
  minutes: number;
  /** Absolute epoch ms of the next scheduled departure. */
  nextAt: number;
}

export function ScheduleFallbackBody({
  minutes,
  nextAt,
}: ScheduleFallbackBodyProps) {
  return (
    <View style={styles.col}>
      <View style={styles.eyebrowRow}>
        <SourceBadge kind="scheduled" />
        <Text style={styles.eyebrowText} selectable>
          Next scheduled
        </Text>
      </View>
      <View style={styles.numberRow}>
        <Text style={styles.number} selectable allowFontScaling={false}>
          {Math.max(0, minutes)}
        </Text>
        <Text style={styles.unit} selectable>
          min
        </Text>
        <Text style={styles.clock} selectable allowFontScaling={false}>
          · {formatClockHHMM(nextAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  col: {
    flex: 1,
    minWidth: 0,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  eyebrowText: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.2,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  number: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '300',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.2,
  },
  unit: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  clock: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('tertiaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
});
