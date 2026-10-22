import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Button, Host, Image as SwiftImage } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { SourceMark } from '@/components/trip/Hero';
import { PEEK_RAIL_HEIGHT } from '@/components/trip/PeekRail';
import type { HeroValue, SourceKind } from '@/components/trip/model';
import { color, EASE_OUT, hex, MARGIN, motion, pick, space, type } from '@/theme/design';

// Peek-only pieces crossfade with the sheet body (see SheetBody in trip.tsx):
// in at the body's reveal pace, out at its faster exit pace.
const fadeIn = FadeIn.duration(motion.sheetIn).easing(EASE_OUT);
const fadeOut = FadeOut.duration(motion.sheetOut).easing(EASE_OUT);
// The stop name glides between centred (alone) and raised (over the status).
const settle = LinearTransition.duration(motion.sheetIn).easing(EASE_OUT);

interface SheetHeaderProps {
  routeCode: string;
  /** In place of the route chip (Go: the current leg's chip, or a walker). */
  badge?: ReactNode;
  /** Headline: the boarding stop, or "To <stop>" while riding. */
  title: string | null;
  /** Peek detent: add the status line and the compact number, since the body is hidden. */
  peek: boolean;
  status: string | null;
  source: SourceKind;
  compact: HeroValue | null;
  /** Peek only: the leave-by / next-bus strip under the header row. */
  strip?: PeekStripProps | null;
  /**
   * Peek only: richer content under the stop name (see PeekCard). Replaces
   * the strip, the status line and the compact number.
   */
  peekContent?: ReactNode;
}

/**
 * Top row of the trip sheet. Outlined route chip and the stop name; at the
 * peek detent (where it is the only content) it also carries the status
 * line and a thin compact number on the trailing edge.
 */
export function SheetHeader({
  routeCode,
  badge,
  title,
  peek,
  status,
  source,
  compact,
  strip,
  peekContent,
}: SheetHeaderProps) {
  const card = peekContent != null;
  return (
    <View>
      <HeaderRow
        routeCode={routeCode}
        badge={badge}
        title={title}
        peek={peek && !card}
        status={status}
        source={source}
        compact={compact}
      />
      <PeekLayer peek={peek} strip={strip} content={peekContent} />
    </View>
  );
}

/** The peek's content under the header: a PeekCard when given, else the strip. */
function PeekLayer({
  peek,
  strip,
  content,
}: {
  peek: boolean;
  strip?: PeekStripProps | null;
  content?: ReactNode;
}) {
  if (content == null) return <PeekStripLayer show={peek} strip={strip} />;
  if (!peek) return null;
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={styles.cardLayer}>
      {content}
    </Animated.View>
  );
}

/**
 * The peek strip, out of flow over the top of the (hidden) body, so the
 * body never shifts when the strip comes and goes: the two simply crossfade.
 */
function PeekStripLayer({ show, strip }: { show: boolean; strip?: PeekStripProps | null }) {
  if (!show || !strip || (!strip.left && !strip.right)) return null;
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={styles.stripLayer}>
      <PeekStrip {...strip} />
    </Animated.View>
  );
}

/**
 * Header of a stop or bus detail: a Liquid Glass back button (native
 * SwiftUI, the iOS 26 sheet control) beside the title and where it sits
 * relative to your trip. Peek adds the strip, like the trip header.
 */
export function DetailHeader({
  title,
  subtitle,
  peek,
  strip,
  peekContent,
  onBack,
  backLabel = 'Back to your trip',
}: {
  title: string;
  subtitle: string | null;
  peek: boolean;
  strip?: PeekStripProps | null;
  /** Peek only: a PeekCard under the title, in place of the strip. */
  peekContent?: ReactNode;
  onBack: () => void;
  /** VoiceOver label of the back button. */
  backLabel?: string;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View>
      <View style={styles.row} accessibilityRole="header">
        <Host matchContents>
          <Button
            onPress={onBack}
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('circle'),
              controlSize('large'),
              tint(pick(hex.ink, scheme)),
              accessibilityLabel(backLabel),
            ]}
          >
            <SwiftImage systemName="chevron.left" size={17} />
          </Button>
        </Host>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.status} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <PeekLayer peek={peek} strip={strip} content={peekContent} />
    </View>
  );
}

