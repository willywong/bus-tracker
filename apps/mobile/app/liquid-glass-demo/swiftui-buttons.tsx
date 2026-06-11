import { Button, HStack, Host, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  frame,
  labelStyle,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { Alert, Platform } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  PlatformFallback,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function SwiftUIGlassButtonsDemo() {
  if (Platform.OS !== 'ios') {
    return (
      <DemoScroll>
        <PlatformFallback feature="@expo/ui SwiftUI glass buttons" />
      </DemoScroll>
    );
  }

  return (
    <DemoScroll>
      <DemoSection
        title="SwiftUI Button styles"
        note="iOS 26-only: buttonStyle('glass') and buttonStyle('glassProminent') require the iOS 26 SwiftUI glass styles, generally built with Xcode 26."
      >
        <Host style={{ height: 236 }} useViewportSizeMeasurement>
          <VStack spacing={14} modifiers={[padding({ all: 16 })]}>
            <Button
              label="Glass button"
              onPress={() => Alert.alert('Glass button')}
              modifiers={[buttonStyle('glass')]}
            />
            <Button
              label="Prominent glass"
              onPress={() => Alert.alert('Prominent glass')}
              modifiers={[
                buttonStyle('glassProminent'),
                controlSize('large'),
                tint('#0A84FF'),
              ]}
            />
            <Button
              onPress={() => Alert.alert('Large CTA')}
              modifiers={[buttonStyle('glassProminent'), controlSize('large')]}
            >
              <HStack spacing={8}>
                <Image systemName="bus.fill" size={18} />
                <Text>Track next bus</Text>
              </HStack>
            </Button>
          </VStack>
        </Host>
      </DemoSection>

      <DemoSection title="Icon-only and circular">
        <Host style={{ height: 122 }} useViewportSizeMeasurement>
          <HStack spacing={16} modifiers={[padding({ all: 16 })]}>
            <Button
              label="Favorite"
              systemImage="star.fill"
              onPress={() => Alert.alert('Icon-only glass')}
              modifiers={[
                buttonStyle('glass'),
                labelStyle('iconOnly'),
                controlSize('large'),
              ]}
            />
            <Button
              label="Add"
              systemImage="plus"
              onPress={() => Alert.alert('Circular glass')}
              modifiers={[
                buttonStyle('glassProminent'),
                labelStyle('iconOnly'),
                controlSize('large'),
                frame({ width: 56, height: 56 }),
              ]}
            />
          </HStack>
        </Host>
      </DemoSection>

      <DemoSection title="Unavailable API">
        <DemoCard title="buttonBorderShape">
          <InfoText>
            The installed @expo/ui 56.0.15 package does not export a
            buttonBorderShape modifier, so this demo intentionally does not
            call it.
          </InfoText>
        </DemoCard>
      </DemoSection>
    </DemoScroll>
  );
}
