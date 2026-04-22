import { HStack, Host, Image, Text as UIText } from '@expo/ui/swift-ui';
import {
  fixedSize,
  foregroundStyle,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import {
  DynamicColorIOS,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassGuard } from '@/components/GlassGuard';

interface MapChooseBusCardProps {
  onAddBus: () => void;
}

export function MapChooseBusCard({ onAddBus }: MapChooseBusCardProps) {
  return (
    <GlassGuard
      style={styles.card}
      glassEffectStyle="regular"
      blurIntensity={60}
    >
      <View style={styles.scrim} />
      <View style={styles.inner}>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <SymbolView
              name="bus.fill"
              size={22}
              tintColor={PlatformColor('secondaryLabel') as unknown as string}
            />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.title} selectable numberOfLines={1}>
              Choose a bus
            </Text>
            <Text style={styles.caption} selectable numberOfLines={2}>
              Add one to see it live on the map.
            </Text>
          </View>
          <Pressable
            onPress={onAddBus}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add bus"
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <Host matchContents>
              <HStack
                spacing={6}
                modifiers={[
                  fixedSize(),
                  padding({ horizontal: 14, vertical: 8 }),
                  glassEffect({
                    glass: { variant: 'regular', interactive: true },
                    shape: 'capsule',
                  }),
                ]}
              >
                <Image systemName="plus" size={13} />
                <UIText
                  modifiers={[
                    foregroundStyle({
                      type: 'hierarchical',
                      style: 'primary',
                    }),
                  ]}
                >
                  Add bus
                </UIText>
              </HStack>
            </Host>
          </Pressable>
        </View>
      </View>
    </GlassGuard>
  );
}

const SCRIM_COLOR = DynamicColorIOS({
  light: 'rgba(255, 255, 255, 0.5)',
  dark: 'rgba(0, 0, 0, 0.45)',
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SCRIM_COLOR,
  },
  inner: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: PlatformColor('label'),
    letterSpacing: -0.1,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: PlatformColor('secondaryLabel'),
    letterSpacing: 0.1,
  },
});
