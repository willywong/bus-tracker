import type { ScheduleDelay, VehiclePosition } from '@bus-tracker/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import {
  formatClockHHMM,
  formatDelayLabel,
  formatVehicleObservedAge,
  type DelayTone,
} from '@/components/tracker/logic';

import { bearingToCardinal } from './format';

interface BusCalloutProps {
  position: VehiclePosition;
  scheduledArrival?: {
    /** Epoch ms of the scheduled departure at the user's stop. */
    at: number;
    delay: ScheduleDelay | null;
  } | null;
}

export function BusCallout({ position, scheduledArrival }: BusCalloutProps) {
  // VehiclePosition.speed is already km/h (Prasarana feed quirk — see the
  // type definition).
  const speedKmh =
    position.speed != null && Number.isFinite(position.speed)
      ? Math.round(position.speed)
      : null;
  const heading = bearingToCardinal(position.bearing);
  const hasTelemetry = speedKmh != null || heading != null;

  const ageLabel = formatVehicleObservedAge(position.observedAt, Date.now());
  const schedClock = scheduledArrival
    ? formatClockHHMM(scheduledArrival.at)
    : null;
  const delayLabel = scheduledArrival
    ? formatDelayLabel(scheduledArrival.delay)
    : null;

  return (
    <Callout tooltip>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.routePill}>
              <Text style={styles.routeText} numberOfLines={1}>
                {position.routeId}
              </Text>
            </View>
            <Text style={styles.vehicleId} numberOfLines={1}>
              {position.vehicleId}
            </Text>
          </View>

          {hasTelemetry ? (
            <View style={styles.stats}>
              {speedKmh != null ? (
                <Stat value={`${speedKmh}`} unit="km/h" label="Speed" />
              ) : null}
              {speedKmh != null && heading != null ? (
                <View style={styles.statDivider} />
              ) : null}
              {heading != null ? (
                <Stat value={heading} unit="" label="Heading" />
              ) : null}
            </View>
          ) : (
            <View style={styles.statsEmpty}>
              <Text style={styles.emptyText}>No GPS telemetry</Text>
            </View>
          )}

          {schedClock ? (
            <View style={styles.scheduleBlock}>
              <Text style={styles.scheduleLine} selectable numberOfLines={1}>
                <Text style={styles.scheduleLabel}>Scheduled </Text>
                <Text style={styles.scheduleClock}>{schedClock}</Text>
              </Text>
              {delayLabel ? (
                <Text
                  style={[
                    styles.delayText,
                    { color: DELAY_COLORS[delayLabel.tone] },
                  ]}
                  selectable
                  numberOfLines={1}
                >
                  {delayLabel.text}
                </Text>
              ) : null}
            </View>
          ) : null}

          {ageLabel ? (
            <Text style={styles.footer} numberOfLines={1}>
              Reported {ageLabel}
            </Text>
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
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue} allowFontScaling={false}>
          {value}
        </Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const CARD_BG = '#FFFFFF';
const HAIRLINE = '#E5E5EA';
const ROUTE_PILL_FG = '#1D8A3F';
const ROUTE_PILL_BG = 'rgba(48, 209, 88, 0.14)';

// Callout is hardcoded light; use solid delay tones that read well on white.
const DELAY_COLORS: Record<DelayTone, string> = {
  'on-time': '#1D8A3F',
  late: '#B76C0A',
  early: '#0A5FB3',
};

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  routePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: ROUTE_PILL_BG,
  },
  routeText: {
    fontSize: 13,
    fontWeight: '700',
    color: ROUTE_PILL_FG,
    letterSpacing: 0.3,
  },
  vehicleId: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 12,
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
  statsEmpty: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  scheduleBlock: {
    gap: 2,
    marginBottom: 8,
  },
  scheduleLine: {
    fontSize: 13,
  },
  scheduleLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    letterSpacing: 0.1,
  },
  scheduleClock: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
    fontVariant: ['tabular-nums'],
  },
  delayText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8E8E93',
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
