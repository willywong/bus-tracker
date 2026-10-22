import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { ROW_ICON_INSET } from '@/components/trip/Rows';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

import type { RowLead, RowModel } from './model';
import { PlaceThumb } from './PlaceThumb';

/** Same as `ROW_ICON` in `components/trip/Rows.tsx`, so glyphs line up with the trip sheet's. */
const LEAD = 24;
const SQUARE = 8;
const ROW_MIN_HEIGHT = 52;

/** Hairlines between suggestion rows start at the title. */
export const SUGGESTION_INSET = ROW_ICON_INSET;
/** A saved place's map thumbnail; with the row's padding its rows are 60pt. */
const THUMB = 44;
/** The title's inset in rows led by a thumbnail. */
export const THUMB_INSET = THUMB + space.sm;

/**
 * One search suggestion (spec §6.2): a station, stop, place, recent or saved
 * place. A plain Calm Mono row: ink glyph, the name, one secondary line, and
 * a place's distance on the right.
 */
export function SuggestionRow({ row, onPress }: { row: RowModel; onPress: () => void }) {
  return (
    <RowButton onPress={onPress} style={styles.row} accessibilityLabel={row.accessibilityLabel}>
      {row.thumb ? <PlaceThumb lat={row.thumb.lat} lng={row.thumb.lng} size={THUMB} /> : <Lead lead={row.lead} />}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        {row.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {row.trailing ? <Text style={styles.trailing}>{row.trailing}</Text> : null}
    </RowButton>
  );
}

/** A quiet, non-tappable line in place of rows ("Places need a connection"). */
export function NoteRow({ symbol, text }: { symbol: SFSymbol | null; text: string }) {
  return (
    <View style={[styles.row, !symbol && styles.noteBare]} accessible accessibilityLabel={text}>
      {symbol ? (
        <View style={styles.lead}>
          <SymbolView name={symbol} size={17} tintColor={color.secondaryLabel} resizeMode="scaleAspectFit" />
        </View>
      ) : null}
      <Text style={[styles.subtitle, styles.noteText]}>{text}</Text>
    </View>
  );
}

function Lead({ lead }: { lead: RowLead }) {
  if (lead.kind === 'symbol') {
    return (
      <View style={styles.lead}>
        <SymbolView name={lead.name} size={19} weight="regular" tintColor={color.label} resizeMode="scaleAspectFit" />
      </View>
    );
  }
  // A 2×2 grid fits the 24pt column; past four lines the last cell is "+n".
  const shown = lead.more > 0 ? lead.colors.slice(0, 3) : lead.colors;
  return (
    <View style={styles.lead}>
      <View style={styles.squares}>
        {shown.map((c, i) => (
          <View key={`${c}-${i}`} style={[styles.square, { backgroundColor: c }]} />
        ))}
        {lead.more > 0 ? <Text style={styles.more}>+{lead.more + 1}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  noteBare: {
    minHeight: 44,
  },
  lead: {
    width: LEAD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squares: {
    width: SQUARE * 2 + 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  square: {
    width: SQUARE,
    height: SQUARE,
    borderRadius: 2,
  },
  more: {
    fontSize: 8,
    lineHeight: SQUARE,
    fontWeight: '600',
    color: color.secondaryLabel,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.body,
    color: color.label,
  },
  subtitle: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  noteText: {
    flex: 1,
  },
  trailing: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
