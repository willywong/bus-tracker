import type { VehiclePosition } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { formatArrivalClock } from '@/components/map/format';
import { formatClockHHMM } from '@/components/tracker/logic';
import { sourceColor, trackerSpacing } from '@/components/tracker/tokens';
import type { ArrivalEntry } from '@/hooks/useEta';

interface NextBusRowProps {
  entry: ArrivalEntry;
  /** Live vehicle telemetry when entry.kind === "live". */
  livePosition?: Pick<VehiclePosition, 'speed'> | undefined;
}

export function NextBusRow({ entry, livePosition }: NextBusRowProps) {
  const isLive = entry.kind === 'live' && entry.live != null;
  const minutes = Math.max(0, Math.round((entry.epochMs - Date.now()) / 60_000));

  const caption = (() => {
    if (isLive) {
      const clock =
        entry.live?.minutesToStop != null
          ? formatArrivalClock(entry.live.minutesToStop)
          : formatClockHHMM(entry.epochMs);
      const parts: string[] = [];
      if (clock) parts.push(`Arrives ${clock}`);
      if (livePosition?.speed != null && Number.isFinite(livePosition.speed)) {
        parts.push(`${Math.round(livePosition.speed)} km/h`);
      }
      return parts.join(' · ');
    }
    return `Scheduled ${formatClockHHMM(entry.epochMs)}`;
  })();

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Next. ${caption}. ${formatDuration(minutes)}.`}
    >
      <Text style={styles.label} selectable>
        Next
      </Text>
      <View style={styles.captionWrap}>
        {!isLive ? (
          <SymbolView
            name="clock.fill"
            size={10}
            tintColor={sourceColor.scheduled}
            weight="semibold"
          />
        ) : null}
        <Text style={styles.captionText} selectable numberOfLines={1}>
          {caption}
        </Text>
      </View>
      <Text style={styles.value} selectable allowFontScaling={false}>
        {formatDuration(minutes)}
      </Text>
    </View>
  );
}

function formatDuration(totalMin: number): string {
  if (totalMin < 1) return 'now';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: trackerSpacing.rowH,
    paddingVertical: 10,
    minHeight: 44,
    gap: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: PlatformColor('label'),
  },
  captionWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  captionText: {
    fontSize: 12,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: PlatformColor('label'),
    fontVariant: ['tabular-nums'],
  },
});
