import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

import { safeImpact, safeNotification } from './haptics';
import { heroStateColor, trackerSpacing } from './tokens';

interface WalkCtaProps {
  isWalking: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** True when the bus countdown is in the leave-now window. */
  isLeaveNow: boolean;
}

const destructive = '#FF453A';

export function WalkCta({
  isWalking,
  onStart,
  onCancel,
  isLeaveNow,
}: WalkCtaProps) {
  const handleStart = () => {
    safeNotification(Haptics.NotificationFeedbackType.Success);
    onStart();
  };

  const handleCancel = () => {
    safeImpact(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.container}>
      {isWalking ? (
        <Pressable
          onPress={handleCancel}
          style={({ pressed }) => [
            styles.button,
            styles.secondary,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel walk"
        >
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            style={styles.row}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={20}
              tintColor={destructive}
              resizeMode="scaleAspectFit"
              style={styles.icon}
            />
            <Text style={[styles.label, { color: destructive }]}>
              Cancel walk
            </Text>
          </Animated.View>
        </Pressable>
      ) : (
        <Pressable
          onPress={handleStart}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: isLeaveNow ? heroStateColor.leaveNow : primaryTint },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isLeaveNow ? 'Leave now' : "I'm leaving now"}
        >
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            style={styles.row}
          >
            <SymbolView
              name="figure.walk"
              size={20}
              tintColor="#FFFFFF"
              resizeMode="scaleAspectFit"
              style={styles.icon}
            />
            <Text style={[styles.label, { color: '#FFFFFF' }]}>
              {isLeaveNow ? 'Leave now' : "I'm leaving now"}
            </Text>
          </Animated.View>
        </Pressable>
      )}
    </Animated.View>
  );
}

// Apple's systemGreen — confident "go" color, different from accent blue per request.
const primaryTint = '#30D158';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    borderRadius: trackerSpacing.cardRadius,
    borderCurve: 'continuous',
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    backgroundColor: 'rgba(255, 69, 58, 0.14)',
  },
  pressed: {
    opacity: 0.78,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: { width: 20, height: 20 },
  label: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
