import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  demoColors,
} from '@/components/liquid-glass-demo/DemoScaffold';

const sheetPatterns = [
  {
    href: '/liquid-glass-demo/settings-sheet-stack-demo-sheet',
    title: 'Settings sheet stack',
    subtitle: 'Root X close button plus native Account back navigation.',
  },
] as const;

export default function NativeSheetPatternsGallery() {
  return (
    <DemoScroll>
      <DemoSection
        title="Native Sheet Patterns"
        note="Each button opens a native form sheet using Expo Router presentation plus @expo/ui SwiftUI controls."
      >
        <DemoCard title="What this demonstrates">
          <InfoText>
            This example shows a native bottom sheet with stack navigation, a
            left-side close toolbar, native controls, and an Account subpage
            with a translucent scrolling header.
          </InfoText>
        </DemoCard>
      </DemoSection>

      <DemoSection title="Sheet">
        {sheetPatterns.map((pattern) => (
          <Link key={pattern.href} href={pattern.href} asChild>
            <Pressable style={styles.patternRow}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.patternTitle}>{pattern.title}</Text>
                <Text style={styles.patternSubtitle}>{pattern.subtitle}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        ))}
      </DemoSection>
    </DemoScroll>
  );
}

const styles = StyleSheet.create({
  patternRow: {
    minHeight: 76,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    backgroundColor: demoColors.grouped,
  },
  patternTitle: {
    color: demoColors.label,
    fontSize: 16,
    fontWeight: '700',
  },
  patternSubtitle: {
    color: demoColors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    color: demoColors.secondaryLabel,
    fontSize: 28,
    fontWeight: '300',
  },
});
