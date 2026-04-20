import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { LiveDot } from './LiveDot';
import type { HeroState } from './logic';
import { heroStateColor, trackerSpacing } from './tokens';

interface HeroCountdownProps {
  state: HeroState;
  /** Primary numeric value shown in the hero (e.g. minutes to leave, or walk m:ss). */
  value: string;
  /** Unit label placed below the number (e.g. "minutes", "remaining", "walking"). */
  unit: string;
  /** Label above the number (e.g. "Leave in"). */
  eyebrow: string;
  /** Subtitle first line (usually the stop name). */
  subtitle: string;
  /** Subtitle second line (usually the updated ticker). */
  meta: string;
  /** Is the live feed stale? Shifts dot color to amber. */
  isStale: boolean;
  /** Route code shown in the top status line. */
  routeCode: string;
}

export function HeroCountdown({
  state,
  value,
  unit,
  eyebrow,
  subtitle,
  meta,
  isStale,
  routeCode,
}: HeroCountdownProps) {
  const dotColor = isStale ? heroStateColor.waiting : heroStateColor[state];
  const statusText = isStale ? 'Stale' : 'Live';

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <LiveDot color={dotColor} size={7} />
        <Text style={styles.statusText} selectable>
          {statusText} · {routeCode}
        </Text>
      </View>

      <Text style={styles.eyebrow} selectable>
        {eyebrow}
      </Text>

      <Animated.View
        key={`${eyebrow}-${value}`}
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(140)}
        style={styles.numberWrap}
      >
        <Text style={styles.number} selectable allowFontScaling={false}>
          {value}
        </Text>
      </Animated.View>

      {unit ? (
        <Text style={styles.unit} selectable>
          {unit}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.subtitle} selectable numberOfLines={1}>
          {subtitle}
        </Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.meta} selectable numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: trackerSpacing.heroTopPad,
    paddingBottom: trackerSpacing.heroBottomPad,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: PlatformColor('secondaryLabel'),
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  numberWrap: {
    alignItems: 'center',
  },
  number: {
    fontSize: 120,
    lineHeight: 130,
    fontWeight: '200',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -4,
    textAlign: 'center',
  },
  unit: {
    fontSize: 17,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('label'),
    flexShrink: 1,
  },
  dot: {
    fontSize: 14,
    color: PlatformColor('tertiaryLabel'),
  },
  meta: {
    fontSize: 14,
    color: PlatformColor('secondaryLabel'),
    flexShrink: 1,
  },
});
