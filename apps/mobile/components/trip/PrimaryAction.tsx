import { Button, HStack, Host, Image, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { StyleSheet, Text, View } from 'react-native';

import { formatCountdown, type TripAction } from '@/components/trip/model';
import { color, hex, space, type } from '@/theme/design';

interface PrimaryActionProps {
  action: TripAction;
  walkMinutes: number;
  scheme: 'light' | 'dark';
  onFollow: () => void;
  onUnfollow: () => void;
  onStartWalking: () => void;
  onCancelWalking: () => void;
}

/**
 * The sheet's single primary action. Solid fill (content layer — not glass),
 * full width, one decision at a time:
 *   Leave in N min → follow on Lock Screen
 *   Leave now      → start the walk
 *   Walking 3:05   → cancel
 */
export function PrimaryAction({
  action,
  walkMinutes,
  scheme,
  onFollow,
  onUnfollow,
  onStartWalking,
  onCancelWalking,
}: PrimaryActionProps) {
  if (action.kind === 'none') return null;

  if (action.kind === 'tight') {
    return (
      <View style={styles.tight}>
        <Text style={styles.tightText}>
          This bus arrives before your {walkMinutes}-min walk.
        </Text>
      </View>
    );
  }

  let label: string;
  let icon: SFSymbol;
  let prominent: boolean;
  let tintHex: string;
  let onPress: () => void;
  let footnote: string;

  switch (action.kind) {
    case 'follow':
      prominent = !action.following;
      icon = action.following ? 'bell.fill' : 'bell';
      label = action.following
        ? `Following · leave in ${action.leaveInMinutes} min`
        : `Leave in ${action.leaveInMinutes} min`;
      tintHex = scheme === 'dark' ? hex.accent.dark : hex.accent.light;
      onPress = action.following ? onUnfollow : onFollow;
      footnote = action.following
        ? 'Shown on your Lock Screen. Tap to stop following.'
        : `${walkMinutes} min walk to your stop. Tap to follow on your Lock Screen.`;
      break;
    case 'leave-now':
      prominent = true;
      icon = 'figure.walk';
      label = 'Leave now';
      tintHex = scheme === 'dark' ? hex.warning.dark : hex.warning.light;
      onPress = onStartWalking;
      footnote = `${walkMinutes} min walk to your stop. Tap when you set off.`;
      break;
    case 'walking':
      prominent = false;
      icon = 'figure.walk';
      label = `Walking · ${formatCountdown(action.remainingSeconds)}`;
      tintHex = scheme === 'dark' ? hex.accent.dark : hex.accent.light;
      onPress = onCancelWalking;
      footnote = 'Tap to cancel the walk timer.';
      break;
  }

  return (
    <View style={styles.wrap}>
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle(prominent ? 'borderedProminent' : 'bordered'),
            buttonBorderShape('capsule'),
            controlSize('large'),
            tint(tintHex),
          ]}
        >
          <HStack spacing={8} modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: 30 })]}>
            <Image systemName={icon} size={17} />
            <SwiftText modifiers={[font({ size: 17, weight: 'semibold' })]}>{label}</SwiftText>
          </HStack>
        </Button>
      </Host>
      <Text style={styles.footnote}>{footnote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.xs,
  },
  host: {
    alignSelf: 'stretch',
  },
  footnote: {
    ...type.footnote,
    color: color.secondaryLabel,
    textAlign: 'center',
  },
  tight: {
    paddingVertical: space.xs,
  },
  tightText: {
    ...type.status,
    color: color.warning,
    fontWeight: '500',
  },
});
