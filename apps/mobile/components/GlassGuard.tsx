import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassViewProps,
} from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { glassEffect } from '@expo/ui/swift-ui/modifiers';

type GlassGuardProps = Omit<GlassViewProps, 'children' | 'style'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fallback?: ReactNode;
  blurIntensity?: number;
};

let cachedAvailability: boolean | null = null;

export function isGlassAvailable(): boolean {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    cachedAvailability = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

export function GlassGuard({
  children,
  fallback,
  blurIntensity = 30,
  style,
  ...glassProps
}: GlassGuardProps) {
  if (isGlassAvailable()) {
    return (
      <GlassView style={style} {...glassProps}>
        {children}
      </GlassView>
    );
  }
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <BlurView intensity={blurIntensity} style={style}>
      {children}
    </BlurView>
  );
}

type GlassModifier = ReturnType<typeof glassEffect>;

export function glassIfAvailable(
  buildModifier: () => GlassModifier,
): GlassModifier[] {
  return isGlassAvailable() ? [buildModifier()] : [];
}
