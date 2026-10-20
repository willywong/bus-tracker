import { HStack, Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  animation,
  Animation,
  contentTransition,
  font,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { SourceKind, TripModel } from '@/components/trip/model';
import { color, space, type } from '@/theme/design';

/**
 * The one primary number. Rendered natively so digit changes use SwiftUI's
 * `numericText` roll; live is bold label colour, scheduled is regular and
 * secondary so the two can never be confused (weight + glyph + word).
 */
export function Hero({ model }: { model: TripModel }) {
  const hero = model.hero;
  if (!hero) return null;
  const isLive = model.source !== 'scheduled';
  const isWord = hero.kind === 'word';

  return (
    <View style={styles.wrap}>
      {model.heroEyebrow ? (
        <Text style={styles.eyebrow}>{model.heroEyebrow}</Text>
      ) : null}
      <Host matchContents>
        <HStack
          spacing={6}
          alignment="firstTextBaseline"
          modifiers={[accessibilityLabel(model.accessibilityLabel)]}
        >
          <SwiftText
            modifiers={[
              font({
                size: isWord ? 56 : type.hero.fontSize,
                weight: isLive ? 'bold' : 'regular',
                design: 'rounded',
              }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.5),
              foregroundStyle(
                isLive
                  ? { type: 'hierarchical', style: 'primary' }
                  : { type: 'hierarchical', style: 'secondary' },
              ),
              contentTransition('numericText', { countsDown: true }),
              animation(Animation.smooth({ duration: 0.35 }), hashText(hero.text)),
            ]}
          >
            {hero.text}
          </SwiftText>
          {hero.unit ? (
            <SwiftText
              modifiers={[
                font({ size: type.heroUnit.fontSize, weight: 'semibold', design: 'rounded' }),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              {hero.unit}
            </SwiftText>
          ) : null}
        </HStack>
      </Host>
    </View>
  );
}

/** Live / ageing / scheduled glyph + copy. Never colour alone. */
export function StatusLine({ model }: { model: TripModel }) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.statusBlock}>
      <View style={styles.statusRow}>
        <SourceGlyph source={model.source} animate={!reduceMotion} />
        <Text
          style={[
            styles.status,
            model.source === 'live' && styles.statusLive,
            model.source === 'aging' && styles.statusAging,
          ]}
          numberOfLines={2}
        >
          {model.status}
        </Text>
      </View>
      {model.detail ? <Text style={styles.detail}>{model.detail}</Text> : null}
      {model.then ? (
        <Text style={styles.then} accessibilityLabel={model.then.replace('·', 'and')}>
          {model.then}
        </Text>
      ) : null}
    </View>
  );
}

export function SourceGlyph({
  source,
  animate,
  size = 15,
}: {
  source: SourceKind;
  animate: boolean;
  size?: number;
}) {
  if (source === 'live') {
    return (
      <SymbolView
        name="dot.radiowaves.left.and.right"
        size={size}
        weight="semibold"
        tintColor={color.live}
        animationSpec={
          animate
            ? {
                repeating: true,
                speed: 0.6,
                variableAnimationSpec: { iterative: true, dimInactiveLayers: true },
              }
            : undefined
        }
        accessibilityLabel="Live"
      />
    );
  }
  if (source === 'aging') {
    return (
      <SymbolView
        name="clock.badge.exclamationmark"
        size={size}
        weight="semibold"
        type="hierarchical"
        tintColor={color.warning}
        accessibilityLabel="Live data is out of date"
      />
    );
  }
  return (
    <SymbolView
      name="clock"
      size={size}
      weight="medium"
      tintColor={color.secondaryLabel}
      accessibilityLabel="Scheduled"
    />
  );
}

/** Stable numeric key so SwiftUI animates only when the text changes. */
function hashText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const styles = StyleSheet.create({
  wrap: {
    gap: 0,
  },
  eyebrow: {
    ...type.headline,
    color: color.secondaryLabel,
  },
  statusBlock: {
    gap: space.xxs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: {
    ...type.status,
    color: color.secondaryLabel,
    flexShrink: 1,
  },
  statusLive: {
    color: color.label,
    fontWeight: '500',
  },
  statusAging: {
    color: color.warning,
    fontWeight: '500',
  },
  detail: {
    ...type.status,
    color: color.secondaryLabel,
  },
  then: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
