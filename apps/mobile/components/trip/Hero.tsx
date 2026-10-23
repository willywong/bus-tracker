import { HStack, Host, Image as SwiftImage, Text as SwiftText } from '@expo/ui/swift-ui';
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
  offset,
  symbolEffect,
} from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import MaskedViewNative from '@react-native-masked-view/masked-view';
import type { ComponentType, ReactElement } from 'react';
import { StyleSheet, Text, useColorScheme, View, type ViewProps } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import type { HeroValue, SourceKind, TripModel } from '@/components/trip/model';
import { useSheetBodyHidden } from '@/components/trip/SheetBody';
import { color, CSS_EASE_OUT, hex, pick, type } from '@/theme/design';

/**
 * The one number: thin, very large, tabular, in full ink whether live or
 * scheduled (contrast first). Live vs scheduled is told by the status line's
 * glyph and word, never by greying the number. Rendered natively so digit
 * changes use SwiftUI's `numericText` roll.
 */
export function Hero({ model }: { model: TripModel }) {
  // On the trip sheet the live dot lives in the status capsule in the
  // header, with the warnings, so the number stands alone.
  return (
    <HeroNumber
      hero={model.hero}
      source={model.source}
      mark={false}
      eyebrow={model.heroEyebrow}
      accessibilityLabel={model.accessibilityLabel}
    />
  );
}

