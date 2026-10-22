import { SymbolView } from 'expo-symbols';
import { Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { InterchangeView, NearbyStopView } from '@/components/rail/stationModel';
import { SourceMark } from '@/components/trip/Hero';
import { Hairline } from '@/components/trip/Rows';
import { RouteBadge } from '@/components/trip/SheetHeader';
import type { SourceKind } from '@/components/trip/model';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

/** A tappable row when `onPress` is set, else one plain VoiceOver element. */
function Row({
  onPress,
  label,
  hint,
  children,
}: {
  onPress?: () => void;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  if (onPress) {
    return (
      <RowButton onPress={onPress} style={styles.row} accessibilityLabel={label} accessibilityHint={hint}>
        {children}
      </RowButton>
    );
  }
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      {children}
    </View>
  );
}

/**
 * "Walk to other lines": the other station's line-colour dots (as in
 * Connections), its name, the curated note and the walk. Tapping swaps the
 * sheet to that station in place.
 */
export function InterchangeRows({
  items,
  onOpen,
}: {
  items: readonly InterchangeView[];
  onOpen: (stationId: string) => void;
}) {
  return (
    <View>
      {items.map((x, i) => (
        <Fragment key={x.stationId}>
          {i > 0 ? <Hairline /> : null}
          <Row onPress={() => onOpen(x.stationId)} label={x.spoken} hint="Shows this station">
            <View style={styles.dots}>
              {x.colors.map((c) => (
                <View key={c} style={[styles.dot, { backgroundColor: c }]} />
              ))}
            </View>
            <View style={styles.text}>
              <Text style={styles.name}>{x.name}</Text>
              <Text style={styles.caption}>{x.note}</Text>
            </View>
            <Text style={styles.value}>{x.walk}</Text>
          </Row>
        </Fragment>
      ))}
    </View>
  );
}

/** The trip sheet's live answer, shown on its own stop and route. */
export interface TripLive {
  compact: string;
  source: SourceKind;
}

/**
 * "Buses nearby": the route chip, the stop, then "3 min walk · next 09:14".
 * Timetable times carry the clock glyph; headways read "every N mins". The
 * trip's own stop and route show the trip's ETA (live dot or clock) so live
 * data has one source. A stop on the active route opens it in the trip sheet.
 */
export function NearbyRows({
  items,
  tripLive,
  onRouteStop,
}: {
  items: readonly NearbyStopView[];
  tripLive: TripLive | null;
  /** Set for stops on the active route: opens the stop in the trip sheet. */
  onRouteStop: (stopId: string) => (() => void) | undefined;
}) {
  return (
    <View>
      {items.map((n, i) => {
        const live = n.isTrip && tripLive ? tripLive : null;
        const label = live
          ? `${n.spokenPlace}, ${live.source === 'scheduled' ? 'Scheduled' : 'Live'}, ${live.compact}${n.spokenAlso}`
          : n.spoken;
        const onPress = onRouteStop(n.stopId);
        return (
          <Fragment key={n.stopId}>
            {i > 0 ? <Hairline /> : null}
            <Row onPress={onPress} label={label} hint={onPress ? 'Shows this stop on your route' : undefined}>
              <View style={styles.chip}>
                <RouteBadge code={n.routeLabel} size="small" />
              </View>
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={2}>
                  {n.name}
                </Text>
                <View style={styles.meta}>
                  <Text style={styles.caption}>{n.walk} · </Text>
                  {live ? (
                    <>
                      <SourceMark source={live.source} size={12} />
                      <Text style={[styles.caption, styles.live]}>{live.compact}</Text>
                    </>
                  ) : (
                    <>
                      {n.scheduled ? (
                        <SymbolView name="clock" size={12} tintColor={color.secondaryLabel} />
                      ) : null}
                      <Text style={styles.caption}>{n.next}</Text>
                    </>
                  )}
                </View>
                {n.others.length ? (
                  <Text style={styles.others} numberOfLines={1}>
                    Also {n.others.join(' · ')}
                  </Text>
                ) : null}
              </View>
            </Row>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  dots: {
    width: 16,
    gap: 3,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingTop: 2,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...type.body,
    color: color.label,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 4,
  },
  caption: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  live: {
    color: color.label,
    fontWeight: '500',
  },
  others: {
    ...type.footnote,
    color: color.tertiaryLabel,
  },
  value: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
