import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { ROW_H } from '@/components/rail/stripLayout';
import { stationSpoken, type StripStation } from '@/components/rail/stripModel';
import { RowButton } from '@/components/ui/RowButton';
import { color, space, type } from '@/theme/design';

/** Width of the rail's column; the rail runs down its centre. */
const RAIL_COL = 44;
export const RAIL_X = RAIL_COL / 2;
const RAIL_W = 6;
const BEAD = 14;
const PIN = 28;
const SQUARE = 8;

/**
 * The vertical strip map of one line in one direction (spec §6.5): a 6 pt
 * rail in the line's colour from the first bead to the last, a paper bead
 * per station with its name, the other lines' colour squares at
 * interchanges, and your nearest station as the ink standing-figure pin.
 * Rows open the station sheet. Rows grow with Dynamic Type, so bead centres
 * are measured and reported through `onBeadYs`; `overlay` (the estimated
 * trains) is drawn over the rows in the same coordinates.
 */
export function StripMap({
  stations,
  lineColor,
  ys,
  nearestIndex,
  onBeadYs,
  onOpenStation,
  overlay,
}: {
  stations: readonly StripStation[];
  lineColor: string;
  /** Bead centres in strip coordinates, measured or at the default row height. */
  ys: readonly number[];
  nearestIndex: number;
  onBeadYs: (ys: number[]) => void;
  onOpenStation: (stationId: string) => void;
  overlay?: ReactNode;
}) {
  const rows = useRef<Array<number | undefined>>([]);
  const onRowLayout = useCallback(
    (i: number, e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      rows.current[i] = y + height / 2;
      const all = rows.current;
      if (all.length < stations.length) return;
      for (let k = 0; k < stations.length; k++) if (all[k] === undefined) return;
      onBeadYs(all.slice(0, stations.length) as number[]);
    },
    [stations.length, onBeadYs],
  );

  const top = ys[0] ?? 0;
  const bottom = ys[ys.length - 1] ?? 0;

  return (
    <View style={styles.strip}>
      <View
        style={[styles.rail, { top, height: Math.max(0, bottom - top), backgroundColor: lineColor }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {stations.map((s, i) => {
        const nearest = i === nearestIndex;
        const content = (
          <>
            <View style={styles.beadCol}>
              {nearest ? (
                <View style={styles.pin}>
                  <SymbolView
                    name="figure.stand"
                    size={15}
                    weight="semibold"
                    tintColor={color.paper}
                    resizeMode="scaleAspectFit"
                  />
                </View>
              ) : (
                <View style={[styles.bead, { borderColor: lineColor }]} />
              )}
            </View>
            <View style={styles.label}>
              <Text style={[styles.name, nearest && styles.nameNearest]}>{s.name}</Text>
              {s.otherLineColors.length > 0 ? (
                <View style={styles.squares}>
                  {s.otherLineColors.map((c) => (
                    <View key={c} style={[styles.square, { backgroundColor: c }]} />
                  ))}
                </View>
              ) : null}
            </View>
          </>
        );
        const spoken = stationSpoken(s, nearest);
        const stationId = s.stationId;
        return (
          <View key={`${s.stopIndex}:${i}`} onLayout={(e) => onRowLayout(i, e)}>
            {stationId ? (
              <RowButton
                onPress={() => onOpenStation(stationId)}
                style={styles.row}
                accessibilityLabel={spoken}
                accessibilityHint="Shows departures"
              >
                {content}
              </RowButton>
            ) : (
              <View style={styles.row} accessible accessibilityLabel={spoken}>
                {content}
              </View>
            )}
          </View>
        );
      })}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'relative',
  },
  rail: {
    position: 'absolute',
    left: RAIL_X - RAIL_W / 2,
    width: RAIL_W,
  },
  row: {
    minHeight: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  beadCol: {
    width: RAIL_COL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bead: {
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 3,
    backgroundColor: color.paper,
  },
  pin: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 2.5,
    borderColor: color.paper,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  label: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.xs,
    rowGap: space.xxs,
    paddingVertical: space.xs,
    paddingLeft: space.xs,
  },
  name: {
    ...type.body,
    flexShrink: 1,
    color: color.label,
  },
  nameNearest: {
    fontWeight: '600',
  },
  squares: {
    flexDirection: 'row',
    gap: 3,
  },
  square: {
    width: SQUARE,
    height: SQUARE,
    borderRadius: 2,
  },
});
