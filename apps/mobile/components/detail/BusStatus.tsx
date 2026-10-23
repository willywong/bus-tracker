import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Fragment } from 'react';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import type { BusJourney, BusStateKind } from '@/components/detail/model';
import { Hairline } from '@/components/trip/Rows';
import { color, CSS_EASE_OUT, space, type } from '@/theme/design';

/** Stops drawn on the track; past this it's a scale, not a count. */
const MAX_DOTS = 10;
const END = 26;

/**
 * Each state's glyph and colour: green while it moves freely, orange when
 * something holds it up (traffic, a light, an old fix), ink when it's simply
 * stopped, grey once it's gone. `text` is the readable shade for the words.
 */
const LOOK: Record<BusStateKind, { icon: SFSymbol; tint: ColorValue; text: ColorValue }> = {
  moving: { icon: 'gauge.with.dots.needle.67percent', tint: color.live, text: color.liveText },
  slow: { icon: 'gauge.with.dots.needle.33percent', tint: color.warning, text: color.warningText },
  'at-signal': { icon: 'hand.raised.fill', tint: color.warning, text: color.warningText },
  'at-stop': { icon: 'figure.wave', tint: color.label, text: color.label },
  stopped: { icon: 'pause.fill', tint: color.label, text: color.label },
  'on-route': { icon: 'bus.fill', tint: color.label, text: color.label },
  stale: { icon: 'clock.badge.exclamationmark', tint: color.warning, text: color.warningText },
  lost: {
    icon: 'antenna.radiowaves.left.and.right.slash',
    tint: color.secondaryLabel,
    text: color.secondaryLabel,
  },
};

/** States where the bus is actually rolling: its disc on the track pulses. */
const ROLLING: readonly BusStateKind[] = ['moving', 'slow'];

/**
 * What the bus is doing now, straight on the sheet under the hero:
 *
 *   ─────────────────────────────────────────
 *   ◔ On the move                          29
 *     Near Pusat Perniagaan SS2          km/h
 *
 *   (🚌)━━━•━━━•━━━•━━━•━━━(🧍)
 *   4 stops · 1.6 km        Hotel Lisa De Inn
 *
 * The state reads in its colour; the bus on the track wears the same colour
 * and breathes while it rolls. The track is the way to your stop, a dot per
 * stop between, left out once it has passed you or isn't heading your way.
 */
export function BusStatus({ journey }: { journey: BusJourney }) {
  const { state, toGo } = journey;
  const look = LOOK[state.kind];
  const stops =
    toGo?.stopsAway == null
      ? null
      : toGo.stopsAway <= 0
        ? 'Next stop'
        : `${toGo.stopsAway} ${toGo.stopsAway === 1 ? 'stop' : 'stops'}`;
  const way = toGo ? [stops, toGo.distance].filter(Boolean).join(' · ') : null;

  return (
    <View>
      <Hairline />
      <View
        style={styles.state}
        accessible
        accessibilityLabel={[
          state.title,
          state.speedKmh != null ? `${state.speedKmh} kilometres an hour` : null,
          state.detail,
        ]
          .filter(Boolean)
          .join(', ')}
      >
        <View style={styles.words}>
          <View style={styles.titleRow}>
            <SymbolView name={look.icon} size={16} weight="semibold" tintColor={look.tint} />
            <Text style={[styles.title, { color: look.text }]} numberOfLines={1}>
              {state.title}
            </Text>
          </View>
          {state.detail ? (
            <Text style={styles.detail} numberOfLines={1}>
              {state.detail}
            </Text>
          ) : null}
        </View>
        {state.speedKmh != null ? (
          <View style={styles.speed}>
            <Text style={styles.speedValue}>{state.speedKmh}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
        ) : null}
      </View>

      {toGo ? (
        <View style={styles.way} accessible accessibilityLabel={`${way} to ${toGo.stopName}`}>
          <Track stops={toGo.stopsAway} tint={look.tint} rolling={ROLLING.includes(state.kind)} />
          <View style={styles.wayText}>
            <Text style={styles.wayValue} numberOfLines={1}>
              {way}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {toGo.stopName}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The state on one line, for the peek under its card, where the rail
 * already shows the way: "◔ Slow traffic · Near Bomba SS2      8 km/h".
 */
export function BusStateLine({ journey }: { journey: BusJourney }) {
  const { state } = journey;
  const look = LOOK[state.kind];
  return (
    <View>
      <Hairline />
      <View
        style={styles.line}
        accessible
        accessibilityLabel={[
          state.title,
          state.speedKmh != null ? `${state.speedKmh} kilometres an hour` : null,
          state.detail,
        ]
          .filter(Boolean)
          .join(', ')}
      >
        <SymbolView name={look.icon} size={15} weight="semibold" tintColor={look.tint} />
        <Text style={styles.lineText} numberOfLines={1}>
          <Text style={[styles.lineTitle, { color: look.text }]}>{state.title}</Text>
          {state.detail ? <Text style={styles.detail}>{`  ·  ${state.detail}`}</Text> : null}
        </Text>
        {state.speedKmh != null ? (
          <Text style={styles.lineSpeed}>{`${state.speedKmh} km/h`}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** The bus in its state's colour, a dot for each stop before yours, and your stop. */
function Track({
  stops,
  tint,
  rolling,
}: {
  stops: number | null;
  tint: ColorValue;
  rolling: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const dots = Math.min(Math.max(stops ?? 0, 0), MAX_DOTS);
  return (
    <View style={styles.track}>
      <View style={styles.endBox}>
        {rolling && !reduceMotion ? (
          <Animated.View style={[styles.end, styles.pulse, { backgroundColor: tint }, PULSE]} />
        ) : null}
        <View style={[styles.end, { backgroundColor: tint }]}>
          <SymbolView name="bus.fill" size={12} tintColor={color.paper} />
        </View>
      </View>
      {Array.from({ length: dots }, (_, i) => (
        <Fragment key={i}>
          <View style={styles.rail} />
          <View style={styles.dot} />
        </Fragment>
      ))}
      <View style={styles.rail} />
      <View style={[styles.end, styles.you]}>
        <SymbolView name="figure.stand" size={13} tintColor={color.paper} />
      </View>
    </View>
  );
}

/** A soft ring every two seconds while the bus rolls, as the live dot does. */
const PULSE = {
  animationName: {
    from: { opacity: 0.45, transform: [{ scale: 1 }] },
    to: { opacity: 0, transform: [{ scale: 1.9 }] },
  },
  animationDuration: 2000,
  animationIterationCount: 'infinite',
  animationTimingFunction: CSS_EASE_OUT,
} as const;

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: space.sm,
  },
  lineText: {
    ...type.status,
    flex: 1,
  },
  lineTitle: {
    fontWeight: '600',
  },
  lineSpeed: {
    ...type.status,
    fontWeight: '600',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
  },
  words: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    ...type.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  detail: {
    ...type.status,
    color: color.secondaryLabel,
  },
  speed: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  speedValue: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '200',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  speedUnit: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  way: {
    gap: space.sm,
    paddingTop: space.lg,
  },
  wayText: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  wayValue: {
    ...type.status,
    fontWeight: '600',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  endBox: {
    width: END,
    height: END,
  },
  end: {
    width: END,
    height: END,
    borderRadius: END / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
  },
  you: {
    backgroundColor: color.label,
  },
  rail: {
    flex: 1,
    height: 2,
    backgroundColor: color.quaternaryLabel,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.secondaryLabel,
  },
});
