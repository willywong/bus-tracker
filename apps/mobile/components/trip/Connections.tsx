import {
  formatWalkingDistance,
  nearbyRailStations,
  walkingMinutes,
  type LatLng,
} from '@bus-tracker/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Hairline } from '@/components/trip/Rows';
import { color, space, type } from '@/theme/design';

/**
 * LRT / MRT / Monorail / BRT stations within a short walk of your stop. The
 * line colours are the only colour on the sheet besides "live", because
 * they are how riders recognise lines. Straight-line distance, so the walk
 * time is marked as approximate.
 */
export function Connections({ stop }: { stop: LatLng }) {
  const nearby = useMemo(() => nearbyRailStations(stop), [stop]);
  if (nearby.length === 0) return null;
  return (
    <View>
      {nearby.map(({ station, distanceMeters }, i) => (
        <View key={station.id}>
          {i > 0 ? <Hairline /> : null}
          <View
            style={styles.row}
            accessible
            accessibilityLabel={`${station.name}, ${station.lines
              .map((l) => l.name)
              .join(', ')}, ${formatWalkingDistance(distanceMeters)}, about ${walkingMinutes(
              distanceMeters,
            )} minute walk`}
          >
            <View style={styles.lines}>
              {station.lines.map((l) => (
                <View key={l.code} style={[styles.lineDot, { backgroundColor: l.color }]} />
              ))}
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {station.name}
              </Text>
              <Text style={styles.codes} numberOfLines={1}>
                {station.lines.map((l) => l.code).join(' · ')}
              </Text>
            </View>
            <Text style={styles.distance}>
              {formatWalkingDistance(distanceMeters)} · ~{walkingMinutes(distanceMeters)} min
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  lines: {
    width: 16,
    gap: 3,
    alignItems: 'center',
  },
  lineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  name: {
    ...type.body,
    fontSize: 16,
    color: color.label,
  },
  codes: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
  distance: {
    ...type.status,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
});
