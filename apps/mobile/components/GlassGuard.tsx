import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassViewProps,
} from 'expo-glass-effect';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';

import { color } from '@/theme/design';

type GlassGuardProps = Omit<GlassViewProps, 'children' | 'style'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
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

/** Tracks the system Reduce Transparency setting. */
export function useReduceTransparency(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => mounted && setEnabled(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

/**
 * Liquid Glass surface for floating, transient chrome (e.g. the in-app
 * notification banner). Falls back to a system blur below iOS 26 and to a
 * solid surface when Reduce Transparency is on. Never use it for content.
 */
export function GlassGuard({ children, style, ...glassProps }: GlassGuardProps) {
  const reduceTransparency = useReduceTransparency();
  if (reduceTransparency) {
    return (
      <View style={[style, { backgroundColor: color.secondaryGroupedBackground }]}>
        {children}
      </View>
    );
  }
  if (isGlassAvailable()) {
    return (
      <GlassView style={style} {...glassProps}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView tint="systemChromeMaterial" intensity={80} style={style}>
      {children}
    </BlurView>
  );
}
