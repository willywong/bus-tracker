import { RAIL_LINES } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { memo, useCallback, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDecay,
} from 'react-native-reanimated';

import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

import type { DiagramLine } from './klRailDiagram';
import { chipBadge, chipName, type LineSelection } from './lineFilter';

/** The bar's height above the home indicator: chips and their padding. */
export const CHIP_BAR_HEIGHT = 56;
/** The "All stops" button's row, over the map just above the bar. */
export const STRIP_BUTTON_HEIGHT = 44;

const TEXT_ON = new Map(RAIL_LINES.map((l) => [l.code, l.textColor]));

/**
 * The rail map's line filter: "All", then one chip per line in the
 * schematic's order. Chips pick several at once; an unpicked chip shows the
 * line's colour as a badge, a picked one is filled with it. With exactly one
 * line picked, a button above the bar opens that line's strip map, where
 * every stop is a readable row.
 *
 * A solid bar, not glass: glass in a sheet at its largest detent draws
 * nothing until the sheet moves. The chips slide on a gesture-handler pan
 * rather than a ScrollView: on iOS 27 UIKit adopts the sheet's only
 * UIScrollView as its content scroll view and moves its content up under
 * the header, leaving the bar empty.
 */
export function LineChips({
  lines,
  selection,
  onToggle,
  onAll,
  onOpenStrip,
  bottomInset,
}: {
  lines: readonly DiagramLine[];
  selection: LineSelection;
  onToggle: (code: string) => void;
  onAll: () => void;
  /** Null hides the button: no single line picked, or no network to open it from. */
  onOpenStrip: (() => void) | null;
  bottomInset: number;
}) {
  const all = selection.size === 0;
  const single = selection.size === 1 ? lines.find((l) => selection.has(l.code)) : undefined;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {single && onOpenStrip ? (
        <View style={styles.stripRow} pointerEvents="box-none">
          <RowButton
            onPress={onOpenStrip}
            style={styles.stripButton}
            accessibilityLabel={`All stops on the ${single.name}`}
            accessibilityHint="Shows the line as a list of stops"
          >
            <View style={[styles.stripSwatch, { backgroundColor: single.color }]} />
            <Text style={styles.stripText} maxFontSizeMultiplier={1.3}>
              All stops
            </Text>
            <SymbolView
              name="chevron.right"
              size={12}
              weight="semibold"
              tintColor={color.secondaryLabel}
            />
          </RowButton>
        </View>
      ) : null}
      <View style={[styles.bar, { paddingBottom: bottomInset }]}>
        <ChipStrip>
          <Chip
            code=""
            label="All"
            selected={all}
            onPress={onAll}
            fill={color.ink}
            textOn={color.onAccent}
          />
          {lines.map((line) => (
            <Chip
              key={line.code}
              code={line.code}
              badge={chipBadge(line)}
              label={chipName(line)}
              a11y={line.name}
              selected={selection.has(line.code)}
              onPress={onToggle}
              fill={line.color}
              textOn={TEXT_ON.get(line.code) ?? '#FFFFFF'}
            />
          ))}
        </ChipStrip>
      </View>
    </View>
  );
}

/**
 * A row wider than the screen that slides sideways under a finger and
 * coasts (unless Reduce Motion is on), held between its two ends. A tap
 * still reaches a chip; once the pan takes over, the chip's press cancels.
 */
function ChipStrip({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(0);
  const barWidth = useSharedValue(0);
  const rowWidth = useSharedValue(0);

  const onBar = useCallback(
    (e: LayoutChangeEvent) => barWidth.set(e.nativeEvent.layout.width),
    [barWidth],
  );
  const onRow = useCallback(
    (e: LayoutChangeEvent) => rowWidth.set(e.nativeEvent.layout.width),
    [rowWidth],
  );

  const pan = usePanGesture({
    activeOffsetX: [-8, 8],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      cancelAnimation(x);
    },
    onUpdate: (e) => {
      'worklet';
      const lo = Math.min(0, barWidth.get() - rowWidth.get());
      x.set(Math.min(0, Math.max(lo, x.get() + e.changeX)));
    },
    onDeactivate: (e) => {
      'worklet';
      if (reduceMotion) return;
      const lo = Math.min(0, barWidth.get() - rowWidth.get());
      x.set(withDecay({ velocity: e.velocityX, clamp: [lo, 0] }));
    },
  });

  const slid = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.strip} onLayout={onBar} collapsable={false}>
        <Animated.View style={[styles.chips, slid]} onLayout={onRow}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** One chip, re-rendered only when its own pick changes. */
const Chip = memo(function Chip({
  code,
  badge,
  label,
  a11y,
  selected,
  onPress,
  fill,
  textOn,
}: {
  code: string;
  badge?: string;
  label: string;
  a11y?: string;
  selected: boolean;
  /** Called with `code`, so one stable handler serves every chip. */
  onPress: (code: string) => void;
  /** The line's colour (or ink for All): the badge unpicked, the whole chip picked. */
  fill: ColorValue;
  textOn: ColorValue;
}) {
  return (
    <RowButton onPress={() => onPress(code)} accessibilityLabel={a11y ?? label}>
      <View
        style={[styles.chip, selected && { backgroundColor: fill }]}
        accessibilityState={{ selected }}
      >
        {badge ? (
          <View style={[styles.badge, { backgroundColor: selected ? 'transparent' : fill }]}>
            <Text style={[styles.badgeText, { color: textOn }]} maxFontSizeMultiplier={1.3}>
              {badge}
            </Text>
          </View>
        ) : null}
        <Text
          style={[styles.label, selected && { color: textOn, fontWeight: '600' }]}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </RowButton>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    backgroundColor: color.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  strip: {
    height: CHIP_BAR_HEIGHT,
    overflow: 'hidden',
  },
  chips: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    height: CHIP_BAR_HEIGHT,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 6,
    paddingRight: 12,
    minWidth: 44,
    justifyContent: 'center',
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  badge: {
    minWidth: 30,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  label: {
    ...type.footnote,
    fontSize: 15,
    color: color.label,
  },
  stripRow: {
    height: STRIP_BUTTON_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: space.md,
    marginBottom: space.xs,
  },
  stripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.outline,
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  },
  stripSwatch: {
    width: 14,
    height: 4,
    borderRadius: 2,
  },
  stripText: {
    ...type.status,
    fontWeight: '600',
    color: color.label,
  },
});
