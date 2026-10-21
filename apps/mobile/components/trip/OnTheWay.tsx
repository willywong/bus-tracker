import { Button, HStack, Host, Image as SwiftImage, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { formatStopName } from '@/components/map/format';
import { useSheetBodyHidden } from '@/components/trip/SheetBody';
import type { StopRow } from '@/db/queries';
import type { JourneyData, JourneyStopNode } from '@/hooks/useJourneyStops';
import { color, hex, pick, space, type } from '@/theme/design';

const MAX_BETWEEN = 6;
const RAIL = 28;
const LINE = 2;
/** The glint crosses one full row of line in this long… */
const FLOW_ROW_MS = 260;
/** …and rests this long at your stop before the next pass. */
const FLOW_REST_MS = 1400;
const FLOW_LIGHT = { light: '#AEAEB2', dark: '#636366' };

/**
 * Stop-by-stop approach as a vertical timeline: one ink line from the bus
 * (an ink disc with a bus glyph) through the stops it still has to serve
 * (hollow rings) to your stop (ring and dot) with its arrival. The same
 * glyphs as the map. Stops are tappable when `onStopPress` is given.
 */
export function OnTheWay({
  journey,
  arrivalLabel,
  onStopPress,
}: {
  journey: JourneyData;
  /** "4 min" / "Due" / "10:42" for your stop row. */
  arrivalLabel: string | null;
  onStopPress?: (stopId: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const sheetHidden = useSheetBodyHidden();
  if (!journey.ready || !journey.userStop || !journey.busStop) return null;

  const between = journey.upcoming;
  const hidden = Math.max(0, between.length - MAX_BETWEEN);
  // Keep the stops nearest your stop; collapse the far end.
  const shown = hidden > 0 ? between.slice(hidden) : between;
  const count = 2 + (hidden > 0 ? 1 : 0) + shown.length;
  // A glint runs down the line from the bus to your stop: the way it's
  // coming. Restarted whenever the bus moves on, so every row stays in step.
  const flowKey = reduceMotion || sheetHidden ? null : `${journey.busStop.stopId}-${count}`;
  const flow = (index: number): Flow | undefined =>
    flowKey ? { index, count, key: flowKey } : undefined;
  let i = 0;

  return (
    <View>
      <Row
        kind="bus"
        stop={journey.busStop}
        trailing="now"
        first
        onPress={onStopPress}
        flow={flow(i++)}
      />
      {hidden > 0 ? (
        <Row
          kind="collapsed"
          label={`${hidden} more ${hidden === 1 ? 'stop' : 'stops'}`}
          flow={flow(i++)}
        />
      ) : null}
      {shown.map((s) => (
        <Row
          key={`${s.stopId}-${s.sequence}`}
          kind="stop"
          stop={s}
          onPress={onStopPress}
          flow={flow(i++)}
        />
      ))}
      <Row
        kind="user"
        stop={journey.userStop}
        trailing={arrivalLabel}
        last
        onPress={onStopPress}
        flow={flow(i++)}
      />
    </View>
  );
}

/**
 * Every stop on the route as the same timeline, for the stops sheet: your
 * stop marked, live buses drawn at the stop they're nearest, each stop
 * tappable.
 */
export function RouteStops({
  stops,
  userStopId,
  busStopIds,
  onStopPress,
}: {
  stops: readonly StopRow[];
  userStopId: string;
  /** Stops a live bus is nearest to right now. */
  busStopIds: ReadonlySet<string>;
  onStopPress?: (stopId: string) => void;
}) {
  if (stops.length === 0) return null;

  return (
    <View>
      {stops.map((s, i) => {
        const node: JourneyStopNode = {
          stopId: s.stop_id,
          name: s.stop_name,
          sequence: i,
          lat: s.stop_lat,
          lng: s.stop_lon,
        };
        const isUser = s.stop_id === userStopId;
        const hasBus = busStopIds.has(s.stop_id);
        const first = i === 0;
        const last = i === stops.length - 1;
        return isUser ? (
          <Row
            key={s.stop_id}
            kind="user"
            stop={node}
            trailing={hasBus ? 'Bus here' : 'Your stop'}
            first={first}
            last={last}
            onPress={onStopPress}
          />
        ) : (
          <Row
            key={s.stop_id}
            kind={hasBus ? 'bus' : 'stop'}
            stop={node}
            trailing={hasBus ? 'Bus here' : null}
            first={first}
            last={last}
            onPress={onStopPress}
          />
        );
      })}
    </View>
  );
}

/**
 * "All 15 stops ›" under the On the way timeline: a Liquid Glass capsule
 * lined up with the stop names, opening every stop in its own sheet.
 */
export function AllStopsButton({ count, onPress }: { count: number; onPress: () => void }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={styles.more}>
      <Host matchContents>
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('capsule'),
            controlSize('regular'),
            tint(pick(hex.ink, scheme)),
            accessibilityHint('Opens every stop on this route'),
          ]}
        >
          <HStack spacing={6}>
            <SwiftText modifiers={[font({ size: 15, weight: 'medium' })]}>
              {`All ${count} stops`}
            </SwiftText>
            <SwiftImage
              systemName="chevron.right"
              size={12}
              modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}
            />
          </HStack>
        </Button>
      </Host>
    </View>
  );
}

