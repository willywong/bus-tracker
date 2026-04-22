import type { VehiclePosition, ScheduleDelay } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import {
  bearingToCardinal,
  formatArrivalClock,
} from '@/components/map/format';
import type { ApproachingBus, ArrivalStatus } from '@/components/tracker/logic';
import {
  formatClockHHMM,
  formatDeltaMin,
} from '@/components/tracker/logic';
import { sourceColor, trackerSpacing } from '@/components/tracker/tokens';

interface ApproachingBusRowProps {
  /** "Current" (live present), "Next" (live present OR first schedule after current), etc. */
  label?: string;
  live: ApproachingBus | null;
  livePosition: Pick<VehiclePosition, 'speed' | 'bearing'> | undefined;
  /** Scheduled departure epoch ms. For the Current row this is the live trip's own scheduled slot. */
  scheduledAt: number | null;
  /** Delay vs schedule for the live trip (only meaningful when `live` is present). */
  delay: ScheduleDelay | null;
  isStale: boolean;
  /** Optional contextual proximity — flips the caption to "Arriving" / "Arrived" and the value to a word. */
  arrivalStatus?: ArrivalStatus;
}

export function ApproachingBusRow({
  label,
  live,
  livePosition,
  scheduledAt,
  delay,
  isStale,
  arrivalStatus,
}: ApproachingBusRowProps) {
  const hasLive = live?.minutesToStop != null;
  const resolvedLabel =
    label ?? (hasLive ? 'Current' : scheduledAt != null ? 'Next' : 'Buses');
  const value = formatValue(live, scheduledAt, arrivalStatus);
  const valueTone =
    arrivalStatus === 'arrived'
      ? styles.valueArrived
      : arrivalStatus === 'arriving'
        ? styles.valueArriving
        : null;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={a11yLabel(resolvedLabel, hasLive, live, scheduledAt, delay)}
    >
      <View style={styles.labelWrap}>
        <Text style={styles.label} selectable>
          {resolvedLabel}
        </Text>
        <View style={styles.captionRow}>
          {hasLive ? null : (
            <SymbolView
              name="clock.fill"
              size={10}
              tintColor={sourceColor.scheduled}
              weight="semibold"
            />
          )}
          <Text style={styles.captionText} selectable numberOfLines={2}>
            {buildCaption(hasLive, live, livePosition, scheduledAt, delay, isStale, arrivalStatus)}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.value, !hasLive && styles.valueMuted, valueTone]}
        selectable
        allowFontScaling={false}
      >
        {value}
      </Text>
    </View>
  );
}

function formatValue(
  live: ApproachingBus | null,
  scheduledAt: number | null,
  arrivalStatus: ArrivalStatus | undefined,
): string {
  if (arrivalStatus === 'arrived') return 'Now';
  if (arrivalStatus === 'arriving') return 'Soon';
  if (live?.minutesToStop != null) return `${live.minutesToStop} min`;
  if (scheduledAt != null) {
    const mins = Math.max(0, Math.round((scheduledAt - Date.now()) / 60_000));
    return `${mins} min`;
  }
  return '—';
}

function buildCaption(
  hasLive: boolean,
  live: ApproachingBus | null,
  pos: Pick<VehiclePosition, 'speed' | 'bearing'> | undefined,
  scheduledAt: number | null,
  delay: ScheduleDelay | null,
  isStale: boolean,
  arrivalStatus: ArrivalStatus | undefined,
): string {
  if (hasLive && live) {
    const parts: string[] = [];
    if (arrivalStatus === 'arrived') parts.push('At your stop');
    else if (arrivalStatus === 'arriving') parts.push('Arriving soon');
    else if (live.minutesToStop != null) {
      if (live.minutesToStop <= 0) parts.push('Arriving now');
      else {
        const clock = formatArrivalClock(live.minutesToStop);
        if (clock) parts.push(`Arrives ${clock}`);
      }
    }
    const delta = formatDeltaMin(delay);
    if (delta) parts.push(delta);
    else if (scheduledAt != null) {
      // Have a scheduled time but delay couldn't be computed (e.g. mismatch).
      parts.push(`scheduled ${formatClockHHMM(scheduledAt)}`);
    }
    if (pos?.speed != null && Number.isFinite(pos.speed)) {
      parts.push(`${Math.round(pos.speed)} km/h`);
    }
    const heading = bearingToCardinal(pos?.bearing);
    if (heading) parts.push(heading);
    if (isStale) parts.push('stale');
    return parts.join(' · ');
  }
  if (scheduledAt != null) {
    return `Scheduled ${formatClockHHMM(scheduledAt)}`;
  }
  return '';
}

function a11yLabel(
  label: string,
  hasLive: boolean,
  live: ApproachingBus | null,
  scheduledAt: number | null,
  delay: ScheduleDelay | null,
): string {
  const out: string[] = [`${label}.`];
  if (hasLive) out.push(`${live?.minutesToStop ?? 0} minutes.`);
  if (scheduledAt) {
    out.push(`Scheduled ${formatClockHHMM(scheduledAt)}.`);
    if (delay && hasLive) {
      const m = Math.round(delay.delayMinutes);
      out.push(
        delay.onTimeWindow === 'on-time'
          ? 'On time.'
          : m > 0
            ? `${m} minutes late.`
            : `${Math.abs(m)} minutes early.`,
      );
    }
  }
  return out.join(' ');
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: trackerSpacing.rowV,
    minHeight: 52,
    gap: 12,
  },
  labelWrap: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: PlatformColor('label'),
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  captionText: {
    fontSize: 12,
    color: PlatformColor('secondaryLabel'),
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
  valueMuted: {
    color: PlatformColor('secondaryLabel'),
  },
  valueArrived: {
    color: '#30D158',
  },
  valueArriving: {
    color: '#FF9F0A',
  },
});
