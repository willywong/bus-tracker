import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { EASE_OUT } from '@/theme/design';

/** Past this share of the width, letting go goes back. */
const COMMIT_FRACTION = 0.33;
/** A flick right this fast goes back from anywhere. */
const COMMIT_VELOCITY = 600;

/**
 * Swipe right to go back from a stop or bus detail to the trip, like a
 * navigation push (iOS 26 lets you start it anywhere, not just the edge).
 * The detail follows the finger and dims a little; letting go past a third
 * of the way, or flicking, slides it off and goes back, otherwise it springs
 * home with the finger's velocity. Vertical scrolling wins over it, and a
 * leftward drag never starts it.
 *
 * The sheet is its own native presentation, so it needs its own gesture
 * root, and that root has to sit outside the scroll view: inside it, the
 * native scroll recognizer takes every touch first and the pan never begins.
 * Everything runs on the UI thread; only the final "back" crosses.
 */
export function EdgeSwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);

  const pan = usePanGesture({
    activeOffsetX: 16,
    failOffsetX: -12,
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      x.set(Math.max(0, e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationX > width * COMMIT_FRACTION || e.velocityX > COMMIT_VELOCITY) {
        x.set(
          withTiming(width, { duration: 200, easing: EASE_OUT }, (finished) => {
            if (finished) scheduleOnRN(onBack);
          }),
        );
      } else {
        x.set(withSpring(0, { duration: 300, dampingRatio: 1, velocity: e.velocityX }));
      }
    },
  });

  const style = useAnimatedStyle(() => ({
    opacity: 1 - (x.get() / width) * 0.4,
    transform: [{ translateX: x.get() }],
  }));

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, style]}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
