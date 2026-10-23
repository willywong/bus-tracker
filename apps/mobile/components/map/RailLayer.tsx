import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { LandmarkFrame } from '@/components/map/Landmark';
import {
  railAlpha,
  stationsInFocus,
  type RailLineDraw,
  type RailStationDraw,
} from '@/components/map/railModel';
import { landmarkSprite } from '@/modules/bus-model';

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
  /** The open station: solid ink, always shown, above the other squares. */
  selectedStationId?: string | null;
  onStationPress?: (stationId: string) => void;
  /** Street level: each station drawn as a little station, its band in its line's colour. */
  close?: boolean;
  /** A dark map: the stations have their lights on. */
  night?: boolean;
  /** Drawn by the route instead, as its MRT landmark. */
  hiddenStationId?: string | null;
}

/** Square height, and its width with one dot. */
const RAIL = 20;
/** Extra width per further dot, as `RouteLayer`'s squares. */
const RAIL_PER_DOT = 9;
/** A station's sprite, street level. */
const STATION = 32;

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
  selectedStationId = null,
  onStationPress,
  close = false,
  night = false,
  hiddenStationId = null,
}: RailLayerProps) {
  const sprite = close ? landmarkSprite('station', night) : null;
  const band = landmarkSprite('station-band');
  const shown = useMemo(
    () => new Set(stationsInFocus(stations, lines, focus)),
    [stations, lines, focus],
  );
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
        const selected = s.id === selectedStationId;
        if (!showAllStations && !s.interchange && !selected) return null;
        if (!selected && !shown.has(s)) return null;
        if (s.id === hiddenStationId) return null;
        const dots = Math.max(1, s.colors.length);
        return (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            flat
            zIndex={selected ? 2 : 0}
            displayPriority={selected ? 'required' : s.interchange ? 'high' : 'low'}
            onPress={onStationPress ? () => onStationPress(s.id) : undefined}
            accessibilityLabel={selected ? `${s.label}, selected` : s.label}
          >
            {sprite ? (
              <LandmarkFrame
                uri={sprite}
                size={STATION}
                band={band && s.colors[0] ? { uri: band, tint: s.colors[0] } : null}
                halo={selected ? ink : null}
              />
            ) : (
              <View
                collapsable={false}
                style={[
                  styles.square,
                  {
                    width: RAIL + (dots - 1) * RAIL_PER_DOT,
                    // Selected: solid ink like the selected stop (RouteLayer).
                    borderColor: selected ? paper : ink,
                    backgroundColor: selected ? ink : paper,
                  },
                ]}
              >
                {s.colors.map((c) => (
                  <View key={c} style={[styles.dot, { backgroundColor: c }]} />
                ))}
              </View>
            )}
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
