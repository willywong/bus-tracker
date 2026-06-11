import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function NativeTabsLiquidGlassDemo() {
  return (
    <DemoScroll>
      <DemoSection title="NativeTabs">
        <DemoCard title="Current app layout">
          <InfoText>
            This demo is mounted as a real NativeTabs tab in the root Expo Router
            layout. NativeTabs uses native system tabs and automatically adopts
            iOS Liquid Glass tab behavior on iOS 26.
          </InfoText>
        </DemoCard>
        <DemoCard title="Demo tab set">
          <InfoText>
            The requested Home / Glass / Settings layout maps to this app as
            Tracker / Liquid Glass Demo / Settings. The root layout uses
            NativeTabs.Trigger, NativeTabs.Trigger.Icon, and
            NativeTabs.Trigger.Label with SF Symbols on iOS and Material symbol
            names for Android fallback.
          </InfoText>
        </DemoCard>
        <DemoCard title="ThemeProvider">
          <InfoText>
            The root layout wraps NativeTabs with ThemeProvider and
            DefaultTheme/DarkTheme to reduce white flashes and dark-mode flicker
            around native Liquid Glass surfaces.
          </InfoText>
        </DemoCard>
      </DemoSection>
    </DemoScroll>
  );
}
