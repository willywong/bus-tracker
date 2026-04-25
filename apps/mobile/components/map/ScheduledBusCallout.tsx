import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import { formatClockHHMM } from '@/components/tracker/logic';

interface ScheduledBusCalloutProps {
  routeCode: string;
  /** Absolute epoch ms of the scheduled departure at the user's stop. */
  scheduledEpochMs: number;
  now?: number;
  hidden?: boolean;
}

export function ScheduledBusCallout({
  routeCode,
  scheduledEpochMs,
  now = Date.now(),
  hidden = false,
}: ScheduledBusCalloutProps) {
  const clock = formatClockHHMM(scheduledEpochMs);
  const minutesAway = Math.max(0, Math.round((scheduledEpochMs - now) / 60_000));

  return (
    <Callout tooltip>
      <View style={[styles.wrap, hidden && styles.hidden]}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.kicker}>Next scheduled</Text>
            <Text style={styles.route} numberOfLines={1}>
              {routeCode}
            </Text>
          </View>
          <Text style={styles.timeRow} selectable>
            <Text style={styles.timeNumber}>{clock}</Text>
            <Text style={styles.timeUnit}>
              {minutesAway > 0 ? ` · in ${minutesAway} min` : ' · now'}
            </Text>
          </Text>
          <Text style={styles.footer}>Estimated from timetable</Text>
        </View>
        <View style={styles.tail} />
      </View>
    </Callout>
  );
}

const CARD_BG = '#FFFFFF';

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  hidden: { opacity: 0 },
  card: {
    backgroundColor: CARD_BG,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    minWidth: 220,
    maxWidth: 260,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
  },
  header: {
    gap: 0,
    marginBottom: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  route: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.2,
  },
  timeRow: {
    marginBottom: 6,
  },
  timeNumber: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  timeUnit: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3A3A3C',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8E8E93',
    fontStyle: 'italic',
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CARD_BG,
    marginTop: -1,
  },
});