function HeaderRow({
  routeCode,
  badge,
  title,
  peek,
  status,
  source,
  compact,
}: Omit<SheetHeaderProps, 'strip'>) {
  return (
    <View style={styles.row} accessibilityRole="header">
      {badge ?? <RouteBadge code={routeCode} />}
      <View style={styles.titles}>
        <Animated.Text layout={settle} style={styles.title} numberOfLines={1}>
          {title ?? 'Your stop'}
        </Animated.Text>
        {peek && status ? (
          <Animated.View entering={fadeIn} exiting={fadeOut} style={styles.statusRow}>
            <SourceMark source={source} size={11} />
            <Text style={styles.status} numberOfLines={1}>
              {status}
            </Text>
          </Animated.View>
        ) : null}
      </View>
      {peek && compact ? (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          style={styles.compact}
          accessible
          accessibilityLabel={compact.unit ? `${compact.text} ${compact.unit}` : compact.text}
        >
          <Text style={[styles.compactText, compact.kind === 'word' && styles.compactWord]}>
            {compact.text}
          </Text>
          {compact.unit ? <Text style={styles.compactUnit}>{compact.unit}</Text> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

export interface PeekCell {
  icon?: SFSymbol;
  text: string;
  /** Secondary text after the main text, e.g. "+24 min". */
  trailing?: string | null;
  warning?: boolean;
}

export interface PeekStripProps {
  left: PeekCell | null;
  right: PeekCell | null;
}

/**
 * The detail and ride peeks' second row: what to do next on the left, the
 * bus after this one on the right, split by a vertical hairline under a
 * full-width one.
 */
function PeekStrip({ left, right }: PeekStripProps) {
  if (!left && !right) return null;
  return (
    <View style={styles.strip}>
      <View style={styles.stripBand}>
        <View style={styles.stripRule} />
      </View>
      <View style={styles.stripCells}>
        {left ? <PeekCellView cell={left} /> : null}
        {left && right ? <View style={styles.stripDivider} /> : null}
        {right ? <PeekCellView cell={right} align={left ? 'end' : 'start'} /> : null}
      </View>
    </View>
  );
}

function PeekCellView({ cell, align = 'start' }: { cell: PeekCell; align?: 'start' | 'end' }) {
  return (
    <View
      style={[styles.cell, align === 'end' && styles.cellEnd]}
      accessible
      accessibilityLabel={cell.trailing ? `${cell.text}, ${cell.trailing}` : cell.text}
    >
      {cell.icon ? (
        <SymbolView
          name={cell.icon}
          size={14}
          weight="medium"
          tintColor={cell.warning ? color.warning : color.label}
        />
      ) : null}
      <Text style={[styles.cellText, cell.warning && styles.cellWarning]} numberOfLines={1}>
        {cell.text}
      </Text>
      {cell.trailing ? (
        <Text style={styles.cellTrailing} numberOfLines={1}>
          {cell.trailing}
        </Text>
      ) : null}
    </View>
  );
}

/** Outlined chip: the route code in ink, no fill. */
export function RouteBadge({ code, size = 'regular' }: { code: string; size?: 'regular' | 'small' }) {
  return (
    <View style={[styles.badge, size === 'small' && styles.badgeSmall]}>
      <SymbolView
        name="bus.fill"
        size={size === 'small' ? 10 : 12}
        tintColor={color.label}
        accessibilityElementsHidden
      />
      <Text
        style={[styles.badgeText, size === 'small' && styles.badgeTextSmall]}
        accessibilityLabel={`Route ${code}`}
      >
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: MARGIN,
    minHeight: 44,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.body,
    fontWeight: '500',
    color: color.label,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: {
    ...type.footnote,
    flexShrink: 1,
    color: color.secondaryLabel,
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  compactText: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '200',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  compactWord: {
    fontSize: 22,
    fontWeight: '300',
  },
  compactUnit: {
    ...type.footnote,
    fontSize: 14,
    color: color.secondaryLabel,
  },
  cardLayer: {
    position: 'absolute',
    top: '100%',
    left: MARGIN,
    right: MARGIN,
    marginTop: 4,
  },
  stripLayer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
  },
  strip: {
    marginTop: 2,
    marginHorizontal: MARGIN,
  },
  stripBand: {
    height: PEEK_RAIL_HEIGHT,
    justifyContent: 'center',
  },
  stripRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
  },
  stripCells: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
  },
  stripDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginTop: 2,
    marginBottom: 2,
    marginHorizontal: space.sm,
    backgroundColor: color.hairline,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cellEnd: {
    justifyContent: 'flex-end',
  },
  cellText: {
    ...type.status,
    fontWeight: '500',
    color: color.label,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  cellWarning: {
    color: color.warning,
  },
  cellTrailing: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.outline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  badgeSmall: {
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  badgeText: {
    color: color.label,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  badgeTextSmall: {
    fontSize: 11,
  },
});
