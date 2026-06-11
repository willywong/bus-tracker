import {
  GlassEffectContainer,
  HStack,
  Host,
  Image,
  Namespace,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  font,
  frame,
  glassEffect,
  glassEffectId,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useId } from 'react';
import { Platform } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  PlatformFallback,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function SwiftUIGlassEffectModifierDemo() {
  const namespaceId = useId();

  if (Platform.OS !== 'ios') {
    return (
      <DemoScroll>
        <PlatformFallback feature="@expo/ui SwiftUI glassEffect modifiers" />
      </DemoScroll>
    );
  }

  return (
    <DemoScroll>
      <DemoSection
        title="glassEffect()"
        note="iOS 26-only: SwiftUI glassEffect() requires iOS 26 glass APIs and should be tested with Xcode 26 builds."
      >
        <Host style={{ height: 150 }} useViewportSizeMeasurement>
          <VStack spacing={12} modifiers={[padding({ all: 16 })]}>
            <Text
              modifiers={[
                font({ size: 18, weight: 'bold' }),
                padding({ all: 16 }),
                glassEffect({
                  glass: { variant: 'regular', interactive: true },
                  shape: 'roundedRectangle',
                  cornerRadius: 18,
                }),
              ]}
            >
              Custom SwiftUI text with glassEffect()
            </Text>
          </VStack>
        </Host>
      </DemoSection>

      <DemoSection title="GlassEffectContainer">
        <Host style={{ height: 142 }} useViewportSizeMeasurement>
          <GlassEffectContainer spacing={24}>
            <HStack spacing={14} modifiers={[padding({ all: 16 })]}>
              <Image
                systemName="bus.fill"
                size={28}
                modifiers={[
                  frame({ width: 58, height: 58 }),
                  glassEffect({
                    glass: { variant: 'regular', tint: '#0A84FF' },
                    shape: 'circle',
                  }),
                ]}
              />
              <Image
                systemName="map.fill"
                size={28}
                modifiers={[
                  frame({ width: 58, height: 58 }),
                  glassEffect({
                    glass: { variant: 'clear', tint: '#30D158' },
                    shape: 'circle',
                  }),
                ]}
              />
              <Image
                systemName="gear"
                size={28}
                modifiers={[
                  frame({ width: 58, height: 58 }),
                  glassEffect({
                    glass: { variant: 'regular', tint: '#FF9500' },
                    shape: 'circle',
                  }),
                ]}
              />
            </HStack>
          </GlassEffectContainer>
        </Host>
      </DemoSection>

      <DemoSection title="Namespace and glassEffectId">
        <Host style={{ height: 142 }} useViewportSizeMeasurement>
          <Namespace id={namespaceId}>
            <GlassEffectContainer spacing={18}>
              <HStack spacing={14} modifiers={[padding({ all: 16 })]}>
                <Image
                  systemName="star.fill"
                  size={28}
                  modifiers={[
                    frame({ width: 58, height: 58 }),
                    glassEffect({
                      glass: { variant: 'regular', interactive: true },
                      shape: 'circle',
                    }),
                    glassEffectId('favorite', namespaceId),
                  ]}
                />
                <Text
                  modifiers={[
                    padding({ horizontal: 16, vertical: 12 }),
                    glassEffect({
                      glass: { variant: 'clear', interactive: true },
                      shape: 'capsule',
                    }),
                    glassEffectId('favorite-label', namespaceId),
                  ]}
                >
                  Matched glass identity
                </Text>
              </HStack>
            </GlassEffectContainer>
          </Namespace>
        </Host>
      </DemoSection>

      <DemoSection title="Export status">
        <DemoCard title="Installed @expo/ui exports">
          <InfoText>
            GlassEffectContainer, Namespace, glassEffect(), and glassEffectId()
            are all exported by the installed @expo/ui package, so this project
            can demo them directly.
          </InfoText>
        </DemoCard>
      </DemoSection>
    </DemoScroll>
  );
}
