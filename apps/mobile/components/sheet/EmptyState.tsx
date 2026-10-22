import { Button, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { color, hex, pick, space, type } from '@/theme/design';

/** Thin SF Symbol, plain type, one ink button. No illustration chrome. */
export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  scheme,
  compact = false,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  scheme: 'light' | 'dark';
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <SymbolView
        name={icon}
        size={compact ? 36 : 56}
        weight="ultraLight"
        tintColor={color.label}
      />
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <Host matchContents style={styles.emptyAction}>
          <Button
            onPress={onAction}
            modifiers={[
              buttonStyle('borderedProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
              tint(pick(hex.ink, scheme)),
            ]}
          >
            <SwiftText
              modifiers={[
                font({ size: 17, weight: 'semibold' }),
                foregroundStyle(pick(hex.paper, scheme)),
              ]}
            >
              {actionLabel}
            </SwiftText>
          </Button>
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
  },
  emptyCompact: {
    paddingTop: space.xs,
    paddingHorizontal: 0,
  },
  emptyTitle: {
    ...type.title,
    fontWeight: '500',
    color: color.label,
    textAlign: 'center',
    marginTop: space.xs,
  },
  emptyMessage: {
    ...type.status,
    color: color.secondaryLabel,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: space.md,
  },
});
