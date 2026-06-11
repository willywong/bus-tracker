import { Button, Host, Menu, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { Alert, Platform } from 'react-native';

import {
  DemoScroll,
  DemoSection,
  PlatformFallback,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function SwiftUIGlassMenuDemo() {
  if (Platform.OS !== 'ios') {
    return (
      <DemoScroll>
        <PlatformFallback feature="@expo/ui SwiftUI glass menus" />
      </DemoScroll>
    );
  }

  return (
    <DemoScroll>
      <DemoSection
        title="Menu button styles"
        note="Use buttonStyle on Menu. Do not apply glassEffect() directly to the Menu label."
      >
        <Host style={{ height: 190 }} useViewportSizeMeasurement>
          <VStack spacing={16} modifiers={[padding({ all: 16 })]}>
            {/* iOS 26-only: glass menu trigger style. */}
            <Menu
              label="Glass menu"
              systemImage="ellipsis.circle"
              modifiers={[buttonStyle('glass'), controlSize('large')]}
            >
              <Button
                label="Log first action"
                onPress={() => Alert.alert('Menu action', 'First action')}
              />
              <Button
                label="Log second action"
                onPress={() => Alert.alert('Menu action', 'Second action')}
              />
            </Menu>

            {/* iOS 26-only: prominent glass menu trigger style. */}
            <Menu
              label="Prominent menu"
              systemImage="line.3.horizontal.decrease.circle"
              modifiers={[buttonStyle('glassProminent'), controlSize('large')]}
            >
              <Button
                label="Mark sample"
                onPress={() => Alert.alert('Menu action', 'Marked sample')}
              />
              <Button
                label="Clear sample"
                role="destructive"
                onPress={() => Alert.alert('Menu action', 'Cleared sample')}
              />
              <Text>Static menu text</Text>
            </Menu>
          </VStack>
        </Host>
      </DemoSection>
    </DemoScroll>
  );
}
