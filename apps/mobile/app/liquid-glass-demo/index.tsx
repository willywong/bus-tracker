import {
  DemoCard,
  DemoLink,
  DemoScroll,
  DemoSection,
  InfoText,
  StatusPill,
  getGlassAvailability,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function LiquidGlassDemoIndex() {
  const availability = getGlassAvailability();

  return (
    <DemoScroll>
      <DemoSection title="Liquid Glass Demo">
        <DemoCard title="Run notes">
          <InfoText>
            True Liquid Glass requires iOS 26+. Some SwiftUI glass styles need
            a native build produced with Xcode 26. Expo Go may not expose every
            native behavior, so use a dev build or npx expo run:ios when needed.
            Older iOS, Android, and web render fallbacks.
          </InfoText>
        </DemoCard>
        <StatusPill
          label="Glass Effect API"
          enabled={availability.glassEffectAPI}
        />
        <StatusPill label="Liquid Glass" enabled={availability.liquidGlass} />
      </DemoSection>

      <DemoSection title="Sections">
        <DemoLink
          href="/liquid-glass-demo/glass-effect"
          title="GlassEffect demo"
          subtitle="GlassView, GlassContainer, styles, tint, and availability checks."
        />
        <DemoLink
          href="/liquid-glass-demo/swiftui-buttons"
          title="SwiftUI Glass Buttons"
          subtitle="buttonStyle glass variants, icon-only labels, and control sizes."
        />
        <DemoLink
          href="/liquid-glass-demo/swiftui-menu"
          title="SwiftUI Glass Menu"
          subtitle="Menu triggers styled with glass and glassProminent."
        />
        <DemoLink
          href="/liquid-glass-demo/swiftui-glass-effect"
          title="SwiftUI glassEffect modifier"
          subtitle="glassEffect, GlassEffectContainer, Namespace, and glassEffectId."
        />
        <DemoLink
          href="/liquid-glass-demo/reusable-components"
          title="Reusable Expo UI Components"
          subtitle="Five typical app components composed from @expo/ui SwiftUI controls."
        />
        <DemoLink
          href="/liquid-glass-demo/settings-sheet-stack-demo"
          title="Settings Sheet Stack"
          subtitle="Open a native form sheet with its own Stack, close button, and Account subpage."
        />
        <DemoLink
          href="/liquid-glass-demo/native-tabs"
          title="NativeTabs"
          subtitle="Native tab behavior and iOS 26 Liquid Glass notes."
        />
        <DemoLink
          href="/liquid-glass-demo/stack-toolbar"
          title="Stack.Toolbar"
          subtitle="Header, bottom toolbar, badge, custom view, and search slot examples."
        />
      </DemoSection>
    </DemoScroll>
  );
}
