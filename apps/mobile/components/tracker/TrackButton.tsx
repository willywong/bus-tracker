import { Host, HStack, Image } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
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
 * Circular liquid-glass toggle that controls the Dynamic Island / Lock Screen
 * Live Activity. Icon-only. Tap to start tracking — the activity stays on the
 * island while the app is backgrounded. Tap again to stop.
 */
export function TrackButton({
  isTracking,
  disabled,
  onToggle,
}: TrackButtonProps) {
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
          modifiers={[
            frame({ width: 40, height: 40 }),
            glassEffect({
              glass: { variant: 'regular', interactive: true },
              shape: 'circle',
            }),
          ]}
        >
          <Image
            systemName={icon}
            size={16}
            color={isTracking ? activeAccent : undefined}
          />
        </HStack>
      </Host>
    </Pressable>
  );
}
