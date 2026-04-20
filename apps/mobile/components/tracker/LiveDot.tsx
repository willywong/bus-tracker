import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface LiveDotProps {
  color: string;
  size?: number;
  /** Disable the pulse — renders a flat static dot. */
  static?: boolean;
}

export function LiveDot({ color, size = 6, static: isStatic }: LiveDotProps) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isStatic) return;
    pulse.value = withRepeat(
      withTiming(0.35, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, isStatic]);

  const style = useAnimatedStyle(() => ({
    opacity: isStatic ? 1 : pulse.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
