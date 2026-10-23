import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import type { StopRouteRow } from '@/components/sheet/nearby/model';
import { TIME_MAX_SCALE } from '@/components/sheet/nearby/PlaceRow';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

/** The leading column: wide enough for a four-character route badge, so the titles line up. */
const LEAD = 72;
/** Hairlines between route rows start at the title. */
export const STOP_ROUTE_ROW_INSET = LEAD + space.sm;

/**
 * One route and direction at a stop (plan 17/03): its badge, where it's
 * heading with the next two times under it, the next time on the right (a
 * live dot and the countdown when your bus is on its way), and a chevron.
 * A finished route reads "No more today" in grey with when the last one
 * left. One VoiceOver element reading `spoken`; the view decides `live`,
 * `next` and `spoken` because only it knows your trip.
 */
export function StopRouteRowView({
  row,
  live,
  next,
  spoken,
  onPress,
}: {
  row: StopRouteRow;
  live: boolean;
  next: string;
  spoken: string;
  onPress: () => void;
}) {
  return (
    <RowButton
      onPress={onPress}
      style={styles.row}
      accessibilityLabel={spoken}
      accessibilityHint="Shows the route on the map"
    >
      <View style={styles.lead}>
        <RouteBadge code={row.label} />
      </View>
      <View style={styles.titles}>
        <Text style={[styles.towards, row.ended && styles.ended]} numberOfLines={2}>
          to {row.towards}
        </Text>
        {row.then ? (
          <Text style={styles.caption} numberOfLines={1}>
            {row.then}
          </Text>
        ) : null}
      </View>
      <View style={styles.next}>
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={[styles.nextText, row.ended && styles.ended]} numberOfLines={1} maxFontSizeMultiplier={TIME_MAX_SCALE}>
          {next}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
    </RowButton>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 60,
    paddingVertical: space.xs,
  },
  lead: {
    minWidth: LEAD,
    alignItems: 'flex-start',
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  towards: {
    ...type.body,
    color: color.label,
  },
  caption: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  ended: {
    color: color.secondaryLabel,
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '38%',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: color.live,
  },
  nextText: {
    ...type.status,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
});
