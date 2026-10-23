import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, space } from '@/theme/design';

/**
 * A tappable row on its own grouped card, with a chevron, so it reads as
 * something to press (the station sheet's line and bus rows). A plain fill,
 * not Liquid Glass: the rows are content, and glass is kept for the controls
 * that float over it. Cards stack with {@link CARD_ROW_GAP} between them
 * instead of hairlines, and dim while pressed.
 */
export function CardRow({
  onPress,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
}: {
  onPress: () => void;
  /** The content's layout (direction, gaps, height), inside the card's padding. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View style={[styles.card, pressed && styles.pressed]}>
        <View style={[styles.content, style]}>{children}</View>
        <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
      </View>
    </Pressable>
  );
}

/** Space between stacked card rows. */
export const CARD_ROW_GAP = space.xs;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.row,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
  },
  pressed: {
    opacity: 0.55,
  },
  content: {
    flex: 1,
  },
});
