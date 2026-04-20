import type { VehiclePosition } from '@bus-tracker/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import { bearingToCardinal } from './format';

interface BusCalloutProps {
  position: VehiclePosition;
}

export function BusCallout({ position }: BusCalloutProps) {
  const speedKmh =
    position.speed != null && Number.isFinite(position.speed)
      ? Math.round(position.speed * 3.6)
      : null;
  const heading = bearingToCardinal(position.bearing);
  const hasTelemetry = speedKmh != null || heading != null;
  const updated = formatClock(position.observedAt);

  return (
    <Callout tooltip>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.route} numberOfLines={1}>
              {position.routeId}
            </Text>
            <Text style={styles.vehicle} numberOfLines={1}>
              Vehicle {position.vehicleId}
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

          <Text style={styles.footer}>Updated {updated}</Text>
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

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
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
  header: {
    gap: 2,
    marginBottom: 12,
  },
  route: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.2,
  },
  vehicle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
    fontVariant: ['tabular-nums'],
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 10,
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
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
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
