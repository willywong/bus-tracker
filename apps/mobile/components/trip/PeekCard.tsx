import { Button, HStack, Host, Image as SwiftImage, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  monospacedDigit,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { SourceMark } from '@/components/trip/Hero';
import { PeekRail, type RailEnd } from '@/components/trip/PeekRail';
import {
  formatCountdown,
  mins,
  type HeroValue,
  type SourceKind,
  type TripAction,
} from '@/components/trip/model';
import { color, hex, pick, space } from '@/theme/design';

export const PEEK_CARD_HEIGHT = 92;

interface PeekCardProps {
  hero: HeroValue | null;
  /** Drawn as a mark on the number; null draws none. */
  source: SourceKind | null;
  /** A live bus's stops before it arrives; null shows `aside` instead. */
  stopsAhead: number | null;
  /** What the rail ends at: your stop (the pin) or another stop (a bead). */
  railEnd?: RailEnd;
  /** Quiet line beside the number when there's no rail ("Arrives 11:44 AM"). */
  aside: string | null;
  /** The one thing to do: a glass button, a warning, or nothing. */
  action: ReactNode;
  /** Quiet fact on the right of the action, e.g. Arrives · 12:14 PM. */
  trailing: { label: string; value: string } | null;
  /** Far right of the number's row, as beside the hero: the warnings' glass capsule. */
  accessory?: ReactNode;
  /** The live dot on the number; off where the capsule carries it. The clock always shows. */
  liveMark?: boolean;
}

/**
 * The peek detent below the header, after a Live Activity: the number with
 * its source mark (green dot while live, orange once ageing, a clock when
 * scheduled — no words needed), the bus's journey beside it, then the one
 * thing to do as a Liquid Glass button and one quiet fact. Shared by the
 * trip, stop and bus sheets so the collapsed sheet always reads the same.
 */
export function PeekCard({
  hero,
  source,
  stopsAhead,
  railEnd = 'you',
  aside,
  action,
  trailing,
  accessory,
  liveMark = true,
}: PeekCardProps) {
  // With no action, "Arrives …" drops to the bottom row's empty left,
  // opposite the trailing fact: it isn't squeezed between the number and the capsule,
  // and still shows when the rail holds the top row.
  const asideBelow = action == null && aside != null && (accessory != null || stopsAhead != null);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {hero ? (
          <View
            style={styles.number}
            accessible
            accessibilityLabel={[
              hero.unit ? `${hero.text} ${hero.unit}` : hero.text,
              source === 'live'
                ? 'live'
                : source === 'aging'
                  ? 'live, not updated recently'
                  : source === 'scheduled'
                    ? 'scheduled'
                    : null,
            ]
              .filter(Boolean)
              .join(', ')}
          >
            <Text style={[styles.numberText, hero.kind !== 'minutes' && styles.numberWord]}>
              {hero.text}
            </Text>
            {source && (liveMark || source === 'scheduled') ? (
              <View style={styles.mark}>
                <SourceMark source={source} size={source === 'scheduled' ? 13 : 11} />
              </View>
            ) : null}
            {hero.unit ? <Text style={styles.unit}>{hero.unit}</Text> : null}
          </View>
        ) : null}
        {stopsAhead != null ? (
          <View style={styles.rail}>
            <PeekRail stopsAhead={stopsAhead} source={source ?? 'live'} end={railEnd} />
          </View>
        ) : aside && !asideBelow ? (
          <Text style={[styles.aside, !hero && styles.asideAlone]} numberOfLines={1}>
            {aside}
          </Text>
        ) : (
          <View style={styles.rail} />
        )}
        {accessory}
      </View>
      <View style={styles.bottom}>
        {action ??
          (asideBelow ? (
            <Text style={styles.asideBelow} numberOfLines={1}>
              {aside}
            </Text>
          ) : (
            <View />
          ))}
        {trailing ? (
          <View
            style={styles.trailing}
            accessible
            accessibilityLabel={[trailing.label, trailing.value].filter(Boolean).join(' ')}
          >
            {trailing.label ? (
              <Text style={styles.trailingLabel} numberOfLines={1}>
                {trailing.label}
              </Text>
            ) : null}
            <Text style={styles.trailingValue} numberOfLines={1}>
              {trailing.value}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A compact native Liquid Glass capsule with an ink label. */
export function GlassAction({
  icon,
  label,
  onPress,
  hint,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  hint?: string;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Host matchContents>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          controlSize('regular'),
          tint(pick(hex.ink, scheme)),
          ...(hint ? [accessibilityHint(hint)] : []),
        ]}
      >
        <HStack spacing={6}>
          <SwiftImage systemName={icon} size={14} />
          <SwiftText modifiers={[font({ size: 15, weight: 'semibold' }), monospacedDigit()]}>
            {label}
          </SwiftText>
        </HStack>
      </Button>
    </Host>
  );
}

/** Orange text with a triangle: a warning with nothing to tap. */
export function PeekWarning({
  text,
  accessibilityLabel,
}: {
  text: string;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.warning} accessible accessibilityLabel={accessibilityLabel ?? text}>
      <SymbolView name="exclamationmark.triangle.fill" size={14} tintColor={color.warning} />
      <Text style={styles.warningText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** The trip's next action (follow, leave now, walking) for the peek. */
export function TripPeekAction({
  action,
  walkMinutes,
  onFollow,
  onUnfollow,
  onStartWalking,
  onCancelWalking,
}: {
  action: TripAction;
  walkMinutes: number;
  onFollow: () => void;
  onUnfollow: () => void;
  onStartWalking: () => void;
  onCancelWalking: () => void;
}) {
  switch (action.kind) {
    case 'none':
      return null;
    case 'tight':
      return (
        <PeekWarning
          text="Too soon to make it"
          accessibilityLabel={`This bus arrives before your ${walkMinutes}-min walk`}
        />
      );
    case 'follow':
      return (
        <GlassAction
          icon={action.following ? 'bell.fill' : 'bell'}
          label={`Leave in ${mins(action.leaveInMinutes)}`}
          onPress={action.following ? onUnfollow : onFollow}
          hint={
            action.following
              ? 'Stops following this bus on your Lock Screen'
              : `Follows this bus on your Lock Screen. Your walk is ${mins(walkMinutes)}.`
          }
        />
      );
    case 'leave-now':
      return (
        <GlassAction
          icon="figure.walk"
          label="Leave now"
          onPress={onStartWalking}
          hint={`Starts a ${walkMinutes}-min walk timer`}
        />
      );
    case 'walking':
      return (
        <GlassAction
          icon="figure.walk"
          label={`Walking · ${formatCountdown(action.remainingSeconds)}`}
          onPress={onCancelWalking}
          hint="Cancels the walk timer"
        />
      );
  }
}

const styles = StyleSheet.create({
  card: {
    height: PEEK_CARD_HEIGHT,
    justifyContent: 'space-between',
    paddingBottom: space.xxs,
  },
  top: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  number: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  numberText: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '200',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  numberWord: {
    fontSize: 28,
    fontWeight: '300',
  },
  unit: {
    fontSize: 15,
    color: color.secondaryLabel,
  },
  // The source mark rides at cap height right after the digits, like the
  // hero's live dot.
  mark: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginLeft: -1,
  },
  rail: {
    flex: 1,
  },
  aside: {
    flex: 1,
    fontSize: 15,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  asideBelow: {
    flexShrink: 1,
    fontSize: 15,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  asideAlone: {
    fontSize: 17,
    color: color.label,
    textAlign: 'left',
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  warningText: {
    fontSize: 15,
    fontWeight: '600',
    color: color.warning,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    flexShrink: 1,
  },
  trailingLabel: {
    fontSize: 15,
    color: color.secondaryLabel,
  },
  trailingValue: {
    fontSize: 15,
    fontWeight: '500',
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
});
