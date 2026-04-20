import { useEffect } from 'react';
import { View, type ColorValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface PulsingDotsProps {
  color: ColorValue;
  size?: number;
  gap?: number;
}

export function PulsingDots({ color, size = 6, gap = 6 }: PulsingDotsProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      <Dot color={color} size={size} delay={0} />
      <Dot color={color} size={size} delay={180} />
      <Dot color={color} size={size} delay={360} />
    </View>
  );
}

function Dot({
  color,
  size,
  delay,
}: {
  color: ColorValue;
  size: number;
  delay: number;
}) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
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
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animated,
      ]}
    />
  );
}
