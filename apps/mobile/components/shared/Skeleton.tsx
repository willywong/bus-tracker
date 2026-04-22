import { useEffect } from 'react';
import {
  DynamicColorIOS,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export const SHIMMER_BAR_COLOR = DynamicColorIOS({
  light: 'rgba(0, 0, 0, 0.10)',
  dark: 'rgba(255, 255, 255, 0.14)',
});

interface ShimmerBarProps {
  style?: StyleProp<ViewStyle>;
  delay?: number;
  width?: number;
  height?: number;
  radius?: number;
}

export function ShimmerBar({
  style,
  delay = 0,
  width,
  height,
  radius,
}: ShimmerBarProps) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
  }, [opacity, delay]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          backgroundColor: SHIMMER_BAR_COLOR,
          width,
          height,
          borderRadius: radius,
        },
        style,
        animated,
      ]}
    />
  );
}
