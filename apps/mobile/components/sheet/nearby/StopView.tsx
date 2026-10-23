import { haversineMeters, walkingMinutes, type TransitNetwork } from '@bus-tracker/shared';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/sheet/EmptyState';
import {
  distanceText,
  placeKey,
  stopRoutes,
  type NearbyPlace,
  type StopRouteRow,
} from '@/components/sheet/nearby/model';
import { PlaceStatusRow } from '@/components/sheet/nearby/PlaceRow';
import { STOP_ROUTE_ROW_INSET, StopRouteRowView } from '@/components/sheet/nearby/StopRouteRowView';
import { openWalkingDirections } from '@/components/sheet/nearby/TripView';
import { formatClockHHMM } from '@/components/tracker/logic';
import { Hairline, LinkRow, SectionLabel } from '@/components/trip/Rows';
import { SheetBody } from '@/components/trip/SheetBody';
import { DetailHeader } from '@/components/trip/SheetHeader';
import { useSettings } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useNearby, type NearbyView } from '@/state/NearbyContext';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';
import { devNow } from '@/utils/devClock';

/** The next times are refreshed this often while the stop is open. */
const REFRESH_MS = 30_000;

type StopPlace = Extract<NearbyPlace, { kind: 'stop' }>;

/**
 * A bus stop around you, in the sheet (plan 17/03): every route and
 * direction boarding there, soonest first, with the next time and two more;
 * finished ones last. A route opens its preview; walking directions sit
 * under the list. Peek shows the header and the soonest route, as the list
 * shows your bus and the nearest place.
 */
