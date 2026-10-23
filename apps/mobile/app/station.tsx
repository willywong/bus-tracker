import { ContentUnavailableView, Host } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { StationDetails, StationLineBadges, useStation } from '@/components/rail/StationDetails';
import { StationPhoto } from '@/components/rail/StationPhoto';
import type { NearbyStopView } from '@/components/rail/stationModel';
import { useOpenRoutePreview } from '@/hooks/useOpenRoutePreview';
import { useRailFocus } from '@/hooks/useRailFocus';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';

/**
 * A rail station over the map (spec §6.4, plan 13/03): photo banner, name
 * and line badges, a departure board per line, walks to other lines and the
 * buses nearby. `/station?station=<RailStation.id>`. Rail is never live, so
 * boards say "every N mins" or "about N mins"; an expired feed says
 * "Timetable unavailable" while the station, its lines and its neighbours
 * still render. No haptics: nothing here is a decision. Nearby opens its
 * stations in the trip sheet instead (`StationView`).
 */
export default function StationScreen() {
  const router = useRouter();
  const trip = useTrip();
  const { station: stationParam } = useLocalSearchParams<{ station?: string | string[] }>();
  const stationId = (Array.isArray(stationParam) ? stationParam[0] : stationParam) ?? '';
  const { model, loading, unavailableText, tripLive, railFocus } = useStation(stationId);

  // While this sheet is focused the map shows the station's lines and frames it.
  useRailFocus(railFocus);

  const openLine = useCallback(
    (routeId: string, dir: 0 | 1) => {
      router.push({ pathname: '/line', params: { line: routeId, dir: String(dir) } });
    },
    [router],
  );
  const openStation = useCallback((id: string) => router.setParams({ station: id }), [router]);

  const routeStops = trip.route?.stopsById;
  const onRouteStop = useCallback(
    (stopId: string) => {
      if (!routeStops?.has(stopId)) return undefined;
      return () => {
        // As `stops.tsx`: close this sheet, then show the stop in the trip sheet.
        router.back();
        if (stopId === trip.stopId) trip.select(null);
        else trip.select({ kind: 'stop', stopId });
      };
    },
    [routeStops, router, trip],
  );
  // Any other bus opens its route's preview from that stop, as a search does.
  const openRoutePreview = useOpenRoutePreview();
  const openRoute = useCallback(
    (n: NearbyStopView) =>
      openRoutePreview({ route: n.route, pattern: n.pattern, fromStopIndex: n.stopIndex }),
    [openRoutePreview],
  );

  const toolbar = (
    <>
      <Stack.Screen options={{ title: '' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
    </>
  );

  if (!model) {
    // A KTM station needs the network; don't call it missing while it loads.
    return (
      <>
        {toolbar}
        {loading ? null : (
          <Host style={styles.empty}>
            <ContentUnavailableView title="Station not found" systemImage="tram.fill" />
          </Host>
        )}
      </>
    );
  }

  const { station } = model;
  return (
    <>
      {toolbar}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <StationPhoto key={station.id} lat={station.lat} lng={station.lng} name={station.name} />

        <View style={styles.header}>
          <Text style={styles.name} accessibilityRole="header">
            {station.name}
          </Text>
          <StationLineBadges lines={model.lines} onOpenLine={openLine} />
        </View>

        <StationDetails
          model={model}
          unavailableText={unavailableText}
          tripLive={tripLive}
          onOpenLine={openLine}
          onOpenStation={openStation}
          onRouteStop={onRouteStop}
          onOpenRoute={openRoute}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.sm,
    rowGap: space.xs,
    paddingTop: space.xxs,
  },
  name: {
    ...type.title,
    flexShrink: 1,
    color: color.label,
  },
  empty: {
    height: 280,
    marginTop: space.xxl,
  },
});
