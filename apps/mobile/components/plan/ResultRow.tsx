import type { Itinerary } from '@bus-tracker/shared';
import { Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  contentTransition,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { formatClockHHMM } from '@/components/tracker/logic';
import { hashText, SourceMark } from '@/components/trip/Hero';
import { RowButton } from '@/components/ui/RowButton';
import { color, EASE_OUT, motion, space, type } from '@/theme/design';

import { JourneyBar } from './JourneyBar';
import { LegChips } from './LegChips';
import {
  durationLabel,
  journeySegments,
  leaveLabel,
  legChips,
  resultAccessibilityLabel,
  statusText,
  tagLabel,
  updatedNote,
  warningNote,
  type RouteInfo,
} from './results';

const CROSSFADE_IN = FadeIn.duration(motion.crossfade).easing(EASE_OUT).reduceMotion(ReduceMotion.Never);
const CROSSFADE_OUT = FadeOut.duration(motion.crossfade).easing(EASE_OUT).reduceMotion(ReduceMotion.Never);

/**
 * One itinerary in the results (spec §6.2), four lines:
 * 1. the leave time (20pt semibold, rolls with `numericText` when re-timed)
 *    and the trip length;
 * 2. the leg chips and the arrival clock;
 * 3. the proportional journey bar;
 * 4. Live or Scheduled (glyph and word), changes and walk, and the tag. For
 *    4 s after a retime moved it, that line reads "Updated · was 9:12".
 * A warning sits under it. 15/05 reuses this row as the itinerary's peek:
 * without `onPress` it's one plain VoiceOver element, not a button.
 */
export function ResultRow({
  it,
  now,
  routes,
  updated,
  onPress,
}: {
  it: Itinerary;
  now: number;
  routes: RouteInfo;
  /** `run.updatedIds.has(it.id)`. */
  updated: boolean;
  onPress?: () => void;
}) {
  const leave = leaveLabel(it, now, formatClockHHMM);
  const arrive = formatClockHHMM(it.arriveAt);
  const chips = useMemo(() => legChips(it, routes), [it, routes]);
  const segments = useMemo(() => journeySegments(it), [it]);
  const status = statusText(it);
  const tag = tagLabel(it);
  const note = updated ? updatedNote(it, formatClockHHMM) : null;
  const warning = warningNote(it);
  const missed = it.warnings.includes('missed-connection');

  const label = resultAccessibilityLabel(it, now, formatClockHHMM, routes);
  const content = (
    <>
      <View style={styles.line}>
        <Host matchContents>
          <SwiftText
            modifiers={[
              font({ size: 20, weight: 'semibold' }),
              monospacedDigit(),
              lineLimit(1),
              foregroundStyle({ type: 'hierarchical', style: 'primary' }),
              contentTransition('numericText', { countsDown: true }),
              animation(Animation.smooth({ duration: 0.35 }), hashText(leave)),
            ]}
          >
            {leave}
          </SwiftText>
        </Host>
        <Text style={styles.duration}>{durationLabel(it)}</Text>
      </View>

      <View style={[styles.line, styles.chipsLine]}>
        <LegChips chips={chips} />
        <Host matchContents>
          <SwiftText
            modifiers={[
              font({ size: type.status.fontSize }),
              monospacedDigit(),
              lineLimit(1),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              contentTransition('numericText'),
              animation(Animation.smooth({ duration: 0.35 }), hashText(arrive)),
            ]}
          >
            {arrive}
          </SwiftText>
        </Host>
      </View>

      <JourneyBar segments={segments} />

      <View style={styles.statusLine}>
        {note ? (
          <Animated.View key="updated" entering={CROSSFADE_IN} exiting={CROSSFADE_OUT} style={styles.statusLead}>
            <Text style={styles.status} numberOfLines={1}>
              {note}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View key="status" entering={CROSSFADE_IN} exiting={CROSSFADE_OUT} style={styles.statusLead}>
            <SourceMark source={status.live ? 'live' : 'scheduled'} size={12} />
            <Text style={styles.status} numberOfLines={1}>
              <Text style={styles.statusWord}>{status.live ? 'Live' : 'Scheduled'}</Text>
              {` · ${status.text}`}
            </Text>
          </Animated.View>
        )}
        {tag ? <Text style={styles.tag}>{tag}</Text> : null}
      </View>

      {warning ? <Text style={[styles.warning, missed && styles.warningUrgent]}>{warning}</Text> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <RowButton onPress={onPress} style={styles.row} accessibilityLabel={label} accessibilityHint="Shows the steps and the map">
      {content}
    </RowButton>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.sm,
    gap: 8,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  chipsLine: {
    alignItems: 'flex-start',
  },
  duration: {
    ...type.status,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: type.footnote.lineHeight,
  },
  statusLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  status: {
    ...type.footnote,
    color: color.secondaryLabel,
    flexShrink: 1,
  },
  statusWord: {
    color: color.label,
    fontWeight: '500',
  },
  tag: {
    ...type.footnote,
    fontWeight: '600',
    color: color.label,
  },
  warning: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  warningUrgent: {
    color: color.warning,
  },
});
