import { StyleSheet, Text, View } from 'react-native';

import { color, MARGIN, motion, space, type } from '@/theme/design';
import Animated from 'react-native-reanimated';

interface SheetHeaderProps {
  routeCode: string;
  stopName: string | null;
  subtitle: string | null;
  /** Compact ETA, shown only at the peek detent where the hero is off-screen. */
  compact: string | null;
  showCompact: boolean;
  compactIsLive: boolean;
}

/**
 * Always-visible top row of the trip sheet — the only content at the peek
 * detent. Route badge + where you board, with a compact ETA on the trailing
 * edge that fades in when the sheet is collapsed.
 */
export function SheetHeader({
  routeCode,
  stopName,
  subtitle,
  compact,
  showCompact,
  compactIsLive,
}: SheetHeaderProps) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <RouteBadge code={routeCode} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {stopName ?? 'Your stop'}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {compact ? (
        <Animated.Text
          style={[
            styles.compact,
            !compactIsLive && styles.compactScheduled,
            {
              opacity: showCompact ? 1 : 0,
              transitionProperty: 'opacity',
              transitionDuration: motion.state,
            },
          ]}
          accessibilityElementsHidden={!showCompact}
          importantForAccessibility={showCompact ? 'auto' : 'no-hide-descendants'}
        >
          {compact}
        </Animated.Text>
      ) : null}
    </View>
  );
}

export function RouteBadge({ code, size = 'regular' }: { code: string; size?: 'regular' | 'small' }) {
  return (
    <View style={[styles.badge, size === 'small' && styles.badgeSmall]}>
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
    minHeight: 52,
  },
  titles: {
    flex: 1,
    gap: 1,
  },
  title: {
    ...type.title,
    fontSize: 20,
    lineHeight: 25,
    color: color.label,
  },
  subtitle: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  compact: {
    ...type.headline,
    fontSize: 20,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  compactScheduled: {
    fontWeight: '400',
    color: color.secondaryLabel,
  },
  badge: {
    minWidth: 52,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSmall: {
    minWidth: 0,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
  },
  badgeText: {
    color: color.onAccent,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'ui-rounded',
    fontVariant: ['tabular-nums'],
  },
  badgeTextSmall: {
    fontSize: 12,
  },
});
