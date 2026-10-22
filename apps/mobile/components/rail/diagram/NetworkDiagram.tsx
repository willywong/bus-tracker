import { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet, useColorScheme, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { EASE_OUT, hex, motion, pick, type Scheme } from '@/theme/design';

import { interchangeIds, linePaths, stationMarkers, type Point } from './geometry';
import { nearestStation } from './hitTest';
import { DIAGRAM_LINES, DIAGRAM_LINKS, DIAGRAM_SIZE, DIAGRAM_STATIONS, GRID } from './klRailDiagram';
import {
  centreOn,
  clampTransform,
  fitTransform,
  LABEL_MIN_SCALE,
  MAX_SCALE,
  minScale,
  translateBounds,
  zoomAbout,
  type Transform,
  type Viewport,
} from './viewport';

// The drawing is static: build it once.
const PATHS = linePaths(DIAGRAM_STATIONS, DIAGRAM_LINES, GRID);
const MARKERS = stationMarkers(DIAGRAM_STATIONS, DIAGRAM_LINES, PATHS, GRID, DIAGRAM_LINKS);
const INTERCHANGES = interchangeIds(DIAGRAM_LINES, DIAGRAM_LINKS);
const SIZE = { width: DIAGRAM_SIZE.width * GRID, height: DIAGRAM_SIZE.height * GRID };
const AT = new Map(DIAGRAM_STATIONS.map((s) => [s.id, s]));

/** The sheet opens on the city core at 1×: KL Sentral to Ampang Park and Chan Sow Lin. */
const HOME_IDS = ['kl-sentral', 'masjid-jamek', 'ampang-park', 'chan-sow-lin'];
const HOME = (() => {
  const pts = HOME_IDS.map((id) => AT.get(id)!);
  const xs = pts.map((p) => p.x * GRID);
  const ys = pts.map((p) => p.y * GRID);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
})();
/** The transparent sheet header over the top of the diagram. */
const HEADER_HEIGHT = 56;
const TAP_SLOP = 10;

const points = (pts: readonly Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * The schematic KL rail map (plan 13/06): the eight Rapid KL lines and KTM
 * Komuter, drawn once as SVG and moved as a whole. Pinch zooms about the
 * fingers, pan drags (and coasts, unless Reduce Motion is on), double-tap
 * zooms 2× about the tap, and a tap opens the station under it (a 44 pt
 * target at every zoom).
 *
 * Everything moves on the UI thread through one `Animated.View` transform;
 * the SVG never re-renders during a gesture. Crossing the label threshold
 * flips one JS state, and a tap crosses to JS once.
 *
 * It opens on the city core at 1×. Each new `fitSignal` (the screen's Fit
 * button bumps a counter) eases out to the whole network, which may be below
 * 0.6× on a phone, so the pinch range reaches that far too.
 */
export function NetworkDiagram({
  onOpenStation,
  fitSignal = 0,
}: {
  onOpenStation: (id: string) => void;
  fitSignal?: number;
}) {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const view = useSharedValue<Viewport>({ width: 0, height: 0, top: 0, bottom: 0 });
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState(true);

  const apply = useCallback(
    (t: Transform, animate: boolean) => {
      'worklet';
      if (animate) {
        const timing = { duration: motion.reposition, easing: EASE_OUT };
        scale.set(withTiming(t.scale, timing));
        tx.set(withTiming(t.x, timing));
        ty.set(withTiming(t.y, timing));
      } else {
        scale.set(t.scale);
        tx.set(t.x);
        ty.set(t.y);
      }
    },
    [scale, tx, ty],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const v = { width, height, top: HEADER_HEIGHT, bottom: insets.bottom };
      const first = view.get().width === 0;
      view.set(v);
      if (first) {
        apply(centreOn(HOME.x, HOME.y, 1, SIZE, v), false);
        setReady(true);
      } else {
        apply(clampTransform({ scale: scale.get(), x: tx.get(), y: ty.get() }, SIZE, v), false);
      }
    },
    [apply, insets.bottom, scale, tx, ty, view],
  );

  // Fit: the whole network.
  useEffect(() => {
    if (fitSignal === 0 || view.get().width === 0) return;
    apply(fitTransform(SIZE, view.get()), !reduceMotion);
  }, [apply, fitSignal, reduceMotion, view]);

  // Names thin out when zoomed out: one state flip at the threshold, not per frame.
  useAnimatedReaction(
    () => scale.get() >= LABEL_MIN_SCALE,
    (on, prev) => {
      if (on !== prev) scheduleOnRN(setLabels, on);
    },
  );

  const openAt = useCallback(
    (x: number, y: number, s: number) => {
      const id = nearestStation(x, y, s);
      if (id) onOpenStation(id);
    },
    [onOpenStation],
  );

  const stop = () => {
    'worklet';
    cancelAnimation(scale);
    cancelAnimation(tx);
    cancelAnimation(ty);
  };

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      stop();
    },
    onUpdate: (e) => {
      'worklet';
      const v = view.get();
      const t = zoomAbout(
        { scale: scale.get(), x: tx.get(), y: ty.get() },
        e.scaleChange,
        e.focalX,
        e.focalY,
        SIZE,
        v,
        minScale(SIZE, v),
      );
      scale.set(t.scale);
      tx.set(t.x);
      ty.set(t.y);
    },
  });

  const pan = usePanGesture({
    maxPointers: 2,
    onActivate: () => {
      'worklet';
      stop();
    },
    onUpdate: (e) => {
      'worklet';
      const t = clampTransform(
        { scale: scale.get(), x: tx.get() + e.changeX, y: ty.get() + e.changeY },
        SIZE,
        view.get(),
      );
      tx.set(t.x);
      ty.set(t.y);
    },
    onDeactivate: (e) => {
      'worklet';
      if (reduceMotion) return;
      const v = view.get();
      const s = scale.get();
      tx.set(withDecay({ velocity: e.velocityX, clamp: translateBounds(SIZE.width, v.width, s) }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: translateBounds(SIZE.height, v.height, s) }));
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDistance: TAP_SLOP,
    onActivate: (e) => {
      'worklet';
      stop();
      const v = view.get();
      const t = zoomAbout({ scale: scale.get(), x: tx.get(), y: ty.get() }, 2, e.x, e.y, SIZE, v, minScale(SIZE, v), MAX_SCALE);
      apply(t, !reduceMotion);
    },
  });

  const tap = useTapGesture({
    maxDistance: TAP_SLOP,
    // A pinch that starts on a station mustn't open it too.
    requireToFail: [doubleTap, pinch],
    onActivate: (e) => {
      'worklet';
      const s = scale.get();
      scheduleOnRN(openAt, (e.x - tx.get()) / s, (e.y - ty.get()) / s, s);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap, tap);

  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.viewport} onLayout={onLayout} collapsable={false}>
          {ready ? (
            <Animated.View
              style={[styles.canvas, moved]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <DiagramArt scheme={scheme} labels={labels} />
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/**
 * The SVG itself, re-rendered only for the colour scheme and the label
 * threshold. Each line is a paper casing under its colour, so a later line
 * crossing an earlier one shows a sliver of paper either side. Stations on
 * one line are paper squares in its colour; on two or more, an ink-bordered
 * pill spanning the lines; a walking link is an ink connector.
 */
const DiagramArt = memo(function DiagramArt({ scheme, labels }: { scheme: Scheme; labels: boolean }) {
  const paper = pick(hex.paper, scheme);
  const ink = pick(hex.ink, scheme);
  return (
    <Svg width={SIZE.width} height={SIZE.height}>
      {PATHS.flatMap((p) =>
        p.branches.flatMap((b, i) => [
          <Polyline
            key={`${p.code}-${i}-casing`}
            points={points(b)}
            fill="none"
            stroke={paper}
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
          />,
          <Polyline
            key={`${p.code}-${i}`}
            points={points(b)}
            fill="none"
            stroke={p.color}
            strokeWidth={5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />,
        ]),
      )}
      {DIAGRAM_LINKS.flatMap(([a, b]) => {
        const p = AT.get(a)!;
        const q = AT.get(b)!;
        const ends = { x1: p.x * GRID, y1: p.y * GRID, x2: q.x * GRID, y2: q.y * GRID };
        return [
          <Line key={`${a}-${b}-ink`} {...ends} stroke={ink} strokeWidth={8} strokeLinecap="round" />,
          <Line key={`${a}-${b}`} {...ends} stroke={paper} strokeWidth={4} strokeLinecap="round" />,
        ];
      })}
      {MARKERS.map((m) => (
        <Rect
          key={m.id}
          x={m.x - m.width / 2}
          y={m.y - m.height / 2}
          width={m.width}
          height={m.height}
          rx={m.color ? 0 : 4}
          fill={paper}
          stroke={m.color ?? ink}
          strokeWidth={2}
        />
      ))}
      {DIAGRAM_STATIONS.map((s) => {
        if (!s.label) return null;
        const interchange = INTERCHANGES.has(s.id);
        if (!labels && !interchange) return null;
        return (
          <SvgText
            key={s.id}
            x={s.x * GRID + s.label.dx}
            y={s.y * GRID + s.label.dy}
            fill={ink}
            fontSize={11}
            fontWeight={interchange ? '600' : '400'}
            textAnchor={s.label.anchor}
          >
            {s.name}
          </SvgText>
        );
      })}
    </Svg>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE.width,
    height: SIZE.height,
    transformOrigin: 'left top',
  },
});
