import { ContentUnavailableView, Host } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { LineBadge } from '@/components/rail/LineBadge';
import { StationBoard } from '@/components/rail/StationBoard';
import { StationPhoto } from '@/components/rail/StationPhoto';
import { InterchangeRows, NearbyRows, type TripLive } from '@/components/rail/StationRows';
import { buildStationSheet } from '@/components/rail/stationModel';
import { Section } from '@/components/trip/SheetBody';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';

/**
 * A rail station over the map (spec §6.4, plan 13/03): photo banner, name
 * and line badges, a departure board per line, walks to other lines and the
 * buses nearby. `/station?station=<RailStation.id>`. Rail is never live, so
 * boards say "every N mins" or "about N mins"; an expired feed says
 * "Timetable unavailable" while the station, its lines and its neighbours
 * still render. No haptics: nothing here is a decision.
 */
export default function StationScreen() {
  const router = useRouter();
  const trip = useTrip();
  const { network, health, status } = useTransitNetwork();
  const { station: stationParam } = useLocalSearchParams<{ station?: string | string[] }>();
  const stationId = (Array.isArray(stationParam) ? stationParam[0] : stationParam) ?? '';

  const model = useMemo(
    () =>
      buildStationSheet({
        net: network,
        health,
        stationId,
        now: trip.now,
        tripRouteCode: trip.routeCode || null,
        tripStopId: trip.stopId || null,
      }),
    [network, health, stationId, trip.now, trip.routeCode, trip.stopId],
  );

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
  const tripLive: TripLive | null = trip.model.compact
    ? { compact: trip.model.compact, source: trip.model.source }
    : null;

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
    const loading = network == null && (status === 'loading' || status === 'refreshing');
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
  const building = model.reason === 'no-network' && network == null && (status === 'loading' || status === 'refreshing');
  const unavailableText = building ? 'Getting the timetable…' : 'Timetable unavailable';

  return (
    <>
      {toolbar}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <StationPhoto key={station.id} lat={station.lat} lng={station.lng} name={station.name} />

        <View style={styles.header}>
          <Text style={styles.name} accessibilityRole="header">
            {station.name}
          </Text>
          <View style={styles.badges}>
            {model.lines.map((l) => {
              const routeId = l.routeId;
              return (
                <LineBadge
                  key={l.line.name}
                  line={l.line}
                  onPress={routeId ? () => openLine(routeId, 0) : undefined}
                />
              );
            })}
          </View>
        </View>

        {model.boards.map((b) => (
          <StationBoard
            key={b.line.name}
            board={b}
            unavailable={model.unavailable}
            unavailableText={unavailableText}
            onOpenLine={openLine}
          />
        ))}
        {model.unavailableNote ? <Text style={styles.note}>{model.unavailableNote}</Text> : null}

        {model.interchanges.length > 0 ? (
          <Section title="Walk to other lines">
            <InterchangeRows items={model.interchanges} onOpen={openStation} />
          </Section>
        ) : null}

        {model.nearby.length > 0 ? (
          <Section title="Buses nearby">
            <NearbyRows items={model.nearby} tripLive={tripLive} onRouteStop={onRouteStop} />
          </Section>
        ) : null}
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
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  note: {
    ...type.footnote,
    color: color.secondaryLabel,
    marginTop: -space.xs,
  },
  empty: {
    height: 280,
    marginTop: space.xxl,
  },
});
