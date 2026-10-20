import {
  formatWalkingDistance,
  nearbyRailStations,
  walkingMinutes,
  type LatLng,
} from '@bus-tracker/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '@/theme/design';

/**
 * LRT / MRT / Monorail / BRT stations within a short walk of the user's
 * stop, with official line colours. Straight-line distance; the walk time
 * is a rough guide, so it's labelled "about".
 */
export function Connections({ stop }: { stop: LatLng }) {
  const nearby = useMemo(() => nearbyRailStations(stop), [stop]);
  if (nearby.length === 0) return null;
  return (
    <View style={styles.group}>
      {nearby.map(({ station, distanceMeters }, i) => (
        <View
          key={station.id}
          style={[styles.row, i > 0 && styles.divider]}
          accessible
          accessibilityLabel={`${station.name}, ${station.lines
            .map((l) => l.name)
            .join(', ')}, ${formatWalkingDistance(distanceMeters)}, about ${walkingMinutes(
            distanceMeters,
          )} minute walk`}
        >
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {station.name}
            </Text>
            <View style={styles.lines}>
              {station.lines.map((l) => (
                <View key={l.code} style={[styles.badge, { backgroundColor: l.color }]}>
                  <Text style={[styles.badgeText, { color: l.textColor }]}>{l.code}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.distance}>
            <Text style={styles.meters}>{formatWalkingDistance(distanceMeters)}</Text>
            <Text style={styles.walk}>~{walkingMinutes(distanceMeters)} min walk</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.group,
    borderCurve: 'continuous',
    backgroundColor: color.fill,
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.separator,
  },
  text: {
    flex: 1,
    gap: space.xxs,
  },
  name: {
    ...type.body,
    color: color.label,
  },
  lines: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xxs,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    ...type.caption,
    fontWeight: '700',
  },
  distance: {
    alignItems: 'flex-end',
  },
  meters: {
    ...type.status,
    color: color.label,
    fontVariant: ['tabular-nums'],
  },
  walk: {
    ...type.footnote,
    color: color.secondaryLabel,
  },
});
