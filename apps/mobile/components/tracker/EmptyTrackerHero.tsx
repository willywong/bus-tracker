import {
  ContentUnavailableView,
  Host,
  HStack,
  Image,
  Text,
} from '@expo/ui/swift-ui';
import {
  fixedSize,
  foregroundStyle,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { Pressable, StyleSheet, View } from 'react-native';

interface EmptyTrackerHeroProps {
  onAdd: () => void;
}

export function EmptyTrackerHero({ onAdd }: EmptyTrackerHeroProps) {
  return (
    <View style={styles.root}>
      <Host matchContents>
        <ContentUnavailableView
          systemImage="bus.fill"
          title="No bus tracked yet"
          description="Add your first bus to start seeing live ETAs."
        />
      </Host>

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
    gap: 24,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  ctaWrap: {
    alignSelf: 'center',
  },
});
