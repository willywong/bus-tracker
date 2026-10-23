import { SymbolView } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isGlassAvailable, useReduceTransparency } from '@/components/GlassGuard';
import { color, radius, space } from '@/theme/design';

/**
 * A tappable row on its own Liquid Glass card, with a chevron, so it reads
 * as something to press (the station sheet's line and bus rows). The glass
 * is interactive: it answers the touch natively. Cards stack with
 * {@link GLASS_ROW_GAP} between them instead of hairlines. Reduce
 * Transparency, or no glass, draws the card in the fill colour and dims it
 * while pressed.
 */
export function GlassRow({
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
  const reduceTransparency = useReduceTransparency();
  const glass = isGlassAvailable() && !reduceTransparency;
  const [pressed, setPressed] = useState(false);
  const content = (
    <View style={styles.inner}>
      <View style={[styles.content, style]}>{children}</View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={color.tertiaryLabel} />
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {glass ? (
        // Tinted with the row fill: on the plain sheet, untinted glass has
        // nothing to refract and all but disappears.
        <GlassView glassEffectStyle="regular" isInteractive tintColor={color.fill} style={styles.card}>
          {content}
        </GlassView>
      ) : (
        <View style={[styles.card, styles.solid, pressed && styles.pressed]}>{content}</View>
      )}
    </Pressable>
  );
}

/** Space between stacked glass rows. */
export const GLASS_ROW_GAP = space.xs;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.row,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: color.fill,
  },
  pressed: {
    opacity: 0.55,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.sm,
    paddingRight: space.sm,
  },
  content: {
    flex: 1,
  },
});
