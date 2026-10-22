import { DisclosureGroup, Host, Text as SwiftText, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, lineLimit, tint } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';

import { LineBadge } from '@/components/rail/LineBadge';
import { formatClockHHMM } from '@/components/tracker/logic';
import { SourceMark } from '@/components/trip/Hero';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { color, hex, pick, space, type } from '@/theme/design';

import {
  railBetween,
  rideSummary,
  timelineLabels,
  type RailStyle,
  type RideChip,
  type TimeCell,
  type TimelineRow,
} from './model';

/** Columns: the time (right-aligned), the rail, then the content. */
const TIME_COL = 52;
const RAIL_COL = 24;
const LINE = 4;
const NODE = 12;
const END_NODE = 16;
/** Walk rails: 3pt dots every 7pt, as the journey bar. */
const DOT = 3;
const DOT_PITCH = 7;
/** Node rows: the node sits on the first line of text (12pt padding + half a 20pt line). */
const ROW_PAD = 12;
const NODE_Y = ROW_PAD + 10;
const MIN_ROW = 44;

type RideRow = Extract<TimelineRow, { kind: 'ride' }>;

/**
 * The itinerary as a vertical timeline (spec §6.3): a time column, a 4pt
 * rail (ink for a bus, the line colour for rail, dots for a walk) and the
 * content. Stops are rings, stations squares in the line colour, the start
 * a ringed pin and the destination a solid disc. Live times are ink with
 * the live dot; scheduled ones secondary with a clock; a frequent rail leg
 * reads "every 6 mins" instead of a time, a less frequent one "about".
 *
 * A ride's stops in between sit in a SwiftUI `DisclosureGroup`; its host
 * matches the group's height, so the rail beside it stretches as it opens.
 * Tapping a walk or a ride fits the map to that leg; tapping a station
 * opens it. Each row is one VoiceOver element (the disclosure is its own).
 */
