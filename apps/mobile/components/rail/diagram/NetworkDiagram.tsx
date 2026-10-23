import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { EASE_OUT, hex, motion, pick, space, type Scheme } from '@/theme/design';
import { haptics } from '@/utils/haptics';

import { interchangeIds, linePaths, stationMarkers, type Point } from './geometry';
import { nearestStation } from './hitTest';
import {
  DIAGRAM_LINES,
  DIAGRAM_LINKS,
  DIAGRAM_SIZE,
  DIAGRAM_STATIONS,
  GRID,
} from './klRailDiagram';
import { fitWithLabels, labelStep, placeLabels } from './labels';
import { CHIP_BAR_HEIGHT, LineChips, STRIP_BUTTON_HEIGHT } from './LineChips';
import {
  ALL_LINES,
  lineShown,
  mixHex,
  shownStations,
  toggleLine,
  type LineSelection,
} from './lineFilter';
import {
  centreOn,
  clampTransform,
  fitTransform,
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
const PATH_OF = new Map(PATHS.map((p) => [p.code, p]));
/** How far a filtered-out line fades toward the paper. */
const FADE = 0.8;

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
 * The chip bar along the bottom filters lines: picked lines keep their
 * colour and names, the rest fade back, and the camera eases to fit what's
 * picked. With one line picked, "All stops" opens it as a strip map
 * (`onOpenLine`, null without a network to open it from). Clearing the
 * filter goes back to the city core at 1×.
 *
 * Everything moves on the UI thread through one `Animated.View` transform;
 * the SVG never re-renders during a gesture except when the zoom crosses a
 * label step (a few times through a pinch), and a tap crosses to JS once.
 *
 * It opens on the city core at 1×. Each new `fitSignal` (the screen's Fit
 * button bumps a counter) eases out to the picked lines, or the whole
 * network, which may be below 0.6× on a phone, so the pinch range reaches
 * that far too.
 */
export function NetworkDiagram({
  onOpenStation,
  onOpenLine = null,
  fitSignal = 0,
}: {
  onOpenStation: (id: string) => void;
  onOpenLine?: ((code: string) => void) | null;
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
  const [step, setStep] = useState(() => labelStep(1));
  const [selection, setSelection] = useState<LineSelection>(ALL_LINES);

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
      const v = { width, height, top: HEADER_HEIGHT, bottom: insets.bottom + CHIP_BAR_HEIGHT };
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

  /** The picked lines (or the whole network) fitted between the header and the chips. */
  const fitSelection = useCallback(
    (sel: LineSelection, animate: boolean) => {
      const v = view.get();
      if (v.width === 0) return;
      if (sel.size === 0) {
        apply(fitTransform(SIZE, v), animate);
        return;
      }
      // One line picked: its "All stops" button sits over the map too.
      const extra = sel.size === 1 && onOpenLine ? STRIP_BUTTON_HEIGHT + space.xs : 0;
      const room = { ...v, bottom: v.bottom + extra };
      const t = fitWithLabels(sel, DIAGRAM_STATIONS, DIAGRAM_LINES, GRID, SIZE, room);
      if (t) apply(t, animate);
    },
    [apply, onOpenLine, view],
  );

  // Fit: the picked lines, or the whole network.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    if (fitSignal === 0) return;
    fitSelection(selectionRef.current, !reduceMotion);
  }, [fitSelection, fitSignal, reduceMotion]);

  const changeSelection = useCallback(
    (next: LineSelection) => {
      haptics.selection();
      setSelection(next);
      const v = view.get();
      if (next.size > 0) fitSelection(next, !reduceMotion);
      else if (v.width > 0) apply(centreOn(HOME.x, HOME.y, 1, SIZE, v), !reduceMotion);
    },
    [apply, fitSelection, reduceMotion, view],
  );
  const onToggle = useCallback(
    (code: string) => changeSelection(toggleLine(selectionRef.current, code, DIAGRAM_LINES.length)),
    [changeSelection],
  );
  const onAll = useCallback(() => {
    if (selectionRef.current.size > 0) changeSelection(ALL_LINES);
  }, [changeSelection]);
  const single = selection.size === 1 ? [...selection][0] : null;
  const openStrip = useMemo(
    () => (single && onOpenLine ? () => onOpenLine(single) : null),
    [onOpenLine, single],
  );

  // Names re-place at each label step: a few JS renders through a pinch, not one per frame.
  useAnimatedReaction(
    () => labelStep(scale.get()),
    (next, prev) => {
      if (next !== prev) scheduleOnRN(setStep, next);
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
        // A line fit can sit below the usual floor: pinching from there mustn't jump.
        Math.min(minScale(SIZE, v), scale.get()),
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
      ty.set(
        withDecay({ velocity: e.velocityY, clamp: translateBounds(SIZE.height, v.height, s) }),
      );
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDistance: TAP_SLOP,
    onActivate: (e) => {
      'worklet';
      stop();
      const v = view.get();
      const t = zoomAbout(
        { scale: scale.get(), x: tx.get(), y: ty.get() },
        2,
        e.x,
        e.y,
        SIZE,
        v,
        minScale(SIZE, v),
        MAX_SCALE,
      );
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
              <DiagramArt scheme={scheme} step={step} selection={selection} />
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
      <LineChips
        lines={DIAGRAM_LINES}
        selection={selection}
        onToggle={onToggle}
        onAll={onAll}
        onOpenStrip={openStrip}
        bottomInset={insets.bottom}
      />
    </GestureHandlerRootView>
  );
}

const isKtm = (code: string) => code.startsWith('KTM');

/**
 * The SVG itself, re-rendered only for the colour scheme, the label step and
 * the line filter. Each line is a paper casing under its colour, so a later
 * line crossing an earlier one shows a sliver of paper either side; KTM
 * Komuter also carries a dashed paper centre, so it never reads as the
 * Kelana Jaya Line's near-identical red. Lines filtered out fade toward the
 * paper and go under the picked ones. Stations on one line are paper
 * squares in its colour; on two or more, an ink-bordered pill spanning the
 * lines; a walking link is an ink connector.
 */
const DiagramArt = memo(function DiagramArt({
  scheme,
  step,
  selection,
}: {
  scheme: Scheme;
  step: number;
  selection: LineSelection;
}) {
  const paper = pick(hex.paper, scheme);
  const ink = pick(hex.ink, scheme);
  const faint = (c: string) => mixHex(c, paper, FADE);
  const shown = useMemo(() => shownStations(selection, DIAGRAM_LINES), [selection]);
  const labels = useMemo(
    () => placeLabels(DIAGRAM_STATIONS, DIAGRAM_LINES, INTERCHANGES, selection, step, GRID),
    [selection, step],
  );
  // Filtered-out lines first, so the picked ones draw over them.
  const order = [
    ...DIAGRAM_LINES.filter((l) => !lineShown(selection, l.code)),
    ...DIAGRAM_LINES.filter((l) => lineShown(selection, l.code)),
  ];
  return (
    <Svg width={SIZE.width} height={SIZE.height}>
      {order.flatMap((line) => {
        const p = PATH_OF.get(line.code)!;
        const on = lineShown(selection, line.code);
        const stroke = on ? p.color : faint(p.color);
        return p.branches.flatMap((b, i) => {
          const pts = points(b);
          const out = [
            <Polyline
              key={`${p.code}-${i}-casing`}
              points={pts}
              fill="none"
              stroke={paper}
              strokeWidth={7}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
            <Polyline
              key={`${p.code}-${i}`}
              points={pts}
              fill="none"
              stroke={stroke}
              strokeWidth={5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
          ];
          if (isKtm(p.code) && on) {
            out.push(
              <Polyline
                key={`${p.code}-${i}-dash`}
                points={pts}
                fill="none"
                stroke={paper}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinejoin="round"
              />,
            );
          }
          return out;
        });
      })}
      {DIAGRAM_LINKS.flatMap(([a, b]) => {
        const p = AT.get(a)!;
        const q = AT.get(b)!;
        const on = shown.has(a) || shown.has(b);
        const ends = { x1: p.x * GRID, y1: p.y * GRID, x2: q.x * GRID, y2: q.y * GRID };
        return [
          <Line
            key={`${a}-${b}-ink`}
            {...ends}
            stroke={on ? ink : faint(ink)}
            strokeWidth={8}
            strokeLinecap="round"
          />,
          <Line key={`${a}-${b}`} {...ends} stroke={paper} strokeWidth={4} strokeLinecap="round" />,
        ];
      })}
      {MARKERS.map((m) => {
        const on = shown.has(m.id);
        // A pill where a picked line meets filtered-out ones stays ink: it's still a change.
        const edge = m.color ?? ink;
        return (
          <Rect
            key={m.id}
            x={m.x - m.width / 2}
            y={m.y - m.height / 2}
            width={m.width}
            height={m.height}
            rx={m.color ? 0 : 4}
            fill={paper}
            stroke={on ? edge : faint(edge)}
            strokeWidth={2}
          />
        );
      })}
      {labels.map((l) => (
        <SvgText
          key={l.id}
          x={l.x}
          y={l.y}
          fill={ink}
          fontSize={l.fontSize}
          fontWeight={l.bold ? '600' : '400'}
          textAnchor={l.anchor}
        >
          {l.name}
        </SvgText>
      ))}
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
