import type { RailLine } from '@bus-tracker/shared';
import { StyleSheet, Text, View } from 'react-native';

import { lineBadgeLabel, lineDisplayName } from '@/components/rail/stationModel';
import { RowButton } from '@/components/ui/RowButton';

/**
 * A rail line's chip: filled in the line's official colour with its official
 * text colour, labelled with the line's short code ("KJ", "KG", "BRT").
 * Rail lines are the one place Calm Mono allows colour, so the chip keeps
 * the same colours in light and dark. With `onPress` it's a button that
 * opens the line.
 */
export function LineBadge({
  line,
  size = 'regular',
  onPress,
}: {
  line: Pick<RailLine, 'code' | 'name' | 'color' | 'textColor'>;
  size?: 'regular' | 'small';
  onPress?: () => void;
}) {
  const label = lineBadgeLabel(line);
  const name = lineDisplayName(line);
  const chip = (
    <View style={[styles.badge, size === 'small' && styles.badgeSmall, { backgroundColor: line.color }]}>
      <Text
        style={[styles.text, size === 'small' && styles.textSmall, { color: line.textColor }]}
        allowFontScaling
        maxFontSizeMultiplier={1.6}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={name}>
        {chip}
      </View>
    );
  }
  return (
    <RowButton onPress={onPress} accessibilityLabel={name} accessibilityHint="Shows the whole line">
      {chip}
    </RowButton>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 36,
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSmall: {
    minWidth: 28,
    minHeight: 20,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textSmall: {
    fontSize: 11,
  },
});
