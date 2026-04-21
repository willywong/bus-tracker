import { Host, HStack, Image } from '@expo/ui/swift-ui';
import {
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';

import { safeImpact } from '@/components/tracker/haptics';

interface RecenterStopButtonProps {
  onPress: () => void;
  /** Disables the press (e.g. while static data is loading). */
  disabled?: boolean;
}

/**
 * Floating liquid-glass action button that returns the map camera to the
 * user's preferred bus stop. Uses the `scope` SF Symbol — the universal
 * "recenter on target" idiom. Follows the validated @expo/ui pattern from
 * RouteSwitcher: glass is applied to the inner HStack inside Host, RN
 * Pressable handles the tap on the outside.
 */
export function RecenterStopButton({
  onPress,
  disabled,
}: RecenterStopButtonProps) {
  return (
    <Pressable
      onPress={() => {
        safeImpact(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Recenter on bus stop"
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <Host matchContents>
        <HStack
          modifiers={[
            frame({ width: 44, height: 44 }),
            glassEffect({
              glass: { variant: 'regular', interactive: true },
              shape: 'circle',
            }),
          ]}
        >
          <Image systemName="scope" size={20} />
        </HStack>
      </Host>
    </Pressable>
  );
}
