import {
  DemoCard,
  DemoLink,
  DemoScroll,
  DemoSection,
  InfoText,
} from '@/components/liquid-glass-demo/DemoScaffold';
import {
  reusableComponentCategories,
  reusableComponentDemos,
} from '@/components/liquid-glass-demo/ReusableLiquidGlassComponents';

export default function ReusableLiquidGlassComponentsIndex() {
  return (
    <DemoScroll>
      <DemoSection
        title="Reusable Expo UI Components"
        note="Each example has its own page. Liquid Glass rendering requires iOS 26+ and an Xcode 26 native build."
      >
        <DemoCard title="Implementation notes">
          <InfoText>
            These examples compose common @expo/ui SwiftUI controls into
            reusable UI pieces. Android, web, and unsupported iOS environments
            show React Native fallback content.
          </InfoText>
        </DemoCard>
      </DemoSection>

      {reusableComponentCategories.map((category) => {
        const demos = reusableComponentDemos.filter(
          (demo) => demo.category === category
        );

        if (demos.length === 0) {
          return null;
        }

        return (
          <DemoSection key={category} title={category}>
            {demos.map((demo) => (
              <DemoLink
                key={demo.slug}
                href={`/liquid-glass-demo/reusable-components/${demo.slug}`}
                title={demo.title}
                subtitle={demo.description}
              />
            ))}
          </DemoSection>
        );
      })}
    </DemoScroll>
  );
}
