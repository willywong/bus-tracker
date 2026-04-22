import { HStack, Host, Image, Text } from '@expo/ui/swift-ui';
import {
  fixedSize,
  foregroundStyle,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { PlatformColor, Pressable, StyleSheet, View } from 'react-native';

interface EmptyTrackerHeroProps {
  onAdd: () => void;
}

export function EmptyTrackerHero({ onAdd }: EmptyTrackerHeroProps) {
  return (
    <View style={styles.root}>
      <SymbolView
        name="bus.fill"
        size={56}
        tintColor={PlatformColor('secondaryLabel') as unknown as string}
        resizeMode="scaleAspectFit"
      />

      <Pressable
        onPress={onAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add your first bus"
        style={({ pressed }) => [
          styles.ctaWrap,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Host matchContents>
          <HStack
            spacing={6}
            modifiers={[
              fixedSize(),
              padding({ horizontal: 18, vertical: 10 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'capsule',
              }),
            ]}
          >
            <Image systemName="plus" size={14} />
            <Text
              modifiers={[
                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
              ]}
            >
              Add bus
            </Text>
          </HStack>
        </Host>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  ctaWrap: {
    alignSelf: 'center',
  },
});