/** The hero number on its own, for the trip and the detail sheets. */
export function HeroNumber({
  hero,
  source,
  eyebrow = null,
  mark = true,
  accessibilityLabel: a11y,
}: {
  hero: HeroValue | null;
  source: SourceKind;
  eyebrow?: string | null;
  /** The live dot at cap height; off where a status capsule carries it. */
  mark?: boolean;
  accessibilityLabel: string;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  if (!hero) return null;
  const isWord = hero.kind === 'word';
  // "Arriving" gets a slow light sweep across the letters: the bus is about
  // to pull in. Off under Reduce Motion, where it's the plain word.
  if (hero.text === 'Arriving' && !reduceMotion) {
    return (
      <View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <ShimmerWord
          text={hero.text}
          source={mark ? source : 'scheduled'}
          scheme={scheme}
          accessibilityLabel={a11y}
        />
      </View>
    );
  }

  return (
    <View>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Host matchContents>
        <HStack
          spacing={8}
          alignment="firstTextBaseline"
          modifiers={[accessibilityLabel(a11y)]}
        >
          <SwiftText
            modifiers={[
              font({ size: isWord ? WORD_SIZE : type.hero.fontSize, weight: 'thin' }),
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
          {mark && source !== 'scheduled' ? (
            // Transit-style: the live signal rides on the number itself, raised
            // to cap height. Fresh data breathes; ageing data holds still in
            // orange. SwiftUI's symbol effects honour Reduce Motion.
            <SwiftImage
              systemName="circle.fill"
              size={11}
              color={pick(source === 'live' ? hex.live : hex.warning, scheme)}
              modifiers={[
                offset({ y: -(isWord ? WORD_SIZE * 0.6 : type.hero.fontSize * 0.6) }),
                ...(source === 'live'
                  ? [symbolEffect({ effect: 'breathe', style: 'pulse' })]
                  : []),
              ]}
            />
          ) : null}
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

/**
 * The hero and one quiet line under it: "Arrives 10:52 AM · 3 min late"
 * while live (the live dot is in the status capsule in the header). Freshness
 * only shows once it's a problem ("Updated 3 min ago", orange); fresh data
 * needs no timestamp. Scheduled leads with the word "Scheduled" and its
 * reason, so the two are never confused. At the end of a row (beside the 3D
 * bus) it aligns right and stacks the line's parts, one per line.
 */
export function HeroBlock({
  model,
  align = 'start',
}: {
  model: TripModel;
  align?: 'start' | 'end';
}) {
  const { label, note, updated, arrives } = model.sourceLine;
  const source = model.source;
  // Live needs no word: its dot is in the status capsule. Ageing leads with
  // its age, scheduled with "Scheduled".
  const lead = source === 'aging' && updated ? updated : source === 'live' ? null : label;
  const rest = [arrives, note].filter(Boolean) as string[];
  if (model.facts.length === 0 && model.detail) rest.push(model.detail);
  const end = align === 'end';
  return (
    <View style={[styles.block, end && styles.blockEnd]}>
      <Hero model={model} />
      <StatusLine
        source={source}
        lead={lead}
        rest={rest}
        stacked={end}
        accessibilityLabel={[label, arrives, note, updated].filter(Boolean).join(', ')}
      />
    </View>
  );
}

/**
 * "Live · Arrives 10:52 AM · 3 min late": the lead word coloured by source
 * (green live, orange ageing, ink otherwise), the rest quiet, dot-separated.
 */
export function StatusLine({
  source,
  lead,
  rest,
  stacked = false,
  accessibilityLabel: a11y,
}: {
  source: SourceKind | null;
  /** Coloured first word; null starts straight on the quiet parts. */
  lead: string | null;
  rest: string[];
  /** One part per line, right-aligned, in place of the dots. */
  stacked?: boolean;
  accessibilityLabel?: string;
}) {
  const sep = stacked ? '\n' : '  ·  ';
  return (
    <Text
      style={[styles.line, stacked && styles.lineStacked]}
      numberOfLines={stacked ? 3 : 2}
      accessibilityLabel={a11y}
    >
      {lead ? (
        <Text
          style={[
            styles.lead,
            source === 'live' && styles.leadLive,
            source === 'aging' && styles.leadAging,
          ]}
        >
          {lead}
        </Text>
      ) : null}
      {rest.map((part, i) => (
        <Text key={part}>
          {lead || i > 0 ? <Text style={styles.sep}>{sep}</Text> : null}
          {part}
        </Text>
      ))}
    </Text>
  );
}

/**
 * Live: a green dot with a slow pulse, the same green dot your bus wears on
 * the map. The pulse means the data is fresh; ageing data stops pulsing and
 * turns orange. Scheduled: a clock outline. Each always sits beside its
 * word. Reduce Motion keeps the dot still.
 */
export function SourceMark({ source, size = 13 }: { source: SourceKind; size?: number }) {
  const reduceMotion = useReducedMotion();
  if (source === 'scheduled') {
    return (
      <SymbolView
        name="clock"
        size={size}
        weight="regular"
        tintColor={color.secondaryLabel}
        accessibilityLabel="Scheduled"
      />
    );
  }
  const live = source === 'live';
  const dot = Math.round(size * 0.62);
  const tint = live ? color.live : color.warning;
  const dotStyle = { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: tint };
  return (
    <View
      style={[styles.markBox, { width: size, height: size }]}
      accessible
      accessibilityLabel={live ? 'Live' : 'Live data is out of date'}
    >
      {live && !reduceMotion ? (
        <Animated.View style={[styles.pulse, dotStyle, PULSE]} />
      ) : null}
      <View style={dotStyle} />
    </View>
  );
}

const PULSE_KEYFRAMES = {
  from: { opacity: 0.55, transform: [{ scale: 1 }] },
  to: { opacity: 0, transform: [{ scale: 2.8 }] },
};

/** One soft ring every two seconds: alive, not urgent. */
const PULSE = {
  animationName: PULSE_KEYFRAMES,
  animationDuration: 2000,
  animationIterationCount: 'infinite',
  animationTimingFunction: CSS_EASE_OUT,
} as const;

/**
 * The hero word with a soft light band sweeping across its letters, then a
 * rest. Drawn in React Native so the band can be masked to the glyphs: the
 * text is the mask, ink fills it, and the band slides through on the UI
 * thread (a Reanimated CSS animation). The live dot sits at cap height as
 * in HeroNumber.
 */
function ShimmerWord({
  text,
  source,
  scheme,
  accessibilityLabel: a11y,
}: {
  text: string;
  source: SourceKind;
  scheme: 'light' | 'dark';
  accessibilityLabel: string;
}) {
  const ink = pick(hex.ink, scheme);
  const light = pick(SHIMMER_LIGHT, scheme);
  // Hidden at peek: hold the band off-word instead of sweeping unseen.
  const hidden = useSheetBodyHidden();
  return (
    <View style={styles.wordRow} accessible accessibilityLabel={a11y}>
      <MaskedView maskElement={<Text style={styles.word}>{text}</Text>}>
        <Text style={[styles.word, { color: ink }]}>{text}</Text>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundImage: `linear-gradient(90deg, ${light}00 20%, ${light} 50%, ${light}00 80%)`,
            },
            hidden ? REST : SWEEP,
          ]}
        />
      </MaskedView>
      {source !== 'scheduled' ? (
        <Host matchContents style={styles.wordDot}>
          <SwiftImage
            systemName="circle.fill"
            size={11}
            color={pick(source === 'live' ? hex.live : hex.warning, scheme)}
            modifiers={
              source === 'live' ? [symbolEffect({ effect: 'breathe', style: 'pulse' })] : []
            }
          />
        </Host>
      ) : null}
    </View>
  );
}

// The package's class typings predate React 19's JSX types; it's a plain view.
const MaskedView = MaskedViewNative as unknown as ComponentType<
  ViewProps & { maskElement: ReactElement }
>;

/** "Arriving", "Due": a step below the hero number, which stays the loudest thing. */
const WORD_SIZE = 48;

/** The highlight: well lighter than ink, so the sweep reads as light, not a colour. */
const SHIMMER_LIGHT = { light: '#C7C7CC', dark: '#5C5C62' };

/** The band crosses the word in ~1.5s, then rests ~0.9s before the next pass. */
const SWEEP_KEYFRAMES = {
  '0%': { transform: [{ translateX: '-100%' }] },
  '62%': { transform: [{ translateX: '100%' }] },
  '100%': { transform: [{ translateX: '100%' }] },
};
const SWEEP = {
  animationName: SWEEP_KEYFRAMES,
  animationDuration: 2400,
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as const;

const REST = { transform: [{ translateX: '-100%' }] } as const;

/** Stable numeric key so SwiftUI animates only when the text changes. */
export function hashText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const styles = StyleSheet.create({
  markBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
  },
  block: {
    gap: 2,
  },
  blockEnd: {
    alignItems: 'flex-end',
  },
  line: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  lineStacked: {
    textAlign: 'right',
  },
  lead: {
    fontWeight: '600',
    color: color.label,
  },
  leadLive: {
    color: color.live,
  },
  leadAging: {
    color: color.warning,
  },
  sep: {
    color: color.tertiaryLabel,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  // Matches the SwiftUI hero word: 64pt thin.
  word: {
    fontSize: WORD_SIZE,
    lineHeight: Math.round(WORD_SIZE * 1.2),
    fontWeight: '200',
    color: '#000',
  },
  wordDot: {
    marginTop: Math.round(WORD_SIZE * 0.28),
  },
  eyebrow: {
    ...type.status,
    color: color.secondaryLabel,
  },
});
