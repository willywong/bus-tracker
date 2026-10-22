import { Button, HStack, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  monospacedDigit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import type { ScheduledDeparture } from '@/db/queries';
import { color, space, type } from '@/theme/design';

interface TimetableProps {
  departures: ScheduledDeparture[];
  formatClock: (epochMs: number) => string;
  /** The trip the hero counts down to, set in blue. */
  arrivingTripId: string | null;
  firstBusToday: number | null;
  lastBusToday: number | null;
  /**
   * Opens one departure's own small sheet. With it every time is a Liquid
   * Glass button; without it (a stop's detail) the grid is plain text.
   */
  onPressDeparture?: (departure: ScheduledDeparture) => void;
}

/**
 * Today's remaining departures as a grid of four columns. On the trip sheet
 * each time is a clear glass capsule that opens its own small sheet, so they
 * read as tappable at a glance; the bus the hero counts down to (the
 * "Arrives 3:14 PM" one) is the one prominent, blue capsule. Light weight,
 * tabular digits, AM/PM set small.
 */
export function Timetable({
  departures,
  formatClock,
  arrivingTripId,
  firstBusToday,
  lastBusToday,
  onPressDeparture,
}: TimetableProps) {
  if (departures.length === 0) return null;
  // A loop route can list one trip twice; the hero counts to its first pass.
  const arrivingIndex = departures.findIndex((d) => d.tripId === arrivingTripId);

  return (
    <View style={styles.wrap}>
      <View style={[styles.grid, onPressDeparture && styles.gridButtons]}>
        {departures.map((d, i) => {
          const arriving = i === arrivingIndex;
          const text = formatClock(d.departureEpochMs);
          // A loop route passes the stop twice on one trip: the time keeps them apart.
          const key = `${d.tripId}-${d.serviceDayMidnightUtcMs}-${d.departureEpochMs}`;
          return onPressDeparture ? (
            <View key={key} style={[styles.cell, styles.buttonCell]}>
              <ClockButton text={text} yours={arriving} onPress={() => onPressDeparture(d)} />
            </View>
          ) : (
            <View
              key={key}
              style={styles.cell}
              accessible
              accessibilityLabel={`${text}${arriving ? ', your bus' : ''}`}
            >
              {arriving ? <GlassClock text={text} /> : <ClockText text={text} />}
            </View>
          );
        })}
      </View>
      {firstBusToday != null && lastBusToday != null ? (
        <ServiceSpan first={firstBusToday} last={lastBusToday} formatClock={formatClock} />
      ) : null}
    </View>
  );
}

/** "3:47 PM" → ["3:47", "PM"]; 24-hour times have no meridiem. */
function splitClock(text: string): [string, string | null] {
  const m = /^(.*?)\s*([AP]M)$/i.exec(text);
  return m ? [m[1], m[2]] : [text, null];
}

/**
 * A clock time with its AM/PM set small, like the Clock app, so four fit a
 * row on every phone without wrapping. 24-hour times pass through unchanged.
 */
function ClockText({ text, style = styles.time }: { text: string; style?: TextStyle }) {
  const [digits, meridiem] = splitClock(text);
  return (
    <Text style={style} numberOfLines={1}>
      {digits}
      {meridiem ? <Text style={styles.meridiem}>{` ${meridiem}`}</Text> : null}
    </Text>
  );
}

/** The time's digits and small AM/PM, drawn in SwiftUI for the glass. */
function SwiftClock({ text, yours }: { text: string; yours: boolean }) {
  const [digits, meridiem] = splitClock(text);
  return (
    <HStack spacing={3} alignment="firstTextBaseline">
      <SwiftText
        modifiers={[
          font({ size: type.body.fontSize, weight: yours ? 'semibold' : 'light' }),
          monospacedDigit(),
          ...(yours ? [foregroundStyle('#FFFFFF')] : [foregroundStyle({ type: 'hierarchical', style: 'primary' })]),
        ]}
      >
        {digits}
      </SwiftText>
      {meridiem ? (
        <SwiftText
          modifiers={[
            font({ size: 12 }),
            foregroundStyle(
              yours ? '#FFFFFFCC' : { type: 'hierarchical', style: 'secondary' },
            ),
          ]}
        >
          {meridiem}
        </SwiftText>
      ) : null}
    </HStack>
  );
}

/**
 * One time as a native Liquid Glass button filling its column: clear glass
 * for any bus, prominent systemBlue glass for yours. Native, so the press
 * feel and the glass are the system's own.
 */
function ClockButton({
  text,
  yours,
  onPress,
}: {
  text: string;
  yours: boolean;
  onPress: () => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.buttonHost}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle(yours ? 'glassProminent' : 'glass'),
          buttonBorderShape('capsule'),
          ...(yours ? [tint(SYSTEM_BLUE)] : []),
          accessibilityLabel(`${text}${yours ? ', your bus' : ''}`),
          accessibilityHint('Shows when it comes and when to leave'),
        ]}
      >
        <HStack modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: 24 })]}>
          <SwiftClock text={text} yours={yours} />
        </HStack>
      </Button>
    </Host>
  );
}

