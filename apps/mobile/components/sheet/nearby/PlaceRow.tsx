import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { distanceText, type LineChip, type NearbyPlace } from '@/components/sheet/nearby/model';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

/** The leading column: a stop's glyph disc, or a station's line chips. */
const LEAD = 34;
/** Hairlines between place rows start at the name. */
export const PLACE_ROW_INSET = LEAD + space.sm;
/** At most this many line chips lead a station row; the rest are counted. */
const MAX_CHIPS = 2;

/**
 * One place around you (plan 17/02). A bus stop: a disc with the bus glyph,
 * its name, then how far and which routes, and its soonest bus on the right.
 * A station: its line chips, name, distance and walk, and how often trains
 * come. One VoiceOver element reading `spoken`.
 */
export function PlaceRow({ place, onPress }: { place: NearbyPlace; onPress: () => void }) {
  const caption =
    place.kind === 'stop'
      ? [place.isYourStop ? 'Your stop' : null, distanceText(place.distanceM), ...place.routes]
          .filter(Boolean)
          .join(' · ')
      : `${distanceText(place.distanceM)} · ${place.walkMin} min walk`;
  return (
    <RowButton
      onPress={onPress}
      style={styles.row}
      accessibilityLabel={place.spoken}
      accessibilityHint={place.kind === 'stop' ? 'Shows its routes' : 'Opens the station'}
    >
      {place.kind === 'stop' ? <Disc icon="bus" /> : <Chips lines={place.lines} />}
      <View style={styles.titles}>
        <Text style={styles.name} numberOfLines={1}>
          {place.name}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <View style={styles.next}>
        {place.kind === 'stop' && place.live ? <View style={styles.liveDot} /> : null}
        <Text style={styles.nextText} numberOfLines={1}>
          {place.next}
        </Text>
      </View>
    </RowButton>
  );
}

/**
 * A row in the place list's own voice, for when there's nothing to list:
 * no permission, no network yet, no fix, or nothing within reach.
 */
export function PlaceStatusRow({
  icon,
  title,
  caption,
  onPress,
  hint,
}: {
  icon: SFSymbol;
  title: string;
  caption?: string;
  onPress?: () => void;
  hint?: string;
}) {
  const body = (
    <>
      <Disc icon={icon} />
      <View style={styles.titles}>
        <Text style={styles.name}>{title}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={caption ? `${title}. ${caption}` : title}>
        {body}
      </View>
    );
  }
  return (
    <RowButton onPress={onPress} style={styles.row} accessibilityLabel={title} accessibilityHint={caption}>
      {body}
    </RowButton>
  );
}

function Disc({ icon }: { icon: SFSymbol }) {
  return (
    <View style={styles.disc}>
      <SymbolView name={icon} size={15} weight="medium" tintColor={color.label} />
    </View>
  );
}

/** A station's lines as small chips in their official colours, as `LineBadge` draws them. */
function Chips({ lines }: { lines: LineChip[] }) {
  const shown = lines.slice(0, MAX_CHIPS);
  const more = lines.length - shown.length;
  return (
    <View style={styles.chips}>
      {shown.map((l) => (
        <View key={l.label} style={[styles.chip, { backgroundColor: l.color }]}>
          <Text style={[styles.chipText, { color: l.textColor }]} maxFontSizeMultiplier={1.6}>
            {l.label}
          </Text>
        </View>
      ))}
      {more > 0 ? (
        <Text style={styles.more} maxFontSizeMultiplier={1.6}>
          +{more}
        </Text>
      ) : null}
    </View>
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
  disc: {
    width: LEAD,
    height: LEAD,
    borderRadius: LEAD / 2,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    minWidth: LEAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  chip: {
    minWidth: 28,
    minHeight: 20,
    paddingHorizontal: 5,
    borderRadius: 5,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  more: {
    ...type.caption,
    color: color.secondaryLabel,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...type.body,
    color: color.label,
  },
  caption: {
    ...type.footnote,
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
