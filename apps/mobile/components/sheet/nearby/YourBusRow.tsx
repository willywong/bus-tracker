import { haversineMeters, type LatLng } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { distanceText } from '@/components/sheet/nearby/model';
import { SourceMark } from '@/components/trip/Hero';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { RowButton } from '@/components/ui/RowButton';
import { useSettings } from '@/hooks/useSettings';
import { useTrip } from '@/state/TripContext';
import { color, radius, space, type } from '@/theme/design';

/** The your-bus row's height at the default text size; it grows with Dynamic Type. */
export const YOUR_BUS_ROW_HEIGHT = 60;

/**
 * Nearby's first row (plan 17/02): your tracked bus in one line, its stop,
 * how far you are from it and the countdown, live or scheduled. Tapping it
 * opens the full trip. With no route tracked it offers to track one.
 */
export function YourBusRow({
  here,
  onOpen,
  onTrack,
}: {
  here: LatLng | null;
  onOpen: () => void;
  onTrack: () => void;
}) {
  const trip = useTrip();
  const settings = useSettings();
  const { model } = trip;

  if (settings.preferredRouteCode == null || model.state === 'empty') {
    return (
      <RowButton
        onPress={onTrack}
        style={styles.row}
        accessibilityLabel="Track a bus"
        accessibilityHint="Pick a route and the stop you board at"
      >
        <View style={styles.plus}>
          <SymbolView name="plus" size={15} weight="semibold" tintColor={color.label} />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            Track a bus
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            Your countdown shows here
          </Text>
        </View>
        <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
      </RowButton>
    );
  }

  const stop = trip.route?.userStop;
  const distanceM = here && stop ? haversineMeters(here, { lat: stop.stop_lat, lng: stop.stop_lon }) : null;
  const stopName = trip.stopName ?? 'Your stop';
  const caption = distanceM != null ? `Your bus · ${distanceText(distanceM)}` : 'Your bus';
  const spoken = [
    `Your bus, route ${trip.routeCode}, ${stopName}`,
    distanceM != null ? `${Math.round(distanceM)} metres away` : null,
    model.compact
      ? `${model.source === 'live' ? 'live' : model.source === 'aging' ? 'live, last updated over a minute ago' : 'scheduled'}, ${model.compact}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <RowButton onPress={onOpen} style={styles.row} accessibilityLabel={spoken} accessibilityHint="Shows your trip">
      <RouteBadge code={trip.routeCode} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {stopName}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {model.compact ? (
        <View style={styles.countdown}>
          <SourceMark source={model.source} size={11} />
          <Text style={styles.compact} numberOfLines={1}>
            {model.compact}
          </Text>
        </View>
      ) : null}
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
    </RowButton>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: YOUR_BUS_ROW_HEIGHT,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.row,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  plus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.body,
    fontWeight: '500',
    color: color.label,
  },
  caption: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compact: {
    ...type.headline,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
});