export function StopView({
  view,
  peek,
  scheme,
}: {
  view: Extract<NearbyView, { kind: 'stop' }>;
  peek: boolean;
  scheme: 'light' | 'dark';
}) {
  const nearby = useNearby();
  const { network } = useTransitNetwork();
  const trip = useTrip();
  const settings = useSettings();

  // The list recomputes as you move (or empties when it isn't on screen);
  // the open stop keeps the place it was opened with rather than emptying.
  const found = nearby.places?.find((p): p is StopPlace => p.kind === 'stop' && placeKey(p) === view.key);
  const lastPlace = useRef<StopPlace | null>(null);
  if (found) lastPlace.current = found;
  const place = found ?? lastPlace.current;

  const [now, setNow] = useState(devNow);
  useEffect(() => {
    const t = setInterval(() => setNow(devNow()), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Live only for your tracked route, and only at your stop while the feed
  // has its buses: that is the one route here with a live countdown (the
  // trip's). Other routes go live in their preview (17/05).
  const tracked = settings.preferredRouteCode != null && trip.routeCode !== '';
  const atYourStop =
    tracked && network != null && place != null && place.stopIndexes.some((s) => isYourStop(network, s, trip.stopId));
  const liveRoute = atYourStop && trip.bus.positions.length > 0 ? trip.routeCode : null;
  const liveNext = liveRoute != null && trip.model.source !== 'scheduled' ? trip.model.compact : null;

  const rows = useMemo(
    () =>
      network && place
        ? stopRoutes(network, place.stopIndexes, now, {
            clock: formatClockHHMM,
            liveRoutes: liveRoute ? new Set([liveRoute]) : undefined,
          })
        : null,
    [network, place, now, liveRoute],
  );

  if (!place) {
    return (
      <View>
        <DetailHeader title="Bus stop" subtitle={null} peek={peek} onBack={nearby.pop} backLabel="Back to Nearby" />
        <EmptyState
          icon="mappin.slash"
          title="Stop not found"
          message="It’s no longer around you. Go back to see what’s near."
          scheme={scheme}
          compact
        />
      </View>
    );
  }

  const nearest = network ? place.stopIndexes[0] : null;
  const stopPoint =
    network && nearest != null ? { lat: network.stops.lat[nearest], lng: network.stops.lon[nearest] } : null;
  // Measured from where you are now, not when the list was built.
  const distanceM = nearby.here && stopPoint ? haversineMeters(nearby.here, stopPoint) : null;
  const walkMin = distanceM != null ? Math.max(1, walkingMinutes(distanceM)) : null;
  const subtitle = [
    place.isYourStop ? 'Your stop' : 'Bus stop',
    distanceM != null ? distanceText(distanceM) : null,
    walkMin != null ? `${walkMin} min walk` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const faces = (rows ?? []).map((row) => {
    const live = row.live && network != null && isYourStop(network, row.stopIndex, trip.stopId);
    return { row, ...rowFace(row, live, live ? liveNext : null) };
  });
  const open = (row: StopRouteRow) =>
    nearby.push({ kind: 'route', route: row.route, pattern: row.pattern, fromStopIndex: row.stopIndex });
  const [first, ...rest] = faces;

  return (
    <View>
      <DetailHeader title={place.name} subtitle={subtitle} peek={peek} onBack={nearby.pop} backLabel="Back to Nearby" />
      <View style={styles.top}>
        <View style={styles.titleRow}>
          <SectionLabel>Routes</SectionLabel>
          {first ? <Text style={styles.aside}>Soonest first</Text> : null}
        </View>
        {first ? (
          <StopRouteRowView {...first} onPress={() => open(first.row)} />
        ) : (
          <PlaceStatusRow
            icon={network ? 'bus' : 'arrow.down.circle'}
            title={network ? 'Nothing boards here today' : 'Loading the network…'}
          />
        )}
      </View>
      <SheetBody peek={peek}>
        {rest.length > 0 ? (
          <View>
            {rest.map((face) => (
              <Fragment key={`${face.row.route}|${face.row.pattern}|${face.row.stopIndex}`}>
                <Hairline inset={STOP_ROUTE_ROW_INSET} />
                <StopRouteRowView {...face} onPress={() => open(face.row)} />
              </Fragment>
            ))}
          </View>
        ) : null}
        {stopPoint ? (
          <View>
            <Hairline />
            <LinkRow
              icon="figure.walk"
              title="Walking directions"
              value={walkMin != null ? `${walkMin} min` : undefined}
              external
              onPress={() => openWalkingDirections(stopPoint)}
              accessibilityHint="Opens Apple Maps"
            />
          </View>
        ) : null}
      </SheetBody>
    </View>
  );
}

/** Network stop `s` is the stop your trip tracks (bus stops share the network's ids). */
function isYourStop(net: TransitNetwork, s: number, yourStopId: string): boolean {
  return yourStopId !== '' && net.stops.id[s] === yourStopId;
}

/**
 * What a route row shows and says. `stopRoutes` marks the tracked route
 * live by label, so the view narrows it to the direction boarding at your
 * stop, shows the trip's live countdown there ("6 min"), and reads the next
 * times as a sentence built from the model's `whenSpoken`: "Route 780 to
 * Pasar Seni, in 6 min, live. Then 7:58 and 8:13".
 */
function rowFace(
  row: StopRouteRow,
  live: boolean,
  liveNext: string | null,
): { live: boolean; next: string; spoken: string } {
  const when = liveNext ? (/^\d/.test(liveNext) ? `in ${liveNext}` : liveNext) : row.whenSpoken;
  let said = `Route ${row.label} to ${row.towards}, ${when}`;
  if (live) said += ', live';
  if (row.then) said += `. ${spokenThen(row.then)}`;
  return { live, next: !row.ended && liveNext ? liveNext : row.next, spoken: said };
}

/** "then 7:58 · 8:13" → "Then 7:58 and 8:13"; other captions read as written. */
function spokenThen(then: string): string {
  const m = /^then (.+)$/.exec(then);
  if (!m) return then;
  const times = m[1].split(' · ');
  const list = times.length > 1 ? `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}` : times[0];
  return `Then ${list}`;
}

const styles = StyleSheet.create({
  top: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xxs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.xs,
  },
  aside: {
    ...type.section,
    color: color.secondaryLabel,
  },
});
