import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import {
  railAlpha,
  type RailLineDraw,
  type RailStationDraw,
} from '@/components/map/railModel';

interface RailLayerProps {
  lines: RailLineDraw[];
  stations: RailStationDraw[];
  /** Route ids drawn at 100%; every other line drops to 15%. Null: no focus. */
  focus: readonly string[] | null;
  /** Zoomed out (below 11): lines at 35%. */
  dim: boolean;
  /** Zoom 12 and up: every station; below it, interchanges only. */
  showAllStations: boolean;
  /** Line casing and station square fill. */
  paper: string;
  /** Station square outline. */
  ink: string;
  onStationPress?: (stationId: string) => void;
}

/** Square height, and its width with one dot. */
const RAIL = 20;
/** Extra width per further dot, as `RouteLayer`'s squares. */
const RAIL_PER_DOT = 9;

/**
 * Every rail line in its official colour on a thin paper casing, and the
 * station squares (a dot per line colour) that open the station sheet.
 *
 * Apple Maps stacks overlays in the order they're added and ignores
 * `zIndex`, so the parent renders this before `RouteLayer` and remounts both
 * (by key) whenever the lines restyle: the bus route is always re-added on
 * top. Line props never change in place for the same reason.
 *
 * Station markers follow `RouteLayer`'s rules: a fixed-size frame with the
 * glyph centred and `collapsable={false}`, since Apple Maps ignores `anchor`.
 * They ignore Dynamic Type: map markers stay map-sized.
 */
export const RailLayer = memo(function RailLayer({
  lines,
  stations,
  focus,
  dim,
  showAllStations,
  paper,
  ink,
  onStationPress,
}: RailLayerProps) {
  return (
    <>
      {lines.map((line) => {
        const alpha = railAlpha(line.routeId, focus, dim);
        return [
          <Polyline
            key={`casing-${line.routeId}`}
            coordinates={line.coords}
            strokeColor={`${toHex6(paper)}${alpha}`}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />,
          <Polyline
            key={`line-${line.routeId}`}
            coordinates={line.coords}
            strokeColor={`${line.color}${alpha}`}
            strokeWidth={3}
            lineCap="round"
            lineJoin="round"
          />,
        ];
      })}
      {stations.map((s) => {
        if (!showAllStations && !s.interchange) return null;
        const dots = Math.max(1, s.colors.length);
        return (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            flat
            zIndex={0}
            displayPriority={s.interchange ? 'high' : 'low'}
            onPress={onStationPress ? () => onStationPress(s.id) : undefined}
            accessibilityLabel={s.label}
          >
            <View
              collapsable={false}
              style={[
                styles.square,
                {
                  width: RAIL + (dots - 1) * RAIL_PER_DOT,
                  borderColor: ink,
                  backgroundColor: paper,
                },
              ]}
            >
              {s.colors.map((c) => (
                <View key={c} style={[styles.dot, { backgroundColor: c }]} />
              ))}
            </View>
          </Marker>
        );
      })}
    </>
  );
});

/** Paper is "#RRGGBB" from the palette; anything else falls back to white. */
function toHex6(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#FFFFFF';
}

const styles = StyleSheet.create({
  square: {
    height: RAIL,
    borderRadius: 4,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
