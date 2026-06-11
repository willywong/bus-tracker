import { useEffect, useMemo } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { bentoTokens } from './tokens';

interface ProgressRingProps {
  /** 0..1 fraction of the approach complete. Lights ticks up to this point. */
  progress: number;
  /** Lit-tick + accent color (usually `statusColor(screenStatus)`). */
  color: string;
  /** Big center value, e.g. "3", "Now", "Soon", "—". */
  centerValue: string;
  /** Small unit under the value, e.g. "min". Omit for word values. */
  centerUnit?: string;
  /** Tiny label at the top of the dial. */
  label?: string;
  /** Dim everything (stale feed). */
  subdued?: boolean;
}

const UNLIT = 'rgba(255,255,255,0.14)';

/**
 * A speedometer-style approach gauge. Ticks arranged over a 270° arc light up
 * to `progress` so the bus closing in physically fills the dial; the ETA lives
 * in the center. Built from rotated tick Views (no SVG / gradient deps).
 */
export function ProgressRing({
  progress,
  color,
  centerValue,
  centerUnit,
  label,
  subdued,
}: ProgressRingProps) {
  const size = bentoTokens.ringSize;
  const count = bentoTokens.ringTickCount;
  const span = bentoTokens.ringArcSpanDeg;
  const start = -span / 2;

  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const leadingIndex = Math.round(p * (count - 1));

  const ticks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const f = count > 1 ? i / (count - 1) : 0;
        return { i, angle: start + f * span, lit: f <= p + 1e-6 };
      }),
    [count, span, start, p],
  );

  // Gentle pulse on the leading lit tick — the "live edge" of the approach.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={[styles.root, { width: size, height: size }, subdued && styles.subdued]}
    >
      {ticks.map((tick) => (
        <View
          key={tick.i}
          style={[styles.tickWrap, { width: size, height: size, transform: [{ rotate: `${tick.angle}deg` }] }]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.tick,
              { backgroundColor: tick.lit ? color : UNLIT },
            ]}
          />
        </View>
      ))}

      {/* Pulsing leading edge */}
      {p > 0 ? (
        <Animated.View
          style={[
            styles.tickWrap,
            { width: size, height: size, transform: [{ rotate: `${start + (leadingIndex / (count - 1)) * span}deg` }] },
            pulseStyle,
          ]}
          pointerEvents="none"
        >
          <View style={[styles.tick, styles.tickLead, { backgroundColor: color }]} />
        </Animated.View>
      ) : null}

      <View style={styles.center} pointerEvents="none">
        {label ? (
          <Text style={styles.label} allowFontScaling={false} selectable>
            {label}
          </Text>
        ) : null}
        <Animated.Text
          key={centerValue}
          entering={FadeIn.duration(220)}
          style={[styles.value, centerValue.length > 2 && styles.valueWord]}
          allowFontScaling={false}
          numberOfLines={1}
          selectable
        >
          {centerValue}
        </Animated.Text>
        {centerUnit ? (
          <Text style={styles.unit} allowFontScaling={false} selectable>
            {centerUnit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  subdued: {
    opacity: 0.5,
  },
  tickWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tick: {
    width: bentoTokens.ringTickWidth,
    height: bentoTokens.ringTickLength,
    borderRadius: bentoTokens.ringTickWidth / 2,
    marginTop: 4,
  },
  tickLead: {
    height: bentoTokens.ringTickLength + 3,
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
    marginBottom: 2,
  },
  value: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 48,
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
  },
  valueWord: {
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
  },
  unit: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    marginTop: -2,
  },
});
