import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STOP_RADIUS_M, type NearbyPlace } from '@/components/sheet/nearby/model';
import { PLACE_ROW_INSET, PlaceRow, PlaceStatusRow } from '@/components/sheet/nearby/PlaceRow';
import { Hairline, SectionLabel } from '@/components/trip/Rows';
import { SheetBody } from '@/components/trip/SheetBody';
import { useNearby } from '@/state/NearbyContext';
import { color, MARGIN, space, type } from '@/theme/design';

/**
 * The Nearby section (plan 17/02): the bus stops and stations around you,
 * nearest first (your bus rides in the sheet bar above). A stop opens its routes in the
 * sheet, a station its boards. Every detent shows the whole list, cut
 * by the sheet's edge.
 */
export function NearbySection() {
  const nearby = useNearby();
  const { places } = nearby;

  const open = (place: NearbyPlace) => {
    if (place.kind === 'stop') nearby.push({ kind: 'stop', key: place.key });
    else nearby.push({ kind: 'station', stationId: place.stationId });
  };

  const [first, ...rest] = places ?? [];
  return (
    <View>
      <View style={styles.top}>
        <View style={styles.titleRow}>
          <SectionLabel>Around you</SectionLabel>
          {first ? <Text style={styles.aside}>Nearest first</Text> : null}
        </View>
        {first ? <PlaceRow place={first} onPress={() => open(first)} /> : <Status />}
      </View>
      {rest.length > 0 ? (
        <SheetBody peek={false}>
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
    flexWrap: 'wrap',
    columnGap: space.sm,
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.xs,
  },
  aside: {
    ...type.section,
    color: color.secondaryLabel,
  },
});
