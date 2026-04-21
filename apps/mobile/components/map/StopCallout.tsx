import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import type { ScheduledDeparture } from '@/db/queries';
import { formatClockHHMM } from '@/components/tracker/logic';
import type { UseEtaResult } from '@/hooks/useEta';

import { formatDistance, formatStopName } from './format';

interface StopCalloutProps {
  stopName: string;
  eta: UseEtaResult;
  schedule?: readonly ScheduledDeparture[];
}

export function StopCallout({ stopName, eta, schedule }: StopCalloutProps) {
  const title = formatStopName(stopName);
  const { body, dimmed } = buildBody(eta);
  const scheduleList = (schedule ?? []).slice(0, 3);

  return (
    <Callout tooltip>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.body, dimmed ? styles.bodyDim : null]}
            numberOfLines={1}
          >
            {body}
          </Text>
          {scheduleList.length > 0 ? (
            <>
              <View style={styles.divider} />
              <View style={styles.scheduleRow}>
                <Text style={styles.scheduleLabel} numberOfLines={1}>
                  Scheduled
                </Text>
                <Text
                  style={styles.scheduleTimes}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {scheduleList
                    .map((d) => formatClockHHMM(d.departureEpochMs))
                    .join('  ')}
                </Text>
              </View>
            </>
          ) : null}
        </View>
        <View style={styles.tail} />
      </View>
    </Callout>
  );
}

function buildBody(eta: UseEtaResult): { body: string; dimmed: boolean } {
  if (eta.minutesToStop == null) {
    return { body: 'Waiting for live ETA…', dimmed: true };
  }
  const min = eta.minutesToStop;
  const distance =
    eta.current?.forwardMeters != null
      ? ` · ${formatDistance(eta.current.forwardMeters)} away`
      : '';
  if (eta.isStale) {
    return { body: `Last seen · ${min} min${distance}`, dimmed: true };
  }
  if (min <= 0) {
    return { body: `Arriving now${distance}`, dimmed: false };
  }
  return { body: `Arriving in ${min} min${distance}`, dimmed: false };
}

const CARD_BG = '#FFFFFF';

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  card: {
    backgroundColor: CARD_BG,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
    minWidth: 180,
    maxWidth: 280,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.22)',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.1,
  },
  body: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    color: '#6E6E73',
  },
  bodyDim: {
    color: '#9A9AA2',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginTop: 8,
    marginBottom: 6,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scheduleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scheduleTimes: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#3A3A3C',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
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
