import { PlatformColor, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { surfaceColor, trackerSpacing } from './tokens';

interface TimetableChipProps {
  /** "HH:MM" clock display. */
  clock: string;
  /** Short countdown label ("in 12 min", "in 1h 20m", "now"). */
  countdown: string;
  /** If true, this chip is the one matching the live "current" bus. */
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
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.wrap}>
      <Container
        style={[styles.chip, anchor ? styles.chipAnchor : styles.chipDefault]}
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={a11yLabel}
      >
        <Text
          style={[styles.clock, anchor && styles.clockAnchor]}
          selectable
          allowFontScaling={false}
        >
          {clock}
        </Text>
        <Text
          style={[styles.countdown, anchor && styles.countdownAnchor]}
          selectable
          numberOfLines={1}
        >
          {countdown}
        </Text>
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
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 8,
  },
  chipDefault: {
    backgroundColor: surfaceColor.grouped,
    borderColor: surfaceColor.hairline,
  },
  chipAnchor: {
    backgroundColor: surfaceColor.blueTint,
    borderColor: 'rgba(10,132,255,0.35)',
  },
  clock: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: PlatformColor('label'),
    letterSpacing: -0.2,
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
  countdownAnchor: {
    color: '#0A84FF',
  },
});

// Prevent lint from complaining about unused padding
void trackerSpacing;
