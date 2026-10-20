import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A tappable row with a pressed state. Pressable's style-as-a-function is
 * swallowed by NativeWind's CSS interop in this app, so the pressed look is
 * tracked in state and the layout lives on a plain inner View.
 */
export function RowButton({
  onPress,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
}: {
  onPress: () => void;
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
      <View style={[style, pressed && styles.pressed]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.55,
  },
});
