import type { ReactNode } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { PulsingDots } from '@/components/map/PulsingDots';

import type { HeroState } from './logic';
import { RouteSwitcher } from './RouteSwitcher';
import { trackerSpacing } from './tokens';

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
  /** Optional caption below the unit — e.g. "4 min to spare" during a walk. */
  detail?: string | null;
  /** Currently selected route. Null when the favorites list is empty. */
  selectedRoute: string | null;
  /** Routes available in the switcher. */
  routeOptions: readonly string[];
  /** Called when the user picks a different route. */
  onSelectRoute: (code: string) => void;
  /** Called when the user taps "Add bus" (or the empty-state trigger). */
  onAddBus: () => void;
  /** Optional trailing content rendered flush-right on the switcher row. */
  trailing?: ReactNode;
}

const NUMBER_HEIGHT = 130;

export function HeroCountdown({
  state,
  value,
  unit,
  eyebrow,
  subtitle,
  detail,
  selectedRoute,
  routeOptions,
  onSelectRoute,
  onAddBus,
  trailing,
}: HeroCountdownProps) {
  const isEmpty = value === '—';
  // Walking timer ticks every second — a slide on every tick feels chaotic, so
  // skip the layout animation in that state and let the text update in place.
  const isTicking = state === 'walking';
  const numberStyle =
    state === 'hurry' ? [styles.number, styles.numberHurry] : styles.number;
  const detailStyle =
    state === 'hurry' ? [styles.detail, styles.detailHurry] : styles.detail;

  return (
    <View style={styles.container}>
      <View style={styles.switcherRow}>
        <RouteSwitcher
          selected={selectedRoute}
          options={routeOptions}
          onSelect={onSelectRoute}
          onAddBus={onAddBus}
        />
        {trailing ? <View style={styles.trailingSlot}>{trailing}</View> : null}
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
            entering={FadeIn.duration(260).easing(Easing.out(Easing.quad))}
            exiting={FadeOut.duration(180).easing(Easing.in(Easing.quad))}
            style={styles.numberSlide}
          >
            <Text style={numberStyle} selectable allowFontScaling={false}>
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

      {detail ? (
        <Text style={detailStyle} selectable numberOfLines={2}>
          {detail}
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
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: trackerSpacing.rowH,
    marginBottom: 16,
  },
  trailingSlot: {
    position: 'absolute',
    right: trackerSpacing.rowH,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
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
  numberHurry: {
    color: '#FF453A',
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
  detail: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#30D158',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  detailHurry: {
    color: '#FF453A',
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
