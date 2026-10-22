import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STOP_RADIUS_M, type NearbyPlace } from '@/components/sheet/nearby/model';
import { PLACE_ROW_INSET, PlaceRow, PlaceStatusRow } from '@/components/sheet/nearby/PlaceRow';
import { YourBusRow } from '@/components/sheet/nearby/YourBusRow';
import { Hairline, SectionLabel } from '@/components/trip/Rows';
import { SheetBody } from '@/components/trip/SheetBody';
import { useNearby } from '@/state/NearbyContext';
import { color, MARGIN, space, type } from '@/theme/design';

/**
 * The Nearby section (plan 17/02): your bus in one row, then the bus stops
 * and stations around you, nearest first. A stop opens its routes in the
 * sheet; a station opens its sheet. Peek shows your bus and the nearest
 * place; the rest waits in the body, as the other sections' rows do.
 */
export function NearbySection({ peek }: { peek: boolean; scheme: 'light' | 'dark' }) {
  const nearby = useNearby();
  const router = useRouter();
  const { places } = nearby;

  const open = (place: NearbyPlace) => {
    if (place.kind === 'stop') nearby.push({ kind: 'stop', key: place.key });
    else router.push({ pathname: '/station', params: { station: place.stationId } });
  };

  const [first, ...rest] = places ?? [];
  return (
    <View>
      <View style={styles.top}>
        <YourBusRow
          here={nearby.here}
          onOpen={() => nearby.push({ kind: 'trip' })}
          onTrack={() => router.push('/add-route')}
        />
        <View style={styles.titleRow}>
          <SectionLabel>Around you</SectionLabel>
          {first ? <Text style={styles.aside}>Nearest first</Text> : null}
        </View>
        {first ? <PlaceRow place={first} onPress={() => open(first)} /> : <Status />}
      </View>
      {rest.length > 0 ? (
        <SheetBody peek={peek}>
          <View>
            {rest.map((place) => (
              <Fragment key={place.key}>
                <Hairline inset={PLACE_ROW_INSET} />
                <PlaceRow place={place} onPress={() => open(place)} />
              </Fragment>
            ))}
          </View>
        </SheetBody>
      ) : null}
    </View>
  );
}

/** What stands in for the list when there's nothing to list yet, or at all. */
function Status() {
  const nearby = useNearby();
  if (nearby.locationState !== 'granted') {
    return (
      <PlaceStatusRow
        icon="location"
        title="Turn on location to see stops around you"
        caption={nearby.locationState === 'denied' ? 'Opens Settings' : undefined}
        onPress={nearby.requestLocation}
      />
    );
  }
  if (!nearby.networkReady) return <PlaceStatusRow icon="arrow.down.circle" title="Loading the network…" />;
  if (!nearby.here || nearby.places == null) return <PlaceStatusRow icon="location" title="Finding where you are…" />;
  return (
    <PlaceStatusRow
      icon="mappin.slash"
      title={`No stops within ${STOP_RADIUS_M} m`}
      caption="Show the map to look further"
    />
  );
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
