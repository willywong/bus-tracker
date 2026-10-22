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
import { StyleSheet, Text, View } from 'react-native';

import type { BoardRowView, StationBoardView } from '@/components/rail/stationModel';
import { Hairline, NoteRow } from '@/components/trip/Rows';
import { Section } from '@/components/trip/SheetBody';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

/**
 * One line's departure board (spec §6.4): a row per direction, "→ Gombak"
 * on the left and the honest wait on the right ("every 3 mins", or "about
 * 4 mins" rolling down with "then every 6 mins" under it), then the first
 * and last train. Each row is one VoiceOver element reading its `spoken`
 * line and opens the whole line. When the timetable is unavailable the rows
 * become one note; the section title still names the line.
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
  return (
    <Section title={board.line.name}>
      {unavailable ? (
        <NoteRow icon="clock.badge.exclamationmark" text={unavailableText} />
      ) : board.rows.length === 0 ? (
        <NoteRow icon="moon.zzz" text="No trains from here today" />
      ) : (
        board.rows.map((row, i) => (
          <Fragment key={`${row.dir}:${row.towards}`}>
            {i > 0 ? <Hairline /> : null}
            {routeId ? (
              <RowButton
                onPress={() => onOpenLine(routeId, row.dir)}
                style={styles.row}
                accessibilityLabel={row.spoken}
                accessibilityHint="Shows the whole line"
              >
                <BoardRowContent row={row} />
              </RowButton>
            ) : (
              <View style={styles.row} accessible accessibilityLabel={row.spoken}>
                <BoardRowContent row={row} />
              </View>
            )}
          </Fragment>
        ))
      )}
      {!unavailable && board.footer ? (
        <Text style={styles.footer} accessibilityLabel={board.footerSpoken ?? board.footer}>
          {board.footer}
        </Text>
      ) : null}
    </Section>
  );
}

function BoardRowContent({ row }: { row: BoardRowView }) {
  return (
    <>
      <Text style={styles.towards}>→ {row.towards}</Text>
      <View style={styles.when}>
        <View style={styles.primary}>
          {row.scheduled ? (
            <SymbolView name="clock" size={13} tintColor={color.secondaryLabel} />
          ) : null}
          <Host matchContents>
            <SwiftText
              modifiers={[
                font({ size: type.body.fontSize }),
                monospacedDigit(),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.sm,
    rowGap: 2,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  towards: {
    ...type.body,
    flexShrink: 1,
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
  footer: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
    paddingTop: space.xxs,
  },
});
