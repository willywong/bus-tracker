import type { ScheduledDeparture } from '@/db/queries';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInRight } from 'react-native-reanimated';

import {
  formatClockHHMM,
  formatCountdownShort,
} from './logic';
import { TimetableChip } from './TimetableChip';

interface TimetableStripProps {
  departures: readonly ScheduledDeparture[];
  /** Scheduled-departure tripId matching the live "current" bus — that chip gets the anchor treatment. */
  anchorTripId?: string | null;
  now: number;
}

export function TimetableStrip({
  departures,
  anchorTripId,
  now,
}: TimetableStripProps) {
  if (departures.length === 0) return null;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {departures.map((d, i) => {
          const clock = formatClockHHMM(d.departureEpochMs);
          const minutesFromNow = Math.max(
            0,
            Math.round((d.departureEpochMs - now) / 60_000),
          );
          const countdown = formatCountdownShort(minutesFromNow);
          const isAnchor = d.tripId === anchorTripId;
          return (
            <Animated.View
              key={`${d.tripId}-${d.stopSequence}-${d.departureEpochMs}`}
              entering={FadeInRight.duration(220).delay(i * 30)}
            >
              <TimetableChip
                clock={clock}
                countdown={countdown}
                anchor={isAnchor}
                a11yLabel={`Scheduled departure at ${clock}, ${countdown}${isAnchor ? ', your current bus' : ''}`}
              />
            </Animated.View>
          );
        })}
        <View style={styles.tailSpacer} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  scroll: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  tailSpacer: {
    width: 8,
  },
});
