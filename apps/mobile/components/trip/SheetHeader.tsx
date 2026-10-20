import { StyleSheet, Text, View } from 'react-native';

import { SourceMark } from '@/components/trip/Hero';
import type { HeroValue, SourceKind } from '@/components/trip/model';
import { color, MARGIN, space, type } from '@/theme/design';

interface SheetHeaderProps {
  routeCode: string;
  /** Headline: the boarding stop, or "To <stop>" while riding. */
  title: string | null;
  /** Peek detent: add the status line and the compact number, since the body is hidden. */
  peek: boolean;
  status: string | null;
  source: SourceKind;
  compact: HeroValue | null;
}

/**
 * Top row of the trip sheet. Outlined route chip and the stop name; at the
 * peek detent (where it is the only content) it also carries the status
 * line and a thin compact number on the trailing edge.
 */
export function SheetHeader({ routeCode, title, peek, status, source, compact }: SheetHeaderProps) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <RouteBadge code={routeCode} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title ?? 'Your stop'}
        </Text>
        {peek && status ? (
          <View style={styles.statusRow}>
            <SourceMark source={source} size={6} />
            <Text style={styles.status} numberOfLines={1}>
              {status}
            </Text>
          </View>
        ) : null}
      </View>
      {peek && compact ? (
        <View style={styles.compact} accessible accessibilityLabel={compact.unit ? `${compact.text} ${compact.unit}` : compact.text}>
          <Text style={[styles.compactText, compact.kind === 'word' && styles.compactWord]}>
            {compact.text}
          </Text>
          {compact.unit ? <Text style={styles.compactUnit}>{compact.unit}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Outlined chip: the route code in ink, no fill. */
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
    minHeight: 48,
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
  badge: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.outline,
    alignItems: 'center',
    justifyContent: 'center',
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
