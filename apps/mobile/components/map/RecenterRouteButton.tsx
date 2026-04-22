import { Host, HStack, Image } from '@expo/ui/swift-ui';
import {
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';

import { safeImpact } from '@/components/tracker/haptics';

interface RecenterRouteButtonProps {
  onPress: () => void;
  /** Disables the press (e.g. while static data is loading). */
  disabled?: boolean;
}

/**
 * Floating liquid-glass action button that zooms the camera out to show the
 * entire route polyline. Uses the diagonal-arrows SF Symbol — the universal
 * "fit to view / expand" idiom. Same glass recipe as RecenterStopButton so
 * the two stack visually as peers.
 */
export function RecenterRouteButton({
  onPress,
  disabled,
}: RecenterRouteButtonProps) {
  return (
    <Pressable
      onPress={() => {
        safeImpact(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Show entire route"
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
          <Image systemName="arrow.up.left.and.arrow.down.right" size={18} />
        </HStack>
      </Host>
    </Pressable>
  );
}
