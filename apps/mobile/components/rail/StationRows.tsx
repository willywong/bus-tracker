import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { InterchangeView, NearbyStopView } from '@/components/rail/stationModel';
import { SourceMark } from '@/components/trip/Hero';
import { RouteBadge } from '@/components/trip/SheetHeader';
import type { SourceKind } from '@/components/trip/model';
import { CARD_ROW_GAP, CardRow } from '@/components/ui/CardRow';
import { color, space, type } from '@/theme/design';

/** One tappable row on its grouped card. */
function Row({
  onPress,
  label,
  hint,
  children,
}: {
  onPress: () => void;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <CardRow onPress={onPress} style={styles.row} accessibilityLabel={label} accessibilityHint={hint}>
      {children}
    </CardRow>
  );
}

/**
 * "Walk to other lines": the other station's line-colour dots (as in
 * Connections), its name, the curated note and the walk beside a walking
 * figure. Tapping swaps the
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
    <View style={styles.list}>
      {items.map((x) => (
        <Row key={x.stationId} onPress={() => onOpen(x.stationId)} label={x.spoken} hint="Shows this station">
          <View style={styles.dots}>
            {x.colors.map((c) => (
              <View key={c} style={[styles.dot, { backgroundColor: c }]} />
            ))}
          </View>
          <View style={styles.text}>
            <Text style={styles.name}>{x.name}</Text>
            <Text style={styles.caption}>{x.note}</Text>
          </View>
          <View style={styles.walk}>
            <SymbolView name="figure.walk" size={13} tintColor={color.secondaryLabel} />
            <Text style={styles.value}>{x.walk}</Text>
          </View>
        </Row>
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
 * "Buses nearby": the route chip, the stop and its walk (a walking figure,
 * "3 min walk"), and the next bus on the trailing edge as the train boards
 * have it ("Next 09:14"). Timetable times carry the clock glyph; headways
 * read "Every N mins". The
 * trip's own stop and route show the trip's ETA (live dot or clock) so live
 * data has one source. A stop on the active route opens it in the trip sheet;
 * any other opens its route's preview from that stop.
 */
export function NearbyRows({
  items,
  tripLive,
  onRouteStop,
  onOpenRoute,
}: {
  items: readonly NearbyStopView[];
  tripLive: TripLive | null;
  /** Set for stops on the active route: opens the stop in the trip sheet. */
  onRouteStop: (stopId: string) => (() => void) | undefined;
  onOpenRoute: (stop: NearbyStopView) => void;
}) {
  return (
    <View style={styles.list}>
      {items.map((n) => {
        const live = n.isTrip && tripLive ? tripLive : null;
        const label = live
          ? `${n.spokenPlace}, ${live.source === 'scheduled' ? 'Scheduled' : 'Live'}, ${live.compact}${n.spokenAlso}`
          : n.spoken;
        const onYourRoute = onRouteStop(n.stopId);
        return (
          <Row
            key={n.stopId}
            onPress={onYourRoute ?? (() => onOpenRoute(n))}
            label={label}
            hint={
              onYourRoute ? 'Shows this stop on your route' : `Previews route ${n.routeLabel} from this stop`
            }
          >
            <View style={styles.chip}>
              <RouteBadge code={n.routeLabel} size="small" />
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={2}>
                {n.name}
              </Text>
              <View style={styles.meta}>
                <SymbolView name="figure.walk" size={12} tintColor={color.secondaryLabel} />
                <Text style={styles.caption}>{n.walk}</Text>
              </View>
              {n.others.length ? (
                <Text style={styles.others} numberOfLines={1}>
                  Also {n.others.join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={styles.next}>
              {live ? (
                <SourceMark source={live.source} size={12} />
              ) : n.scheduled ? (
                <SymbolView name="clock" size={12} tintColor={color.secondaryLabel} />
              ) : null}
              <Text style={styles.nextText}>{live ? live.compact : capitalise(n.next)}</Text>
            </View>
          </Row>
        );
      })}
    </View>
  );
}

/** "next 09:14" → "Next 09:14": it starts the trailing column. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  list: {
    gap: CARD_ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingVertical: space.sm,
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
  // One column wide enough for a four-character route ("T807"), so every
  // stop name starts at the same edge.
  chip: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    minWidth: 66,
    paddingTop: 2,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...type.body,
    fontWeight: '600',
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
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    maxWidth: '40%',
  },
  nextText: {
    ...type.footnote,
    fontWeight: '600',
    color: color.label,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  walk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
