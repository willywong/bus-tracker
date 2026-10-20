import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { formatStopName } from '@/components/map/format';
import type { JourneyData, JourneyStopNode } from '@/hooks/useJourneyStops';
import { color, radius, space, type } from '@/theme/design';

const MAX_BETWEEN = 6;

/**
 * Stop-by-stop approach (Flighty / Transit style): where the bus is, the
 * stops it still has to serve, and your stop as the terminal node. A route
 * colour rail ties them together; your stop is the only emphasised row.
 */
export function OnTheWay({
  journey,
  arrivalLabel,
}: {
  journey: JourneyData;
  /** "4 min" / "Due" / "10:42" for your stop row. */
  arrivalLabel: string | null;
}) {
  if (!journey.ready || !journey.userStop || !journey.busStop) return null;

  const between = journey.upcoming;
  const hidden = Math.max(0, between.length - MAX_BETWEEN);
  // Keep the stops nearest your stop; collapse the far end.
  const shown = hidden > 0 ? between.slice(hidden) : between;

  return (
    <View style={styles.group}>
      <Row kind="bus" stop={journey.busStop} isFirst />
      {hidden > 0 ? (
        <Row kind="collapsed" label={`${hidden} more ${hidden === 1 ? 'stop' : 'stops'}`} />
      ) : null}
      {shown.map((s) => (
        <Row key={`${s.stopId}-${s.sequence}`} kind="stop" stop={s} />
      ))}
      <Row kind="user" stop={journey.userStop} trailing={arrivalLabel} isLast />
    </View>
  );
}

type RowProps =
  | { kind: 'bus'; stop: JourneyStopNode; isFirst?: boolean; isLast?: boolean; trailing?: null }
  | { kind: 'stop'; stop: JourneyStopNode; isFirst?: boolean; isLast?: boolean; trailing?: null }
  | { kind: 'user'; stop: JourneyStopNode; isFirst?: boolean; isLast?: boolean; trailing: string | null }
  | { kind: 'collapsed'; label: string; isFirst?: boolean; isLast?: boolean; trailing?: null };

function Row(props: RowProps) {
  const { kind, isFirst, isLast } = props;
  const title =
    props.kind === 'collapsed'
      ? props.label
      : props.kind === 'bus'
        ? `Bus near ${formatStopName(props.stop.name)}`
        : formatStopName(props.stop.name);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        kind === 'user'
          ? `Your stop, ${title}${props.trailing ? `, ${props.trailing}` : ''}`
          : title
      }
    >
      <View style={styles.railCol}>
        <View style={[styles.rail, isFirst && styles.railHiddenTop]} />
        <View style={[styles.rail, isLast && styles.railHiddenBottom]} />
        <View style={styles.nodeWrap}>
          {kind === 'bus' ? (
            <View style={styles.busNode}>
              <SymbolView name="bus.fill" size={11} tintColor="#FFFFFF" weight="semibold" />
            </View>
          ) : kind === 'user' ? (
            <View style={styles.userNode}>
              <View style={styles.userNodeCore} />
            </View>
          ) : kind === 'collapsed' ? (
            <SymbolView name="ellipsis" size={12} tintColor={color.tertiaryLabel} />
          ) : (
            <View style={styles.stopNode} />
          )}
        </View>
      </View>
      <View style={styles.textCol}>
        <Text
          style={[
            styles.title,
            kind === 'user' && styles.titleUser,
            kind === 'collapsed' && styles.titleMuted,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {kind === 'user' ? <Text style={styles.caption}>Your stop</Text> : null}
      </View>
      {kind === 'user' && props.trailing ? (
        <Text style={styles.trailing}>{props.trailing}</Text>
      ) : null}
    </View>
  );
}

const RAIL_X = 22;

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.group,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
    paddingVertical: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingRight: space.md,
  },
  railCol: {
    width: RAIL_X * 2,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  rail: {
    flex: 1,
    width: 3,
    backgroundColor: color.accent,
    opacity: 0.85,
  },
  railHiddenTop: { opacity: 0 },
  railHiddenBottom: { opacity: 0 },
  nodeWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busNode: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: color.accent,
    backgroundColor: color.background,
  },
  userNode: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userNodeCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  textCol: {
    flex: 1,
    paddingVertical: space.xs,
  },
  title: {
    ...type.body,
    fontSize: 16,
    color: color.label,
  },
  titleUser: {
    fontWeight: '600',
  },
  titleMuted: {
    color: color.secondaryLabel,
  },
  caption: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  trailing: {
    ...type.headline,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
});
