import { Host, HStack, Image } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { safeImpact } from '@/components/tracker/haptics';

interface MapModeButtonProps {
  onPress: () => void;
}

/**
 * Liquid-glass FAB that opens the Map Modes sheet (Standard/Satellite +
 * Traffic toggle). Lives in the top-right FAB stack on the Map screen.
 */
export function MapModeButton({ onPress }: MapModeButtonProps) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Pressable
        onPress={() => {
          safeImpact(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Map modes"
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
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
            <Image systemName="map" size={20} />
          </HStack>
        </Host>
      </Pressable>
    </View>
  );
}
