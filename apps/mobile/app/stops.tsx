import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { nearestStopIds, RouteStops } from '@/components/trip/OnTheWay';
import { useTrip } from '@/state/TripContext';
import { MARGIN, space } from '@/theme/design';

/**
 * Every stop on the active route, over the trip sheet. Live buses sit at
 * the stop they're nearest; tapping a stop closes this sheet and opens that
 * stop in the trip sheet underneath.
 */
export default function StopsScreen() {
  const router = useRouter();
  const trip = useTrip();
  const stops = trip.route?.stops ?? [];
  const busStopIds = useMemo(
    () => nearestStopIds(trip.bus.positions, stops),
    [trip.bus.positions, stops],
  );

  const open = (stopId: string) => {
    router.back();
    if (stopId === trip.stopId) trip.select(null);
    else if (!(trip.selection?.kind === 'stop' && trip.selection.stopId === stopId)) {
      trip.select({ kind: 'stop', stopId });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: `Stops on ${trip.routeCode}` }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <RouteStops
          stops={stops}
          userStopId={trip.stopId}
          busStopIds={busStopIds}
          onStopPress={open}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MARGIN,
    paddingTop: space.sm,
    paddingBottom: space.xl,
  },
});
