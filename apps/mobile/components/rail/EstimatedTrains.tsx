import { SymbolView, type SFSymbol } from 'expo-symbols';
import { memo, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { TRAIN_FADE_SEC } from '@/components/rail/stripModel';
import { color } from '@/theme/design';

/** One mounted estimated train: its run's service second at every station. */
export interface TrainSlot {
  key: string;
  times: readonly number[];
}

const DISC = 24;

/**
 * One shared clock for every estimated train, in service seconds (spec
 * §7.2). A frame callback on the UI thread advances it from a seed; JS
 * reseeds it from the wall clock (`reseed`) on the 15 s tick, on scroll end,
 * on a direction change and on resume, which is how the UI thread gets a
 * fresh honest time. The seed's `at` is the frame timestamp it was taken
 * at, so a pause and resume never depends on how the callback's own timing
 * behaves across `setActive`. Inactive (Reduce Motion, unfocused,
 * backgrounded) the clock moves only when reseeded: static dots in steps.
 */
export function useTrainClock(active: boolean): {
  clock: SharedValue<number>;
  reseed: (serviceSec: number) => void;
} {
  const clock = useSharedValue(0);
  const seed = useSharedValue({ t: 0, at: -1 });
  const frame = useFrameCallback(({ timestamp }) => {
    const s = seed.get();
    if (s.at < 0) {
      seed.set({ t: s.t, at: timestamp });
      return;
    }
    clock.set(s.t + (timestamp - s.at) / 1000);
  }, false);
  const { setActive } = frame;
  useEffect(() => {
    setActive(active);
  }, [active, setActive]);
  const reseed = useCallback(
    (serviceSec: number) => {
      clock.set(serviceSec);
      seed.set({ t: serviceSec, at: -1 });
    },
    [clock, seed],
  );
  return { clock, reseed };
}

/** Whether the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * The estimated trains over the strip: dashed-outline paper discs carrying
 * the mode glyph, the "scheduled, not live" encoding of the ghost bus. Each
 * glides linearly between beads at the run's timetabled time, fading in and
 * out over the first and last 15 s of its run. Hidden from VoiceOver: the
 * header and its caption speak for them. Only the slots in view are passed
 * in (at most 12, `slotWindow`).
 */
export function EstimatedTrains({
  slots,
  ys,
  clock,
  glyph,
  railX,
}: {
  slots: readonly TrainSlot[];
  /** Bead centres, one per station, in strip coordinates. */
  ys: readonly number[];
  clock: SharedValue<number>;
  glyph: SFSymbol;
  /** Centre of the rail, in strip coordinates. */
  railX: number;
}) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {slots.map((s) => (
        <EstimatedTrain key={s.key} times={s.times} ys={ys} clock={clock} glyph={glyph} railX={railX} />
      ))}
    </View>
  );
}

const EstimatedTrain = memo(function EstimatedTrain({
  times,
  ys,
  clock,
  glyph,
  railX,
}: {
  times: readonly number[];
  ys: readonly number[];
  clock: SharedValue<number>;
  glyph: SFSymbol;
  railX: number;
}) {
  const style = useAnimatedStyle(() => {
    const c = clock.get();
    const n = times.length;
    if (n < 2 || ys.length !== n) return { opacity: 0 };
    const r = c - times[0];
    const total = times[n - 1] - times[0];
    const opacity = r < 0 || r > total ? 0 : Math.min(1, r / TRAIN_FADE_SEC, (total - r) / TRAIN_FADE_SEC);
    return {
      opacity,
      transform: [{ translateY: interpolate(c, times as number[], ys as number[], Extrapolation.CLAMP) }],
    };
  }, [times, ys]);
  return (
    <Animated.View style={[styles.disc, { left: railX - DISC / 2 }, style]}>
      <SymbolView name={glyph} size={13} weight="semibold" tintColor={color.ink} resizeMode="scaleAspectFit" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  disc: {
    position: 'absolute',
    top: -DISC / 2,
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: color.ink,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
});
