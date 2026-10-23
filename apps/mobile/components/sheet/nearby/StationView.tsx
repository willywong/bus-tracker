import { haversineMeters, walkingMinutes } from '@bus-tracker/shared';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { StationDetails, StationLineBadges, useStation } from '@/components/rail/StationDetails';
import type { NearbyStopView } from '@/components/rail/stationModel';
import { EmptyState } from '@/components/sheet/EmptyState';
import { distanceText } from '@/components/sheet/nearby/model';
import { SheetBody } from '@/components/trip/SheetBody';
import { DetailHeader } from '@/components/trip/SheetHeader';
import { useRailFocus } from '@/hooks/useRailFocus';
import { useNearby, type NearbyView } from '@/state/NearbyContext';
import { useTrip } from '@/state/TripContext';

/**
 * A rail station around you, in the sheet: its line badges by its name, a
 * board per line, walks to other lines and the buses nearby, as the station
 * sheet over the map shows them. While it's open the map shows the
 * station's lines and frames it with you. Another line's station opens here
 * too; a bus opens its route's preview, or your trip on your own route.
 * Every detent shows it all, cut by the sheet's edge, as the Nearby list is.
 */
export function StationView({
  view,
  scheme,
}: {
  view: Extract<NearbyView, { kind: 'station' }>;
  scheme: 'light' | 'dark';
}) {
  const router = useRouter();
  const nearby = useNearby();
  const trip = useTrip();
  const { model, loading, unavailableText, tripLive, railFocus } = useStation(view.stationId);
  useRailFocus(railFocus);

  const openLine = useCallback(
    (routeId: string, dir: 0 | 1) => {
      router.push({ pathname: '/line', params: { line: routeId, dir: String(dir) } });
    },
    [router],
  );
  const { push } = nearby;
  const openStation = useCallback((stationId: string) => push({ kind: 'station', stationId }), [push]);
  const routeStops = trip.route?.stopsById;
  const { select } = trip;
  const onRouteStop = useCallback(
    (stopId: string) => {
      if (!routeStops?.has(stopId)) return undefined;
      // Your stop is your trip; another on your route shows in the sheet.
      return () => (stopId === trip.stopId ? push({ kind: 'trip' }) : select({ kind: 'stop', stopId }));
    },
    [routeStops, trip.stopId, push, select],
  );
  const openRoute = useCallback(
    (n: NearbyStopView) =>
      push({ kind: 'route', route: n.route, pattern: n.pattern, fromStopIndex: n.stopIndex }),
    [push],
  );

  if (!model) {
    return (
      <View>
        <DetailHeader
          title="Station"
          subtitle={null}
          peek={false}
          onBack={nearby.pop}
          backLabel="Back to Nearby"
        />
        {loading ? null : (
          <EmptyState
            icon="tram.fill"
            title="Station not found"
            message="Go back to see what’s near."
            scheme={scheme}
            compact
          />
        )}
      </View>
    );
  }

  const { station } = model;
  // Measured from where you are now.
  const distanceM = nearby.here ? haversineMeters(nearby.here, { lat: station.lat, lng: station.lng }) : null;
  const walkMin = distanceM != null ? Math.max(1, walkingMinutes(distanceM)) : null;
  const subtitle = [
    'Station',
    distanceM != null ? distanceText(distanceM) : null,
    walkMin != null ? `${walkMin} min walk` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View>
      <DetailHeader
        title={station.name}
        subtitle={subtitle}
        peek={false}
        onBack={nearby.pop}
        backLabel="Back to Nearby"
        accessory={<StationLineBadges lines={model.lines} onOpenLine={openLine} style={styles.badges} />}
      />
      <SheetBody peek={false}>
        <StationDetails
          model={model}
          unavailableText={unavailableText}
          tripLive={tripLive}
          onOpenLine={openLine}
          onOpenStation={openStation}
          onRouteStop={onRouteStop}
          onOpenRoute={openRoute}
        />
      </SheetBody>
    </View>
  );
}

const styles = StyleSheet.create({
  badges: {
    maxWidth: '40%',
    justifyContent: 'flex-end',
  },
});
