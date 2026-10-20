import { StyleSheet, Text, View } from 'react-native';

import type { ScheduledDeparture } from '@/db/queries';
import { color, space, type } from '@/theme/design';

interface TimetableProps {
  departures: ScheduledDeparture[];
  formatClock: (epochMs: number) => string;
  /** Scheduled trip the live bus is matched to, marked with the live dot. */
  liveTripId: string | null;
  firstBusToday: number | null;
  lastBusToday: number | null;
}

/**
 * Today's remaining departures as a quiet grid of clock times: light weight,
 * tabular digits, the next one in semibold, the live-matched one with the
 * green dot. No box around it.
 */
export function Timetable({
  departures,
  formatClock,
  liveTripId,
  firstBusToday,
  lastBusToday,
}: TimetableProps) {
  if (departures.length === 0) return null;
  const bounds = [
    firstBusToday != null ? `First ${formatClock(firstBusToday)}` : null,
    lastBusToday != null ? `Last ${formatClock(lastBusToday)}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {departures.map((d, i) => {
          const isLive = d.tripId === liveTripId;
          return (
            <View
              key={`${d.tripId}-${d.serviceDayMidnightUtcMs}`}
              style={styles.cell}
              accessible
              accessibilityLabel={`${formatClock(d.departureEpochMs)}${isLive ? ', live bus' : ''}${i === 0 ? ', next' : ''}`}
            >
              <Text style={[styles.time, i === 0 && styles.timeNext]}>
                {formatClock(d.departureEpochMs)}
              </Text>
              {isLive ? <View style={styles.liveDot} /> : null}
            </View>
          );
        })}
      </View>
      {bounds.length > 0 ? <Text style={styles.bounds}>{bounds.join(' · ')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingTop: space.xxs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.sm,
  },
  cell: {
    width: '20%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  time: {
    ...type.body,
    fontWeight: '300',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  timeNext: {
    fontWeight: '600',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.live,
  },
  bounds: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
