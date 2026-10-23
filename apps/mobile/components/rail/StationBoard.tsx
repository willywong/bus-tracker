import { Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  contentTransition,
  font,
  foregroundStyle,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Fragment } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { BoardRowView, StationBoardView } from '@/components/rail/stationModel';
import { Hairline, NoteRow } from '@/components/trip/Rows';
import { Section } from '@/components/trip/SheetBody';
import { CARD_ROW_GAP, CardRow } from '@/components/ui/CardRow';
import { color, space, type } from '@/theme/design';

/**
 * One line's departure board (spec §6.4): a row per direction, a train tile
 * in the line's colour and "Towards Gombak" on the left, the honest wait on
 * the right in bold ("every 3 mins", or "about 4 mins" rolling down with
 * "then every 6 mins" under it). The line's running hours, first train to
 * last ("6:05 AM – 1:22 AM"), trail its name in the section title. Each row is one VoiceOver element reading its
 * `spoken` line and opens the whole line, on a grouped card so it reads as a
 * button. When the timetable is unavailable the rows become one note; the
 * section title still names the line.
 */
export function StationBoard({
  board,
  unavailable,
  unavailableText,
  onOpenLine,
}: {
  board: StationBoardView;
  unavailable: boolean;
  /** "Timetable unavailable", or a loading note while the network builds. */
  unavailableText: string;
  onOpenLine: (routeId: string, dir: 0 | 1) => void;
}) {
  const routeId = board.line.routeId;
  const tile = { backgroundColor: board.line.line.color };
  const glyph = board.line.line.textColor;
  return (
    <Section
      title={board.line.name}
      accessory={
        !unavailable && board.first && board.last ? (
          <View style={styles.hours} accessible accessibilityLabel={board.footerSpoken ?? board.footer ?? ''}>
            <SymbolView name="clock" size={12} tintColor={color.secondaryLabel} />
            <Text style={styles.hoursText}>
              {board.first} – {board.last}
            </Text>
          </View>
        ) : null
      }
    >
      {unavailable ? (
        <NoteRow icon="clock.badge.exclamationmark" text={unavailableText} />
      ) : board.rows.length === 0 ? (
        <NoteRow icon="moon.zzz" text="No trains from here today" />
      ) : routeId ? (
        <View style={styles.cards}>
          {board.rows.map((row) => (
            <CardRow
              key={`${row.dir}:${row.towards}`}
              onPress={() => onOpenLine(routeId, row.dir)}
              style={styles.row}
              accessibilityLabel={row.spoken}
              accessibilityHint="Shows the whole line"
            >
              <BoardRowContent row={row} tile={tile} glyph={glyph} />
            </CardRow>
          ))}
        </View>
      ) : (
        board.rows.map((row, i) => (
          <Fragment key={`${row.dir}:${row.towards}`}>
            {i > 0 ? <Hairline /> : null}
            <View style={[styles.row, styles.plain]} accessible accessibilityLabel={row.spoken}>
              <BoardRowContent row={row} tile={tile} glyph={glyph} />
            </View>
          </Fragment>
        ))
      )}
    </Section>
  );
}

function BoardRowContent({
  row,
  tile,
  glyph,
}: {
  row: BoardRowView;
  /** The line's colour behind the train glyph. */
  tile: ViewStyle;
  /** The line's official text colour, for the glyph on it. */
  glyph: string;
}) {
  return (
    <>
      <View style={[styles.tile, tile]}>
        <SymbolView name="tram.fill" size={15} tintColor={glyph} />
      </View>
      <View style={styles.dest}>
        <Text style={styles.towardsLabel}>Towards</Text>
        <Text style={styles.towards}>{row.towards}</Text>
      </View>
      <View style={styles.when}>
        <View style={styles.primary}>
          {row.scheduled ? (
            <SymbolView name="clock" size={13} tintColor={color.secondaryLabel} />
          ) : null}
          <Host matchContents>
            <SwiftText
              modifiers={[
                font({ size: type.body.fontSize, weight: 'semibold' }),
                monospacedDigit(),
                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
                // Only an "about N mins" count rolls; "every 3 mins" stays put.
                ...(row.rolling != null
                  ? [
                      contentTransition('numericText', { countsDown: true }),
                      animation(Animation.smooth({ duration: 0.35 }), row.rolling),
                    ]
                  : []),
              ]}
            >
              {row.primary}
            </SwiftText>
          </Host>
        </View>
        {row.secondary ? <Text style={styles.secondary}>{row.secondary}</Text> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  cards: {
    gap: CARD_ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.sm,
    rowGap: 2,
    minHeight: 56,
    paddingVertical: space.sm,
  },
  // Without a card the row sits on the sheet, between hairlines.
  plain: {
    minHeight: 52,
    paddingVertical: space.xs,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dest: {
    flexShrink: 1,
  },
  towardsLabel: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  towards: {
    ...type.headline,
    color: color.label,
  },
  when: {
    // Never squeezed: at large type it wraps under the destination instead.
    flexShrink: 0,
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secondary: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  hours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hoursText: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