export function Timeline({
  rows,
  onLegPress,
  onStationPress,
}: {
  rows: readonly TimelineRow[];
  onLegPress: (legIndex: number) => void;
  onStationPress: (stationId: string) => void;
}) {
  const labels = useMemo(() => timelineLabels(rows, formatClockHHMM), [rows]);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  return (
    <View>
      {rows.map((row, i) => {
        const above = i > 0 ? railBetween(rows[i - 1], row) : null;
        const below = i < rows.length - 1 ? railBetween(row, rows[i + 1]) : null;
        const key = `${row.kind}-${'legIndex' in row ? row.legIndex : row.which}`;
        switch (row.kind) {
          case 'end':
          case 'board':
          case 'alight': {
            const end = row.kind === 'end' ? row.which : row.end;
            const stationId = row.kind === 'end' ? null : row.stationId;
            const onPress = stationId ? () => onStationPress(stationId) : undefined;
            return (
              <Pressable
                key={key}
                onPress={onPress}
                disabled={!onPress}
                accessible
                accessibilityRole={onPress ? 'button' : undefined}
                accessibilityLabel={labels[i]}
                accessibilityHint={onPress ? 'Opens the station' : undefined}
              >
                {({ pressed }) => (
                  <View style={[styles.row, styles.nodeRow, pressed && onPress ? styles.pressed : null]}>
                    <TimeColumn time={row.time} />
                    <View style={styles.rail}>
                      <Segment style={above} top={0} height={NODE_Y} />
                      <Segment style={below} top={NODE_Y} />
                      <View style={styles.nodeSlot}>
                        <Node
                          kind={end ?? (row.kind === 'end' ? 'origin' : row.node)}
                          color={row.kind === 'end' ? null : row.color}
                        />
                      </View>
                    </View>
                    <View style={styles.content}>
                      <View style={styles.nameLine}>
                        <Text
                          style={[styles.name, (row.kind === 'end' || end) && styles.nameEnd]}
                          numberOfLines={2}
                        >
                          {row.name}
                        </Text>
                        {onPress ? (
                          <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
                        ) : null}
                      </View>
                      {row.kind !== 'end' ? <NodeNote time={row.time} liveNote={row.liveNote} /> : null}
                    </View>
                  </View>
                )}
              </Pressable>
            );
          }
          case 'walk':
            return (
              <Pressable
                key={key}
                onPress={() => onLegPress(row.legIndex)}
                accessibilityRole="button"
                accessibilityLabel={labels[i]}
                accessibilityHint="Shows this walk on the map"
              >
                {({ pressed }) => (
                  <View style={[styles.row, styles.walkRow, pressed ? styles.pressed : null]}>
                    <View style={styles.time} />
                    <View style={styles.rail}>
                      <Segment style={{ kind: 'walk' }} top={0} />
                    </View>
                    <View style={[styles.content, styles.walkContent]}>
                      <SymbolView name="figure.walk" size={14} weight="regular" tintColor={color.secondaryLabel} />
                      <Text style={styles.walkText} numberOfLines={1}>
                        {row.label}
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          case 'ride':
            return (
              <View key={key} style={[styles.row, styles.rideRow]}>
                <View style={styles.time} />
                <View style={styles.rail}>
                  <Segment style={above ?? below} top={0} />
                </View>
                <View style={styles.content}>
                  <Pressable
                    onPress={() => onLegPress(row.legIndex)}
                    accessibilityRole="button"
                    accessibilityLabel={labels[i]}
                    accessibilityHint="Shows this ride on the map"
                  >
                    {({ pressed }) => (
                      <View style={[styles.rideHead, pressed ? styles.pressed : null]}>
                        <ChipView chip={row.chip} />
                        <Text style={styles.towards} numberOfLines={1}>
                          {`towards ${row.headsign}`}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  <RideStops
                    row={row}
                    expanded={open[row.legIndex] ?? false}
                    onExpandedChange={(on) => setOpen((o) => ({ ...o, [row.legIndex]: on }))}
                  />
                </View>
              </View>
            );
        }
      })}
    </View>
  );
}

/** "6 stops · 14 mins", opening onto the stops in between; plain text when there are none. */
function RideStops({
  row,
  expanded,
  onExpandedChange,
}: {
  row: RideRow;
  expanded: boolean;
  onExpandedChange: (on: boolean) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const summary = rideSummary(row);
  if (row.stops.length === 0) return <Text style={styles.summary}>{summary}</Text>;
  return (
    <Host matchContents={{ vertical: true }} style={styles.disclosure}>
      <DisclosureGroup
        isExpanded={expanded}
        onIsExpandedChange={onExpandedChange}
        modifiers={[tint(pick(hex.ink, scheme))]}
      >
        <DisclosureGroup.Label>
          <SwiftText
            modifiers={[font({ size: type.status.fontSize }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}
          >
            {summary}
          </SwiftText>
        </DisclosureGroup.Label>
        <VStack spacing={6} alignment="leading" modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: 'leading' })]}>
          {row.stops.map((name, i) => (
            <SwiftText
              key={`${i}-${name}`}
              modifiers={[
                font({ size: 13 }),
                lineLimit(1),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              {name}
            </SwiftText>
          ))}
        </VStack>
      </DisclosureGroup>
    </Host>
  );
}

function ChipView({ chip }: { chip: RideChip }) {
  if (chip.kind === 'bus') return <RouteBadge code={chip.label} size="small" />;
  return (
    <LineBadge
      size="small"
      line={{ code: chip.label, name: chip.name, color: chip.color, textColor: chip.textColor }}
    />
  );
}

/** Live: ink with the live dot. Scheduled: secondary with a clock. About: secondary, "about" under it. Every: empty. */
function TimeColumn({ time }: { time: TimeCell }) {
  if (!time || time.kind === 'every') return <View style={styles.time} />;
  const text = formatClockHHMM(time.at);
  return (
    <View style={[styles.time, styles.timeCell]}>
      <View style={styles.timeLine}>
        {time.kind === 'live' ? <SourceMark source="live" size={9} /> : null}
        {time.kind === 'scheduled' ? <SourceMark source="scheduled" size={10} /> : null}
        <Text
          style={[styles.timeText, time.kind !== 'live' && styles.timeQuiet]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {text}
        </Text>
      </View>
      {time.kind === 'about' ? <Text style={styles.about}>about</Text> : null}
    </View>
  );
}

/** Under a stop or station: "Live · as of 08:41", or "every 6 mins" where a time would be. */
function NodeNote({ time, liveNote }: { time: TimeCell; liveNote: string | null }) {
  if (liveNote) return <Text style={styles.note}>{liveNote}</Text>;
  if (time?.kind === 'every') return <Text style={styles.note}>{`every ${time.minutes} ${time.minutes === 1 ? 'min' : 'mins'}`}</Text>;
  return null;
}

function Node({ kind, color: line }: { kind: 'origin' | 'destination' | 'stop' | 'station'; color: string | null }) {
  switch (kind) {
    case 'origin':
      return (
        <View style={styles.originNode}>
          <View style={styles.originDot} />
        </View>
      );
    case 'destination':
      return (
        <View style={styles.destNode}>
          <View style={styles.destRing} />
        </View>
      );
    case 'station':
      return <View style={[styles.stationNode, { backgroundColor: line ?? color.ink }]} />;
    default:
      return <View style={styles.stopNode} />;
  }
}

/** One stretch of rail, from `top` to `top + height` (or the row's bottom). */
function Segment({ style, top, height }: { style: RailStyle | null; top: number; height?: number }) {
  if (!style || style.kind === 'gap') return null;
  const box: StyleProp<ViewStyle> = [styles.segment, { top }, height != null ? { height } : { bottom: 0 }];
  if (style.kind === 'walk') return <Dots style={box} />;
  return <View style={[box, styles.line, { backgroundColor: style.kind === 'line' ? style.color : color.ink }]} />;
}

/**
 * A column of dots counted from the measured height. Not `borderStyle:
 * 'dotted'`: iOS draws that only when all four borders match.
 */
function Dots({ style }: { style: StyleProp<ViewStyle> }) {
  const [count, setCount] = useState(0);
  return (
    <View
      style={[style, styles.dots]}
      onLayout={(e) => {
        const n = Math.max(1, Math.floor((e.nativeEvent.layout.height + DOT_PITCH - DOT) / DOT_PITCH));
        if (n !== count) setCount(n);
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.dot} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.xs,
  },
  nodeRow: {
    minHeight: MIN_ROW,
  },
  walkRow: {
    minHeight: 40,
  },
  rideRow: {
    minHeight: MIN_ROW,
  },
  pressed: {
    opacity: 0.55,
  },
  time: {
    width: TIME_COL,
  },
  timeCell: {
    paddingTop: ROW_PAD,
    alignItems: 'flex-end',
  },
  timeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    height: 20,
  },
  timeText: {
    ...type.status,
    fontSize: 14,
    flexShrink: 1,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  timeQuiet: {
    color: color.secondaryLabel,
  },
  about: {
    ...type.caption,
    fontWeight: '400',
    color: color.secondaryLabel,
  },
  rail: {
    width: RAIL_COL,
    alignSelf: 'stretch',
  },
  segment: {
    position: 'absolute',
    left: (RAIL_COL - LINE) / 2,
    width: LINE,
  },
  line: {
    borderRadius: LINE / 2,
  },
  dots: {
    left: (RAIL_COL - DOT) / 2,
    width: DOT,
    alignItems: 'center',
    gap: DOT_PITCH - DOT,
    overflow: 'hidden',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: color.ink,
  },
  nodeSlot: {
    position: 'absolute',
    top: NODE_Y - END_NODE / 2,
    left: 0,
    right: 0,
    height: END_NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNode: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 2,
    borderColor: color.ink,
    backgroundColor: color.paper,
  },
  stationNode: {
    width: NODE,
    height: NODE,
    borderRadius: 2,
  },
  originNode: {
    width: END_NODE,
    height: END_NODE,
    borderRadius: END_NODE / 2,
    borderWidth: 2,
    borderColor: color.ink,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  originDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.ink,
  },
  destNode: {
    width: END_NODE,
    height: END_NODE,
    borderRadius: END_NODE / 2,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destRing: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: color.paper,
  },
  content: {
    flex: 1,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingTop: ROW_PAD - 1,
    minHeight: ROW_PAD + 21,
  },
  name: {
    ...type.body,
    fontSize: 16,
    flex: 1,
    color: color.label,
  },
  nameEnd: {
    fontWeight: '600',
  },
  note: {
    ...type.footnote,
    color: color.secondaryLabel,
    paddingBottom: ROW_PAD,
  },
  walkContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  walkText: {
    ...type.status,
    flexShrink: 1,
    color: color.secondaryLabel,
  },
  rideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingTop: space.xs,
    minHeight: 32,
  },
  towards: {
    ...type.status,
    flexShrink: 1,
    color: color.label,
  },
  summary: {
    ...type.status,
    color: color.secondaryLabel,
    paddingTop: 4,
    paddingBottom: space.xs,
  },
  disclosure: {
    alignSelf: 'stretch',
    marginTop: 4,
    marginBottom: space.xs,
  },
});
