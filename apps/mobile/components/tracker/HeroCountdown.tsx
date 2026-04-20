import type { RouteId } from '@bus-tracker/shared';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  SlideInDown,
  SlideOutUp,
} from 'react-native-reanimated';

import { PulsingDots } from '@/components/map/PulsingDots';

import { LiveDot } from './LiveDot';
import type { HeroState } from './logic';
import { RouteSwitcher } from './RouteSwitcher';
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
  /** Currently selected route. */
  selectedRoute: RouteId;
  /** Routes available in the switcher. */
  routeOptions: readonly RouteId[];
  /** Called when the user picks a different route. */
  onSelectRoute: (code: RouteId) => void;
}

const NUMBER_HEIGHT = 130;

export function HeroCountdown({
  state,
  value,
  unit,
  eyebrow,
  subtitle,
  meta,
  isStale,
  selectedRoute,
  routeOptions,
  onSelectRoute,
}: HeroCountdownProps) {
  const dotColor = isStale ? heroStateColor.waiting : heroStateColor[state];
  const statusText = isStale ? 'Stale' : 'Live';
  const isEmpty = value === '—';
  // Walking timer ticks every second — a slide on every tick feels chaotic, so
  // skip the layout animation in that state and let the text update in place.
  const isTicking = state === 'walking';

  return (
    <View style={styles.container}>
      <View style={styles.switcherRow}>
        <RouteSwitcher
          selected={selectedRoute}
          options={routeOptions}
          onSelect={onSelectRoute}
        />
      </View>

      <View style={styles.statusRow}>
        <LiveDot color={dotColor} size={7} />
        <Text style={styles.statusText} selectable>
          {statusText}
        </Text>
        {meta ? (
          <>
            <Text style={styles.statusDot}>·</Text>
            <Text style={styles.statusMeta} selectable numberOfLines={1}>
              {meta}
            </Text>
          </>
        ) : null}
      </View>

      <Text style={styles.eyebrow} selectable>
        {eyebrow}
      </Text>

      {isEmpty ? (
        <View style={styles.emptyBlock}>
          <PulsingDots
            color={PlatformColor('secondaryLabel')}
            size={12}
            gap={10}
          />
          <Text style={styles.emptyHint} selectable>
            Looking for the next one
          </Text>
        </View>
      ) : isTicking ? (
        <View style={styles.numberClip}>
          <Text style={styles.number} selectable allowFontScaling={false}>
            {value}
          </Text>
        </View>
      ) : (
        <View style={styles.numberClip}>
          <Animated.View
            key={value}
            entering={SlideInDown.duration(300).easing(
              Easing.out(Easing.cubic),
            )}
            exiting={SlideOutUp.duration(240).easing(Easing.in(Easing.cubic))}
            style={styles.numberSlide}
          >
            <Text style={styles.number} selectable allowFontScaling={false}>
              {value}
            </Text>
          </Animated.View>
        </View>
      )}

      {unit ? (
        <Text style={styles.unit} selectable>
          {unit}
        </Text>
      ) : null}

      <Text style={styles.subtitle} selectable numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: trackerSpacing.heroTopPad,
    paddingBottom: trackerSpacing.heroBottomPad,
    alignItems: 'center',
  },
  switcherRow: {
    alignItems: 'center',
    marginBottom: 12,
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
  statusDot: {
    fontSize: 12,
    fontWeight: '600',
    color: PlatformColor('tertiaryLabel'),
  },
  statusMeta: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: PlatformColor('tertiaryLabel'),
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  numberClip: {
    height: NUMBER_HEIGHT,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  numberSlide: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  number: {
    fontSize: 120,
    lineHeight: NUMBER_HEIGHT,
    fontWeight: '200',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -4,
    textAlign: 'center',
  },
  emptyBlock: {
    height: NUMBER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  emptyHint: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.1,
  },
  unit: {
    fontSize: 17,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    marginTop: 2,
  },
  subtitle: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '500',
    color: PlatformColor('label'),
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: 8,
  },
});
