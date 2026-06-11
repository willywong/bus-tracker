import {
  GlassContainer,
  GlassView,
  type GlassViewProps,
} from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  StatusPill,
  demoColors,
  getGlassAvailability,
} from '@/components/liquid-glass-demo/DemoScaffold';

function AdaptiveGlass({
  children,
  style,
  ...props
}: GlassViewProps & { children: ReactNode }) {
  const availability = getGlassAvailability();

  if (availability.glassEffectAPI && availability.liquidGlass) {
    return (
      <GlassView style={style} {...props}>
        {children}
      </GlassView>
    );
  }

  return <View style={[styles.fallbackGlass, style]}>{children}</View>;
}

export default function ExpoGlassEffectDemo() {
  const availability = getGlassAvailability();

  return (
    <DemoScroll>
      <DemoSection
        title="Availability"
        note="The two checks can differ: the native API may exist while Liquid Glass is not active on the current device/OS."
      >
        <StatusPill
          label="isGlassEffectAPIAvailable()"
          enabled={availability.glassEffectAPI}
        />
        <StatusPill
          label="isLiquidGlassAvailable()"
          enabled={availability.liquidGlass}
        />
      </DemoSection>

      <DemoSection
        title="Basic GlassView"
        note="iOS 26-only: GlassView renders true Liquid Glass when both availability checks pass."
      >
        <View style={styles.backdrop}>
          <View style={[styles.blob, styles.blobBlue]} />
          <View style={[styles.blob, styles.blobPink]} />
          <View style={[styles.blob, styles.blobGreen]} />
          <AdaptiveGlass style={styles.heroGlass}>
            <Text style={styles.glassTitle}>Transit snapshot</Text>
            <Text style={styles.glassBody}>
              Basic GlassView over a colorful background.
            </Text>
          </AdaptiveGlass>
        </View>
      </DemoSection>

      <DemoSection title="Glass styles">
        <AdaptiveGlass glassEffectStyle="regular" style={styles.sampleGlass}>
          <Text style={styles.glassTitle}>regular</Text>
          <Text style={styles.glassBody}>Default readable glass material.</Text>
        </AdaptiveGlass>
        <AdaptiveGlass glassEffectStyle="clear" style={styles.sampleGlass}>
          <Text style={styles.glassTitle}>clear</Text>
          <Text style={styles.glassBody}>Clearer, lighter glass treatment.</Text>
        </AdaptiveGlass>
      </DemoSection>

      <DemoSection title="Interactive and tint">
        <AdaptiveGlass
          isInteractive
          tintColor="#0A84FF"
          style={styles.interactiveGlass}
        >
          <Pressable style={styles.pressable} onPress={() => {}}>
            <Text style={styles.glassTitle}>Interactive blue tint</Text>
            <Text style={styles.glassBody}>
              isInteractive and tintColor are supported by expo-glass-effect.
            </Text>
          </Pressable>
        </AdaptiveGlass>
        <AdaptiveGlass tintColor="#FF2D55" style={styles.sampleGlass}>
          <Text style={styles.glassTitle}>Pink tint</Text>
          <Text style={styles.glassBody}>Tint variation sample.</Text>
        </AdaptiveGlass>
      </DemoSection>

      <DemoSection
        title="GlassContainer"
        note="iOS 26-only: nearby GlassView children can visually merge inside GlassContainer."
      >
        {availability.glassEffectAPI && availability.liquidGlass ? (
          <GlassContainer spacing={28} style={styles.container}>
            <GlassView isInteractive style={styles.containerBubble}>
              <Text style={styles.bubbleText}>A</Text>
            </GlassView>
            <GlassView isInteractive style={styles.containerBubble}>
              <Text style={styles.bubbleText}>B</Text>
            </GlassView>
            <GlassView isInteractive style={styles.containerBubble}>
              <Text style={styles.bubbleText}>C</Text>
            </GlassView>
          </GlassContainer>
        ) : (
          <DemoCard title="Fallback">
            <InfoText>
              GlassContainer is rendered only when Liquid Glass is available.
              This fallback avoids loading an iOS 26-only effect on unsupported
              platforms.
            </InfoText>
          </DemoCard>
        )}
      </DemoSection>
    </DemoScroll>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    height: 250,
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#111827',
  },
  blob: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  blobBlue: {
    top: 18,
    left: 18,
    backgroundColor: '#0A84FF',
  },
  blobPink: {
    right: 20,
    bottom: 18,
    backgroundColor: '#FF2D55',
  },
  blobGreen: {
    right: 80,
    top: 42,
    backgroundColor: '#30D158',
  },
  heroGlass: {
    alignSelf: 'center',
    width: '78%',
    minHeight: 118,
    justifyContent: 'center',
    gap: 8,
    padding: 18,
    borderRadius: 24,
  },
  sampleGlass: {
    gap: 8,
    padding: 16,
    borderRadius: 18,
  },
  interactiveGlass: {
    borderRadius: 22,
  },
  pressable: {
    gap: 8,
    padding: 16,
  },
  fallbackGlass: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  glassTitle: {
    color: demoColors.label,
    fontSize: 17,
    fontWeight: '700',
  },
  glassBody: {
    color: demoColors.secondaryLabel,
    fontSize: 14,
    lineHeight: 19,
  },
  container: {
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#1f2937',
  },
  containerBubble: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
  },
  bubbleText: {
    color: demoColors.label,
    fontSize: 18,
    fontWeight: '800',
  },
});
