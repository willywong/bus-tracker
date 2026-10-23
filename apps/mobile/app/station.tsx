import { Button, ContentUnavailableView, Host, HStack, Image } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { StationDetails, StationLineBadges, useStation } from '@/components/rail/StationDetails';
import { StationPhoto } from '@/components/rail/StationPhoto';
import type { NearbyStopView } from '@/components/rail/stationModel';
import { useOpenRoutePreview } from '@/hooks/useOpenRoutePreview';
import { useRailFocus } from '@/hooks/useRailFocus';
import { HERE, usePlanner } from '@/state/PlannerContext';
import { useTrip } from '@/state/TripContext';
import { color, hex, MARGIN, pick, space, type } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/**
 * A rail station over the map (spec §6.4, plan 13/03): its name over its
 * kind ("MRT station") with the line badges, Directions and Line map as
 * Liquid Glass buttons, the photo banner, a departure board per line, walks
 * to other lines and the buses nearby. Name and actions lead, so the
 * smallest detent shows what the station is and what you can do there. `/station?station=<RailStation.id>`. Rail is never live, so
 * boards say "every N mins" or "about N mins"; an expired feed says
 * "Timetable unavailable" while the station, its lines and its neighbours
 * still render. No haptics: nothing here is a decision. Nearby opens its
 * stations in the trip sheet instead (`StationView`).
 */
export default function StationScreen() {
  const router = useRouter();
  const trip = useTrip();
  const planner = usePlanner();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
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

  // Our own top row (the native header is off in the layout): the name
  // sits in line with the close button rather than a header's height below it.
  const close = () => router.back();

  if (!model) {
    // A KTM station needs the network; don't call it missing while it loads.
    return (
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>
        <TopBar title={null} subtitle={null} onClose={close} scheme={scheme} />
        {loading ? null : (
          <Host style={styles.empty}>
            <ContentUnavailableView title="Station not found" systemImage="tram.fill" />
          </Host>
        )}
      </ScrollView>
    );
  }

  const { station } = model;
  const firstLine = model.lines.find((l) => l.routeId != null)?.routeId ?? null;
  const directions = () => {
    haptics.selection();
    // From where you are, not wherever the last plan started.
    planner.setFrom(HERE);
    planner.setTo({
      kind: 'station',
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      ref: station.id,
    });
    router.push('/plan');
  };
  return (
    // The scroll view is the sheet's root, as the trip sheet's is: the sheet
    // lays it out, and the top row scrolls with it.
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>
      <TopBar
        title={station.name}
        subtitle={
          <View style={styles.subtitle}>
            <StationLineBadges lines={model.lines} onOpenLine={openLine} size="small" />
            <Text style={styles.kind}>{stationKind(model.lines.map((l) => l.line.code))}</Text>
          </View>
        }
        onClose={close}
        scheme={scheme}
      />

      <Host matchContents>
        <HStack spacing={10}>
          <Button
            label="Directions"
            systemImage="arrow.triangle.turn.up.right.diamond.fill"
            onPress={directions}
            modifiers={[
              buttonStyle('glassProminent'),
              controlSize('large'),
              tint(pick(hex.ink, scheme)),
              // Paper on ink, so the label holds when dark mode makes the ink white.
              foregroundStyle(pick(hex.paper, scheme)),
              accessibilityHint(`Plans a trip to ${station.name}`),
            ]}
          />
          {firstLine ? (
            <Button
              label="Line map"
              systemImage="point.topleft.down.to.point.bottomright.curvepath"
              onPress={() => openLine(firstLine, 0)}
              modifiers={[
                buttonStyle('glass'),
                controlSize('large'),
                tint(pick(hex.ink, scheme)),
                accessibilityHint('Shows the whole line'),
              ]}
            />
          ) : null}
        </HStack>
      </Host>

      <StationPhoto key={station.id} lat={station.lat} lng={station.lng} name={station.name} />

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
  );
}

/**
 * The sheet's top row: the station's name over its line badges and kind
 * ("KG MRT station"), and a Liquid Glass close button beside them, as Apple
 * Maps' place cards have it.
 */
function TopBar({
  title,
  subtitle,
  onClose,
  scheme,
}: {
  title: string | null;
  /** Under the name, tight: the line badges and the station's kind. */
  subtitle: ReactNode;
  onClose: () => void;
  scheme: 'light' | 'dark';
}) {
  return (
    <View style={styles.topBar}>
      <View style={styles.titleBlock}>
        <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
          {title ?? ''}
        </Text>
        {subtitle}
      </View>
      <Host matchContents>
        <Button
          onPress={onClose}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('large'),
            tint(pick(hex.ink, scheme)),
            accessibilityLabel('Close'),
          ]}
        >
          <Image systemName="xmark" size={15} />
        </Button>
      </Host>
    </View>
  );
}

/** "MRT station", "LRT and MRT station": the modes from the lines' codes ("MRT KG"). */
function stationKind(codes: readonly string[]): string {
  const modes = [...new Set(codes.map((c) => c.trim().split(/\s+/)[0]).filter(Boolean))];
  return modes.length ? `${modes.join(' and ')} station` : 'Station';
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  // Clear of the grabber; the name's first line centres on the close button.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  name: {
    ...type.title,
    color: color.label,
  },
  subtitle: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 4,
  },
  kind: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  empty: {
    height: 280,
    marginTop: space.xxl,
  },
});
