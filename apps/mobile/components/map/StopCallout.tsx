import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import type { ScheduledDeparture } from '@/db/queries';
import { formatClockHHMM } from '@/components/tracker/logic';
import type { UseEtaResult } from '@/hooks/useEta';

import { formatStopName } from './format';

interface StopCalloutProps {
  stopName: string;
  eta: UseEtaResult;
  schedule?: readonly ScheduledDeparture[];
}

export function StopCallout({ stopName, eta, schedule }: StopCalloutProps) {
  const title = formatStopName(stopName);
  const scheduleList = (schedule ?? []).slice(0, 3);
  const min = eta.minutesToStop;
  const meters = eta.current?.forwardMeters ?? null;
  const hasLive = min != null;
  const isArrived = eta.arrivalStatus === 'arrived';
  const isArriving = eta.arrivalStatus === 'arriving';

  const primary = isArrived
    ? { value: 'Now', unit: '', label: 'Arrived', tone: 'arrived' as const }
    : isArriving
      ? { value: 'Soon', unit: '', label: 'Arriving', tone: 'arriving' as const }
      : {
          value: min === 0 ? 'Now' : `${min}`,
          unit: min === 0 ? '' : 'min',
          label: eta.isStale ? 'Last seen' : 'Arriving',
          tone: (eta.isStale ? 'stale' : 'normal') as 'stale' | 'normal',
        };

  return (
    <Callout tooltip>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>

          {hasLive ? (
            <View style={styles.stats}>
              <Stat
                value={primary.value}
                unit={primary.unit}
                label={primary.label}
                stale={primary.tone === 'stale'}
                tone={primary.tone}
              />
              {meters != null ? (
                <>
                  <View style={styles.statDivider} />
                  <Stat
                    value={distanceValue(meters)}
                    unit={distanceUnit(meters)}
                    label="Away"
                    stale={eta.isStale}
                  />
                </>
              ) : null}
            </View>
          ) : (
            <View style={styles.statsEmpty}>
              <Text style={styles.emptyText}>Waiting for live ETA…</Text>
            </View>
          )}

          {scheduleList.length > 0 ? (
            <View style={styles.scheduleBlock}>
              <Text style={styles.scheduleLabel}>Scheduled</Text>
              <View style={styles.scheduleTimes}>
                {scheduleList.map((d) => (
                  <Text
                    key={`${d.tripId}-${d.stopSequence}`}
                    style={styles.scheduleClock}
                  >
                    {formatClockHHMM(d.departureEpochMs)}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.tail} />
      </View>
    </Callout>
  );
}

function Stat({
  value,
  unit,
  label,
  stale,
  tone,
}: {
  value: string;
  unit: string;
  label: string;
  stale?: boolean;
  tone?: 'arrived' | 'arriving' | 'stale' | 'normal';
}) {
  const toneStyle =
    tone === 'arrived'
      ? styles.statValueArrived
      : tone === 'arriving'
        ? styles.statValueArriving
        : null;
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <Text
          style={[
            styles.statValue,
            stale ? styles.statDim : null,
            toneStyle,
          ]}
          allowFontScaling={false}
        >
          {value}
        </Text>
        {unit ? (
          <Text style={[styles.statUnit, stale ? styles.statDim : null]}>
            {unit}
          </Text>
        ) : null}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function distanceValue(meters: number): string {
  if (meters < 950) {
    return `${Math.max(0, Math.round(meters / 10) * 10)}`;
  }
  const km = meters / 1000;
  return km >= 10 ? km.toFixed(0) : km.toFixed(1);
}

function distanceUnit(meters: number): string {
  return meters < 950 ? 'm' : 'km';
}

const CARD_BG = '#FFFFFF';
const HAIRLINE = '#E5E5EA';

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  card: {
    backgroundColor: CARD_BG,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    minWidth: 240,
    maxWidth: 280,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.1,
    marginBottom: 12,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 6,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6E6E73',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    marginVertical: 4,
  },
  statDim: {
    color: '#9A9AA2',
  },
  statValueArrived: {
    color: '#30D158',
  },
  statValueArriving: {
    color: '#FF9F0A',
  },
  statsEmpty: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  scheduleBlock: {
    marginTop: 10,
    gap: 4,
  },
  scheduleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scheduleTimes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 2,
  },
  scheduleClock: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CARD_BG,
    marginTop: -1,
  },
});