/** The stop each live bus is nearest to, for marking buses on the list. */
export function nearestStopIds(
  buses: readonly { lat: number; lng: number }[],
  stops: readonly StopRow[],
): Set<string> {
  const out = new Set<string>();
  for (const b of buses) {
    let best = Infinity;
    let id: string | null = null;
    for (const s of stops) {
      const d =
        (s.stop_lat - b.lat) ** 2 + ((s.stop_lon - b.lng) * Math.cos((b.lat * Math.PI) / 180)) ** 2;
      if (d < best) {
        best = d;
        id = s.stop_id;
      }
    }
    if (id) out.add(id);
  }
  return out;
}

/** Where a row sits in the timeline, for the glint running down it. */
type Flow = { index: number; count: number; key: string };

type RowProps = {
  first?: boolean;
  last?: boolean;
  onPress?: (stopId: string) => void;
  flow?: Flow;
} & (
  | { kind: 'bus' | 'stop'; stop: JourneyStopNode; trailing?: string | null }
  | { kind: 'user'; stop: JourneyStopNode; trailing: string | null }
  | { kind: 'collapsed'; label: string; trailing?: null }
);

function Row(props: RowProps) {
  const title = props.kind === 'collapsed' ? props.label : formatStopName(props.stop.name);
  const a11y =
    props.kind === 'user'
      ? `Your stop, ${title}${props.trailing ? `, ${props.trailing}` : ''}`
      : props.kind === 'bus'
        ? `Bus now near ${title}`
        : title;
  const stopId = props.kind === 'collapsed' ? null : props.stop.stopId;
  const onPress = stopId && props.onPress ? () => props.onPress?.(stopId) : undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y}
      accessibilityHint={onPress ? 'Shows this stop' : undefined}
    >
      {({ pressed }) => (
        <View style={[styles.row, pressed && onPress ? styles.pressed : null]}>
          <View style={styles.rail}>
            <View
              style={[
                styles.line,
                props.first && styles.lineFromMiddle,
                props.last && styles.lineToMiddle,
                props.kind === 'collapsed' && styles.lineFaint,
              ]}
            >
              {props.flow ? <Glint key={props.flow.key} flow={props.flow} /> : null}
            </View>
            <Node kind={props.kind} />
          </View>
          <Text
            style={[
              styles.title,
              props.kind === 'user' && styles.titleUser,
              props.kind === 'bus' && styles.titleBus,
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
      )}
    </Pressable>
  );
}

/**
 * This row's share of the glint running down the line. Every row runs one
 * cycle of the same length from the same moment; each lights its own
 * segment in turn (the first and last rows hold half a segment, from or to
 * the node), so together they read as one band sliding from the bus to
 * your stop, then a rest. It runs under the nodes, inside the line, on the
 * UI thread.
 */
function Glint({ flow }: { flow: Flow }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const light = pick(FLOW_LIGHT, scheme);
  const { index, count } = flow;
  const last = index === count - 1;
  const travel = Math.max(1, count - 1) * FLOW_ROW_MS;
  const cycle = travel + FLOW_REST_MS;
  const start = index === 0 ? 0 : FLOW_ROW_MS / 2 + (index - 1) * FLOW_ROW_MS;
  const span = index === 0 || last ? FLOW_ROW_MS / 2 : FLOW_ROW_MS;
  const at = (ms: number) => `${((ms / cycle) * 100).toFixed(2)}%`;
  const keyframes = {
    '0%': { transform: [{ translateY: '-100%' }] },
    [at(start)]: { transform: [{ translateY: '-100%' }] },
    [at(start + span)]: { transform: [{ translateY: '100%' }] },
    '100%': { transform: [{ translateY: '100%' }] },
  };
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundImage: `linear-gradient(180deg, ${light}00 0%, ${light} 50%, ${light}00 100%)`,
          transform: [{ translateY: '-100%' }],
          animationName: keyframes,
          animationDuration: cycle,
          animationIterationCount: 'infinite',
          animationTimingFunction: 'linear',
        },
      ]}
    />
  );
}

function Node({ kind }: { kind: RowProps['kind'] }) {
  if (kind === 'bus') {
    return (
      <View style={styles.busNode}>
        <SymbolView name="bus.fill" size={11} tintColor={color.paper} />
      </View>
    );
  }
  if (kind === 'user') {
    return (
      <View style={styles.userNode}>
        <View style={styles.userDot} />
      </View>
    );
  }
  if (kind === 'collapsed') {
    return (
      <SymbolView
        name="ellipsis"
        size={11}
        tintColor={color.tertiaryLabel}
        style={styles.ellipsis}
      />
    );
  }
  return <View style={styles.stopNode} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: space.sm,
  },
  pressed: {
    opacity: 0.55,
  },
  rail: {
    width: RAIL,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Runs the full row height so consecutive rows join into one line.
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: LINE,
    backgroundColor: color.label,
    overflow: 'hidden',
  },
  lineFromMiddle: {
    top: '50%',
  },
  lineToMiddle: {
    bottom: '50%',
  },
  lineFaint: {
    backgroundColor: color.tertiaryLabel,
  },
  busNode: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.label,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNode: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
    borderColor: color.label,
    backgroundColor: color.paper,
  },
  userNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.label,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.label,
  },
  more: {
    flexDirection: 'row',
    paddingTop: space.xs,
    paddingBottom: space.sm,
    paddingLeft: RAIL + space.sm - 12,
  },
  ellipsis: {
    width: 14,
    height: 14,
    backgroundColor: color.paper,
  },
  title: {
    ...type.body,
    fontSize: 16,
    flex: 1,
    color: color.label,
  },
  titleBus: {
    fontWeight: '500',
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
