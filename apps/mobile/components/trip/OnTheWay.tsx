import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { Hairline } from '@/components/trip/Rows';
import type { JourneyData, JourneyStopNode } from '@/hooks/useJourneyStops';
import { color, space, type } from '@/theme/design';

const MAX_BETWEEN = 6;
const GLYPH_COL = 28;

/**
 * Stop-by-stop approach as hairline rows: where the bus is now, the stops it
 * still has to serve, and your stop (ring) with its arrival. The same glyphs
 * as the map: a chevron for the bus, hollow rings for stops, a ring with a
 * dot for yours.
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
    <View>
      <Row kind="bus" stop={journey.busStop} trailing="now" />
      {hidden > 0 ? (
        <>
          <Hairline inset={GLYPH_COL} />
          <Row kind="collapsed" label={`${hidden} more ${hidden === 1 ? 'stop' : 'stops'}`} />
        </>
      ) : null}
      {shown.map((s) => (
        <View key={`${s.stopId}-${s.sequence}`}>
          <Hairline inset={GLYPH_COL} />
          <Row kind="stop" stop={s} />
        </View>
      ))}
      <Hairline inset={GLYPH_COL} />
      <Row kind="user" stop={journey.userStop} trailing={arrivalLabel} />
    </View>
  );
}

type RowProps =
  | { kind: 'bus' | 'stop'; stop: JourneyStopNode; trailing?: string | null }
  | { kind: 'user'; stop: JourneyStopNode; trailing: string | null }
  | { kind: 'collapsed'; label: string; trailing?: null };

function Row(props: RowProps) {
  const title =
    props.kind === 'collapsed' ? props.label : formatStopName(props.stop.name);
  const a11y =
    props.kind === 'user'
      ? `Your stop, ${title}${props.trailing ? `, ${props.trailing}` : ''}`
      : props.kind === 'bus'
        ? `Bus now near ${title}`
        : title;

  return (
    <View style={styles.row} accessible accessibilityLabel={a11y}>
      <View style={styles.glyph}>
        {props.kind === 'bus' ? (
          <SymbolView name="location.north.fill" size={13} tintColor={color.label} style={styles.chevron} />
        ) : props.kind === 'user' ? (
          <View style={styles.userRing}>
            <View style={styles.userDot} />
          </View>
        ) : props.kind === 'collapsed' ? (
          <SymbolView name="ellipsis" size={12} tintColor={color.tertiaryLabel} />
        ) : (
          <View style={styles.stopRing} />
        )}
      </View>
      <Text
        style={[
          styles.title,
          props.kind === 'user' && styles.titleUser,
          (props.kind === 'collapsed' || props.kind === 'stop') && styles.titleMuted,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {props.trailing ? (
        <Text style={[styles.trailing, props.kind === 'user' && styles.trailingUser]}>
          {props.trailing}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
  },
  glyph: {
    width: GLYPH_COL,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  chevron: {
    width: 14,
    height: 14,
    transform: [{ rotate: '90deg' }],
  },
  stopRing: {
    width: 9,
    height: 9,
    marginLeft: 2,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: color.label,
  },
  userRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: color.label,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: color.label,
  },
  title: {
    ...type.body,
    fontSize: 16,
    flex: 1,
    color: color.label,
  },
  titleUser: {
    fontWeight: '600',
  },
  titleMuted: {
    color: color.secondaryLabel,
  },
  trailing: {
    ...type.status,
    marginLeft: space.xs,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  trailingUser: {
    color: color.label,
    fontWeight: '600',
  },
});
