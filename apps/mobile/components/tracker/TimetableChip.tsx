import { PlatformColor, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { GlassGuard, isGlassAvailable } from '@/components/GlassGuard';
import { glassTokens, surfaceColor } from './tokens';

interface TimetableChipProps {
  /** "HH:MM" clock display. */
  clock: string;
  /** Short countdown label ("in 12 min", "in 1h 20m", "now"). Ignored when `anchor`. */
  countdown: string;
  /** If true, this chip is the one matching the live "current" bus. The
   * countdown is hidden for the anchor — the LiveTrackCard already shows the
   * authoritative live ETA, and the scheduled countdown here would contradict
   * it whenever the bus is running off-schedule. */
  anchor?: boolean;
  /** Called on press — optional; chip remains keyboard/VO focusable either way. */
  onPress?: () => void;
  a11yLabel: string;
}

export function TimetableChip({
  clock,
  countdown,
  anchor,
  onPress,
  a11yLabel,
}: TimetableChipProps) {
  const Container = onPress ? Pressable : View;
  const glass = isGlassAvailable();
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.wrap}>
      <Container
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={a11yLabel}
      >
        <GlassGuard
          glassEffectStyle="regular"
          tintColor={anchor ? '#0A84FF' : undefined}
          style={[
            styles.chip,
            anchor
              ? glass
                ? styles.chipAnchorGlass
                : styles.chipAnchorFallback
              : glass
                ? styles.chipDefaultGlass
                : styles.chipDefaultFallback,
          ]}
        >
          <Text
            style={[styles.clock, anchor && styles.clockAnchor]}
            selectable
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {clock}
          </Text>
          {!anchor ? (
            <Text style={styles.countdown} selectable numberOfLines={1}>
              {countdown}
            </Text>
          ) : null}
        </GlassGuard>
      </Container>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginRight: 10,
  },
  chip: {
    width: 92,
    height: 60,
    borderRadius: glassTokens.chipRadius,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  chipDefaultGlass: {
    borderColor: surfaceColor.hairline,
  },
  chipDefaultFallback: {
    backgroundColor: surfaceColor.grouped,
    borderColor: surfaceColor.hairline,
  },
  chipAnchorGlass: {
    borderColor: 'rgba(10,132,255,0.45)',
  },
  chipAnchorFallback: {
    backgroundColor: surfaceColor.blueTint,
    borderColor: 'rgba(10,132,255,0.35)',
  },
  clock: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: PlatformColor('label'),
    letterSpacing: 0,
  },
  clockAnchor: {
    color: '#0A84FF',
  },
  countdown: {
    fontSize: 11,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.1,
  },
});
