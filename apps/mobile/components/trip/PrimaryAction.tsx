import { Button, HStack, Host, Image, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  animation,
  Animation,
  buttonBorderShape,
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundStyle,
  frame,
  symbolEffect,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { StyleSheet, Text, View } from 'react-native';

import { hashText } from '@/components/trip/Hero';
import { formatCountdown, mins, type TripAction } from '@/components/trip/model';
import { color, hex, pick, space, type } from '@/theme/design';

/** A `useNativeState` value that fires a discrete symbol effect on change. */
type SymbolTrigger = NonNullable<NonNullable<Parameters<typeof symbolEffect>[1]>['value']>;

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
 * The sheet's single primary action: a full-width Liquid Glass capsule with
 * an ink label, semibold when it's a decision to make and regular while
 * following or walking. One decision at a time:
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
        <Text style={styles.tightText}>This bus arrives before your {walkMinutes}-min walk.</Text>
      </View>
    );
  }

  let label: string;
  let icon: SFSymbol;
  let prominent: boolean;
  let onPress: () => void;
  // What the tap does, for VoiceOver only: no visible helper text.
  let hint: string;

  switch (action.kind) {
    case 'follow':
      prominent = !action.following;
      icon = action.following ? 'bell.fill' : 'bell';
      label = action.following
        ? `Following · leave in ${mins(action.leaveInMinutes)}`
        : `Leave in ${mins(action.leaveInMinutes)}`;
      onPress = action.following ? onUnfollow : onFollow;
      hint = action.following
        ? 'Stops following this bus on your Lock Screen'
        : `Follows this bus on your Lock Screen. Your walk is ${mins(walkMinutes)}.`;
      break;
    case 'leave-now':
      prominent = true;
      icon = 'figure.walk';
      label = 'Leave now';
      onPress = onStartWalking;
      hint = `Starts a ${walkMinutes}-min walk timer`;
      break;
    case 'walking':
      prominent = false;
      icon = 'figure.walk';
      label = `Walking · ${formatCountdown(action.remainingSeconds)}`;
      onPress = onCancelWalking;
      hint = 'Cancels the walk timer';
      break;
  }

  return (
    <View style={styles.wrap}>
      <GlassCapsuleButton
        label={label}
        icon={icon}
        prominent={prominent}
        hint={hint}
        scheme={scheme}
        onPress={onPress}
      />
    </View>
  );
}

/**
 * A full-width Liquid Glass capsule with an ink glyph and label, semibold
 * when it's a decision to make. The sheet's primary action, and the one
 * action on the small sheets above it.
 */
export function GlassCapsuleButton({
  label,
  icon,
  prominent,
  hint,
  scheme,
  onPress,
  bounce,
}: {
  label: string;
  icon: SFSymbol;
  prominent: boolean;
  /** What the tap does, for VoiceOver only: no visible helper text. */
  hint: string;
  scheme: 'light' | 'dark';
  onPress: () => void;
  /** The glyph bounces once each time this changes (e.g. a reminder set). */
  bounce?: SymbolTrigger;
}) {
  const ink = pick(hex.ink, scheme);
  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          controlSize('large'),
          tint(ink),
          accessibilityHint(hint),
        ]}
      >
        <HStack
          spacing={8}
          modifiers={[
            frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: 30 }),
            foregroundStyle(ink),
          ]}
        >
          <Image
            systemName={icon}
            size={17}
            modifiers={bounce ? [symbolEffect({ effect: 'bounce' }, { value: bounce })] : []}
          />
          <SwiftText
            modifiers={[
              font({ size: 17, weight: prominent ? 'semibold' : 'regular' }),
              // A new label crossfades rather than snapping.
              contentTransition('opacity'),
              animation(Animation.smooth({ duration: 0.2 }), hashText(label)),
            ]}
          >
            {label}
          </SwiftText>
        </HStack>
      </Button>
    </Host>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.xs,
  },
  host: {
    alignSelf: 'stretch',
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
