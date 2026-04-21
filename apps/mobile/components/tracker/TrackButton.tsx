import { Host, HStack, Image, Text } from '@expo/ui/swift-ui';
import {
  foregroundStyle,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';

import { safeImpact } from '@/components/tracker/haptics';

interface TrackButtonProps {
  isTracking: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}

const activeAccent = '#34C759';

/**
 * Liquid-glass toggle that controls the Dynamic Island / Lock Screen Live
 * Activity. Tap to start tracking — the activity stays on the island while
 * the app is backgrounded. Tap again to stop.
 */
export function TrackButton({
  isTracking,
  disabled,
  onToggle,
}: TrackButtonProps) {
  const label = isTracking ? 'Tracking' : 'Track';
  const icon = isTracking ? 'dot.radiowaves.left.and.right' : 'bus.fill';

  return (
    <Pressable
      onPress={() => {
        safeImpact(
          isTracking
            ? Haptics.ImpactFeedbackStyle.Light
            : Haptics.ImpactFeedbackStyle.Medium,
        );
        onToggle(!isTracking);
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: isTracking, disabled }}
      accessibilityLabel={
        isTracking ? 'Stop Live Activity tracking' : 'Start Live Activity tracking'
      }
      style={({ pressed }) => ({
        alignSelf: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Host matchContents>
        <HStack
          spacing={8}
          modifiers={[
            padding({ horizontal: 18, vertical: 10 }),
            glassEffect({
              glass: { variant: 'regular', interactive: true },
              shape: 'capsule',
            }),
          ]}
        >
          <Image
            systemName={icon}
            size={15}
            modifiers={
              isTracking ? [foregroundStyle(activeAccent)] : undefined
            }
          />
          <Text
            modifiers={
              isTracking ? [foregroundStyle(activeAccent)] : undefined
            }
          >
            {label}
          </Text>
        </HStack>
      </Host>
    </Pressable>
  );
}
