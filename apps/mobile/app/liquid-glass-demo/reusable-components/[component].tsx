import { Stack, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  demoColors,
} from '@/components/liquid-glass-demo/DemoScaffold';
import {
  getReusableComponentDemo,
  reusableComponentDemos,
} from '@/components/liquid-glass-demo/ReusableLiquidGlassComponents';

export default function ReusableLiquidGlassComponentDetail() {
  const params = useLocalSearchParams<{ component?: string }>();
  const demo = getReusableComponentDemo(params.component);

  if (!demo) {
    return (
      <DemoScroll>
        <Stack.Screen options={{ title: 'Component Not Found' }} />
        <DemoSection title="Component not found">
          <DemoCard>
            <InfoText>
              This reusable component route does not exist. Available examples:
              {` ${reusableComponentDemos.map((item) => item.slug).join(', ')}`}
            </InfoText>
          </DemoCard>
        </DemoSection>
      </DemoScroll>
    );
  }

  const Example = demo.Component;

  return (
    <DemoScroll>
      <Stack.Screen options={{ title: demo.title }} />
      <DemoSection title={demo.title} note={demo.description}>
        <DemoCard title="Expo UI APIs">
          <View style={styles.apiList}>
            {demo.apis.map((api) => (
              <View key={api} style={styles.apiPill}>
                <Text style={styles.apiText}>{api}</Text>
              </View>
            ))}
          </View>
        </DemoCard>
        <DemoCard title="iOS notes">
          <InfoText>
            {demo.iosNote} True Liquid Glass requires iOS 26+ and a native
            build produced with Xcode 26.
          </InfoText>
          {Platform.OS !== 'ios' ? (
            <InfoText>
              This platform renders the component fallback instead of native
              SwiftUI.
            </InfoText>
          ) : null}
        </DemoCard>
      </DemoSection>

      <DemoSection title="Live example">
        <Example />
      </DemoSection>
    </DemoScroll>
  );
}

const styles = StyleSheet.create({
  apiList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  apiPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(10, 132, 255, 0.16)',
  },
  apiText: {
    color: demoColors.label,
    fontSize: 12,
    fontWeight: '700',
  },
});
