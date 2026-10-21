import {
  makeMutable,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { EASE_OUT, motion } from '@/theme/design';

/**
 * Trip ⇄ detail as a shared-axis slide, so the back chevron reads as depth:
 * going in, the detail slides in from the right while the trip view slides
 * left and fades; going back mirrors it. The outgoing view fades out fast and
 * the incoming one starts a beat later, so the two never sit on top of each
 * other (sheet content has no opaque background to hide the overlap).
 */

/** 1 = into a detail, -1 = back towards the trip. Set before the swap renders. */
export const sheetNavDirection = makeMutable<1 | -1>(1);

/** How far each view travels, in points. */
const SHIFT = 32;

export const sheetPushIn: EntryExitAnimationFunction = () => {
  'worklet';
  const dir = sheetNavDirection.get();
  const timing = { duration: motion.pushIn, easing: EASE_OUT };
  return {
    initialValues: { opacity: 0, transform: [{ translateX: dir * SHIFT }] },
    animations: {
      opacity: withDelay(motion.pushOverlap, withTiming(1, timing)),
      transform: [{ translateX: withDelay(motion.pushOverlap, withTiming(0, timing)) }],
    },
  };
};

export const sheetPushOut: EntryExitAnimationFunction = () => {
  'worklet';
  const dir = sheetNavDirection.get();
  const timing = { duration: motion.pushOut, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
    animations: {
      opacity: withTiming(0, timing),
      transform: [{ translateX: withTiming(-dir * SHIFT, timing) }],
    },
  };
};