/**
 * Your bus's time on blue-tinted Liquid Glass (not a button), for grids
 * without a sheet to open. It bleeds out by its padding so the time stays
 * on the column edge.
 */
function GlassClock({ text }: { text: string }) {
  return (
    <Host matchContents style={styles.glassHost}>
      <HStack
        modifiers={[
          padding({ horizontal: CHIP_PAD, vertical: 4 }),
          glassEffect({ glass: { variant: 'regular', tint: SYSTEM_BLUE }, shape: 'capsule' }),
        ]}
      >
        <SwiftClock text={text} yours />
      </HStack>
    </Host>
  );
}

/**
 * Today's service window: first and last bus as label-over-value ends, with a
 * thin track between them filled up to now, so how much of the day's service
 * is left reads at a glance.
 */
function ServiceSpan({
  first,
  last,
  formatClock,
}: {
  first: number;
  last: number;
  formatClock: (epochMs: number) => string;
}) {
  const span = Math.max(1, last - first);
  const done = Math.min(1, Math.max(0, (Date.now() - first) / span));
  const firstText = formatClock(first);
  const lastText = formatClock(last);
  return (
    <View
      style={styles.span}
      accessible
      accessibilityLabel={`First bus ${firstText}, last bus ${lastText}`}
    >
      <View style={styles.spanEnd}>
        <Text style={styles.spanLabel}>First bus</Text>
        <ClockText text={firstText} style={styles.spanValue} />
      </View>
      <View style={styles.track}>
        <View style={[styles.trackDone, { width: `${done * 100}%` }]} />
        <View style={[styles.nowDot, { left: `${done * 100}%` }]} />
      </View>
      <View style={[styles.spanEnd, styles.spanEndRight]}>
        <Text style={styles.spanLabel}>Last bus</Text>
        <ClockText text={lastText} style={styles.spanValue} />
      </View>
    </View>
  );
}

const CHIP_PAD = 7;
const SYSTEM_BLUE = '#007AFF';
/** Half the gap between glass buttons. */
const BUTTON_GUTTER = 3;
const NOW_DOT = 7;

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingTop: space.xxs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.sm,
  },
  cell: {
    width: '25%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Buttons fill their column less a small gutter; the grid bleeds by the
  // same so the outer capsules line up with the sheet margin.
  gridButtons: {
    marginHorizontal: -BUTTON_GUTTER,
    rowGap: space.xs,
  },
  buttonCell: {
    paddingHorizontal: BUTTON_GUTTER,
  },
  buttonHost: {
    flex: 1,
  },
  time: {
    ...type.body,
    fontWeight: '300',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  meridiem: {
    fontSize: 13,
    fontWeight: '400',
    color: color.secondaryLabel,
  },
  // Bleeds out by its padding on both sides, so it never takes width from
  // the time and the time stays on the column edge.
  glassHost: {
    marginHorizontal: -CHIP_PAD,
    marginVertical: -4,
  },
  span: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  spanEnd: {
    gap: 2,
  },
  spanEndRight: {
    alignItems: 'flex-end',
  },
  spanLabel: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  spanValue: {
    ...type.body,
    fontWeight: '500',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 3,
    marginTop: 18,
    borderRadius: 1.5,
    backgroundColor: color.fill,
  },
  trackDone: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: color.tertiaryLabel,
  },
  nowDot: {
    position: 'absolute',
    top: (3 - NOW_DOT) / 2,
    width: NOW_DOT,
    height: NOW_DOT,
    marginLeft: -NOW_DOT / 2,
    borderRadius: NOW_DOT / 2,
    backgroundColor: color.ink,
  },
});
