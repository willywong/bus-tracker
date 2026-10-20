import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import type { ScheduledDeparture } from '@/db/queries';
import { color, radius, space, type } from '@/theme/design';

interface TimetableProps {
  departures: ScheduledDeparture[];
  formatClock: (epochMs: number) => string;
  /** Scheduled trip the live bus is matched to, marked with the live glyph. */
  liveTripId: string | null;
  firstBusToday: number | null;
  lastBusToday: number | null;
}

/**
 * Today's departures at your stop as a calm grid of clock times — the next
 * one emphasised, the live-matched one marked. Tabular digits so columns
 * line up.
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
    <View style={styles.group}>
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
              {isLive ? (
                <SymbolView
                  name="dot.radiowaves.left.and.right"
                  size={11}
                  tintColor={color.live}
                  weight="semibold"
                />
              ) : null}
            </View>
          );
        })}
      </View>
      {bounds.length > 0 ? (
        <Text style={styles.bounds}>{bounds.join(' · ')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.group,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
    padding: space.md,
    gap: space.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.sm,
  },
  cell: {
    width: '25%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  time: {
    ...type.body,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  timeNext: {
    color: color.label,
    fontWeight: '600',
  },
  bounds: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
