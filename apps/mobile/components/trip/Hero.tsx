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

import type { SourceKind, TripModel } from '@/components/trip/model';
import { color, space, type } from '@/theme/design';

/**
 * The one number: thin, very large, tabular, in full ink whether live or
 * scheduled (contrast first). Live vs scheduled is told by the status line's
 * glyph and word, never by greying the number. Rendered natively so digit
 * changes use SwiftUI's `numericText` roll.
 */
export function Hero({ model }: { model: TripModel }) {
  const hero = model.hero;
  if (!hero) return null;
  const isWord = hero.kind === 'word';

  return (
    <View>
      {model.heroEyebrow ? <Text style={styles.eyebrow}>{model.heroEyebrow}</Text> : null}
      <Host matchContents>
        <HStack
          spacing={8}
          alignment="firstTextBaseline"
          modifiers={[accessibilityLabel(model.accessibilityLabel)]}
        >
          <SwiftText
            modifiers={[
              font({ size: isWord ? 64 : type.hero.fontSize, weight: 'thin' }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.5),
              foregroundStyle({ type: 'hierarchical', style: 'primary' }),
              contentTransition('numericText', { countsDown: true }),
              animation(Animation.smooth({ duration: 0.35 }), hashText(hero.text)),
            ]}
          >
            {hero.text}
          </SwiftText>
          {hero.unit ? (
            <SwiftText
              modifiers={[
                font({ size: type.heroUnit.fontSize, weight: 'regular' }),
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

/** Glyph + word for where the number comes from, and how fresh it is. */
export function StatusLine({ model }: { model: TripModel }) {
  return (
    <View style={styles.statusBlock}>
      <View style={styles.statusRow}>
        <SourceMark source={model.source} />
        <Text style={styles.status} numberOfLines={2}>
          {model.status}
        </Text>
        {model.freshness ? (
          <Text style={styles.freshness} accessibilityLabel={`updated ${model.freshness}`}>
            {model.freshness}
          </Text>
        ) : null}
      </View>
      {model.detail ? <Text style={styles.detail}>{model.detail}</Text> : null}
    </View>
  );
}

/**
 * Live: a green dot (the app's only colour). Ageing: an orange dot.
 * Scheduled: a clock outline. Each always sits beside its word.
 */
export function SourceMark({ source, size = 8 }: { source: SourceKind; size?: number }) {
  if (source === 'scheduled') {
    return (
      <SymbolView
        name="clock"
        size={size + 6}
        weight="regular"
        tintColor={color.secondaryLabel}
        accessibilityLabel="Scheduled"
      />
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={source === 'live' ? 'Live' : 'Live data is out of date'}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: source === 'live' ? color.live : color.warning,
      }}
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
  eyebrow: {
    ...type.status,
    color: color.secondaryLabel,
  },
  statusBlock: {
    gap: space.xxs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  status: {
    ...type.status,
    flex: 1,
    color: color.label,
  },
  freshness: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  detail: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
