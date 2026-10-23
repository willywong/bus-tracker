import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { LineBadge } from '@/components/rail/LineBadge';
import { StationBoard } from '@/components/rail/StationBoard';
import { InterchangeRows, NearbyRows, type TripLive } from '@/components/rail/StationRows';
import type { RailFocus } from '@/components/rail/railFocus';
import {
  buildStationSheet,
  type NearbyStopView,
  type StationLine,
  type StationSheetModel,
} from '@/components/rail/stationModel';
import { Section } from '@/components/trip/SheetBody';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useTrip } from '@/state/TripContext';
import { color, space, type } from '@/theme/design';

/**
 * A station's model and what its sheet says around it, for the station
 * sheet over the map and Nearby's station view in the trip sheet.
 * `loading`: there's no model yet because the network is still coming, so
 * don't call the station missing.
 */
export function useStation(stationId: string): {
  model: StationSheetModel | null;
  loading: boolean;
  unavailableText: string;
  tripLive: TripLive | null;
  railFocus: RailFocus | null;
} {
  const trip = useTrip();
  const { network, health, status } = useTransitNetwork();
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
  // The map shows the station's lines and frames it.
  const railFocus = useMemo<RailFocus | null>(
    () =>
      model
        ? {
            stationId: model.station.id,
            routeIds: [...new Set(model.lines.flatMap((l) => (l.routeId ? [l.routeId] : [])))],
            point: { lat: model.station.lat, lng: model.station.lng },
          }
        : null,
    [model],
  );
  const building = network == null && (status === 'loading' || status === 'refreshing');
  return {
    model,
    loading: model == null && building,
    unavailableText:
      model?.reason === 'no-network' && building ? 'Getting the timetable…' : 'Timetable unavailable',
    tripLive: trip.model.compact ? { compact: trip.model.compact, source: trip.model.source } : null,
    railFocus,
  };
}

/** The station's line badges; each opens its line. */
export function StationLineBadges({
  lines,
  onOpenLine,
  size = 'regular',
  style,
}: {
  lines: readonly StationLine[];
  onOpenLine: (routeId: string, dir: 0 | 1) => void;
  size?: 'regular' | 'small';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badges, style]}>
      {lines.map((l) => {
        const routeId = l.routeId;
        return (
          <LineBadge
            key={l.line.name}
            line={l.line}
            size={size}
            onPress={routeId ? () => onOpenLine(routeId, 0) : undefined}
          />
        );
      })}
    </View>
  );
}

/**
 * Under a station's name: a departure board per line, the footnote when the
 * timetable is unavailable, the walks to other lines and the buses nearby.
 * Siblings, so they take the parent's gap.
 */
export function StationDetails({
  model,
  unavailableText,
  tripLive,
  onOpenLine,
  onOpenStation,
  onRouteStop,
  onOpenRoute,
}: {
  model: StationSheetModel;
  unavailableText: string;
  tripLive: TripLive | null;
  onOpenLine: (routeId: string, dir: 0 | 1) => void;
  onOpenStation: (stationId: string) => void;
  onRouteStop: (stopId: string) => (() => void) | undefined;
  onOpenRoute: (stop: NearbyStopView) => void;
}) {
  return (
    <>
      {model.boards.map((b) => (
        <StationBoard
          key={b.line.name}
          board={b}
          unavailable={model.unavailable}
          unavailableText={unavailableText}
          onOpenLine={onOpenLine}
        />
      ))}
      {model.unavailableNote ? <Text style={styles.note}>{model.unavailableNote}</Text> : null}

      {model.interchanges.length > 0 ? (
        <Section title="Walk to other lines">
          <InterchangeRows items={model.interchanges} onOpen={onOpenStation} />
        </Section>
      ) : null}

      {model.nearby.length > 0 ? (
        <Section title="Buses nearby">
          <NearbyRows
            items={model.nearby}
            tripLive={tripLive}
            onRouteStop={onRouteStop}
            onOpenRoute={onOpenRoute}
          />
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
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
});
