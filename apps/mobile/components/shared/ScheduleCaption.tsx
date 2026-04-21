import type { ScheduleDelay } from '@bus-tracker/shared';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { formatClockHHMM, formatDeltaMin } from '@/components/tracker/logic';

interface ScheduleCaptionProps {
  /** Absolute epoch ms of the scheduled departure. */
  scheduledAt: number | null;
  /** Delay vs schedule; produces the "+3 min" / "on time" suffix. */
  delay: ScheduleDelay | null;
  /** Optional extra text appended (e.g. trip id). */
  suffix?: string;
}

export function ScheduleCaption({
  scheduledAt,
  delay,
  suffix,
}: ScheduleCaptionProps) {
  if (scheduledAt == null) return null;
  const clock = formatClockHHMM(scheduledAt);
  const delta = formatDeltaMin(delay);
  const parts = [`Scheduled ${clock}`];
  if (delta) parts.push(delta);
  if (suffix) parts.push(suffix);
  return (
    <View style={styles.row}>
      <Text style={styles.text} selectable allowFontScaling={false}>
        {parts.join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
  },
});
