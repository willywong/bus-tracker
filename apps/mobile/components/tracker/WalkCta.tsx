import { Host, HStack, Image } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';

import { safeImpact, safeNotification } from './haptics';
import { heroStateColor } from './tokens';

interface WalkCtaProps {
  isWalking: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** True when the bus countdown is in the leave-now window. */
  isLeaveNow: boolean;
}

const destructive = '#FF453A';
const primaryTint = '#30D158';

export function WalkCta({
  isWalking,
  onStart,
  onCancel,
  isLeaveNow,
}: WalkCtaProps) {
  const handlePress = () => {
    if (isWalking) {
      safeImpact(Haptics.ImpactFeedbackStyle.Light);
      onCancel();
    } else {
      safeNotification(Haptics.NotificationFeedbackType.Success);
      onStart();
    }
  };

  const icon = isWalking ? 'xmark' : 'figure.walk';
  const tint = isWalking
    ? destructive
    : isLeaveNow
      ? heroStateColor.leaveNow
      : primaryTint;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: isWalking }}
      accessibilityLabel={
        isWalking ? 'Cancel walk' : isLeaveNow ? 'Leave now' : "I'm leaving now"
      }
      style={({ pressed }) => ({
        alignSelf: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Host matchContents>
        <HStack
          modifiers={[
            frame({ width: 40, height: 40 }),
            glassEffect({
              glass: { variant: 'regular', interactive: true },
              shape: 'circle',
            }),
          ]}
        >
          <Image systemName={icon} size={16} color={tint} />
        </HStack>
      </Host>
    </Pressable>
  );
}
