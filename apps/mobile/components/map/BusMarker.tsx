import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { MapMarker, Marker } from 'react-native-maps';

import type { Glider } from '@/components/map/glide';
import { type BusKind, spriteForBearing } from '@/modules/bus-model';

// Marker views are hosted natively by MapKit; DynamicColorIOS / PlatformColor
// don't survive that bridge, so colours arrive as resolved hex strings.
// Every marker is a fixed square with its glyph at the exact centre:
// Apple Maps ignores `anchor` and re-centres views whose size changes.
// The frame is `collapsable={false}`: react-native-maps sizes the marker from
// its first native subview, and a flattened frame would leave only the disc,
// pushing the marker off its coordinate by the disc's inset.
const FRAME = 56;
const WEDGE_W = 10;
const WEDGE_H = 7;
/** Gap between the disc's edge and its heading wedge. */
const WEDGE_GAP = 1.5;
const HALO = 50;
/** The model's sprites: your (or the open) bus, then the rest. */
const SPRITE_SOLID = 44;
const SPRITE = 36;
/** Facing east, a side view, when a bus reports no heading. */
const SIDE_ON = 90;

interface BusMarkerProps {
  /** Moves the native marker between position fixes; its heading turns at each corner. */
  glider: Glider;
  ink: string;
  paper: string;
  live: string;
  /** The bus heading to your stop — larger, solid, live dot, always on top. */
  primary: boolean;
  /** Already past your stop — faded so it doesn't read as "your bus". */
  passed: boolean;
  /** The fix's heading, until the glider has one. */
  bearing?: number | null;
  accessibilityLabel: string;
  /** Open in the sheet: solid, with a halo so it stands out from the rest. */
  selected?: boolean;
  vehicleId: string;
  /** Which bus its sprite draws. */
  kind: BusKind;
  /** A dark map: the sprite has its lights on. */
  night?: boolean;
  /** Stable across renders, so an unchanged marker skips re-rendering. */
  onSelect?: (vehicleId: string) => void;
}

/**
 * A live bus. With the 3D model bundled, a tiny RapidKL bus seen from above,
 * turned to its heading; your bus is larger with the green live dot. Without
 * it, Calm Mono: a disc with an upright bus glyph and a heading wedge just
 * outside it, rotated to the bus's bearing (the glyph never turns, so it
 * always reads as a bus). Your bus is solid ink with the live dot (the app's
 * only colour); other buses are smaller paper discs.
 */
export const BusMarker = memo(function BusMarker({
  glider,
  ink,
  paper,
  live,
  primary,
  passed,
  bearing: fixBearing,
  accessibilityLabel,
  selected = false,
  vehicleId,
  kind,
  night = false,
  onSelect,
}: BusMarkerProps) {
  const onPress = useCallback(() => onSelect?.(vehicleId), [onSelect, vehicleId]);
  const gliding = useSyncExternalStore(glider.heading.subscribe, glider.heading.get);
  // Mounted where the glide has got to, and never moved by props again: the
  // glider moves it natively, and a changed prop would snap it.
  const [coordinate] = useState(() => {
    const at = glider.at();
    return { latitude: at.lat, longitude: at.lng };
  });
  const attach = useCallback((marker: MapMarker | null) => glider.attach(marker), [glider]);
  const bearing = gliding ?? fixBearing;
  const solid = primary || selected;
  const size = solid ? 34 : 28;
  const fill = solid ? ink : paper;
  const glyph = solid ? paper : ink;
  const hasHeading = typeof bearing === 'number' && Number.isFinite(bearing);
  const inset = (FRAME - size) / 2;
  // The bus model seen from above at its heading, when the model is bundled.
  const sprite = spriteForBearing(hasHeading ? bearing : SIDE_ON, kind, night);

  return (
    <Marker
      ref={attach}
      identifier={vehicleId}
      coordinate={coordinate}
      flat
      zIndex={selected ? 4 : primary ? 3 : 2}
      displayPriority="required"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={[styles.frame, { opacity: solid ? 1 : passed ? 0.45 : 0.85 }]}
        collapsable={false}
      >
        {selected ? <View style={[styles.halo, { backgroundColor: ink }]} /> : null}
        {sprite ? (
          <Image
            source={{ uri: sprite }}
            style={[
              styles.sprite,
              {
                left: (FRAME - (solid ? SPRITE_SOLID : SPRITE)) / 2,
                top: (FRAME - (solid ? SPRITE_SOLID : SPRITE)) / 2,
                width: solid ? SPRITE_SOLID : SPRITE,
                height: solid ? SPRITE_SOLID : SPRITE,
              },
            ]}
          />
        ) : null}
        {!sprite && hasHeading ? (
          <View style={[styles.frameFill, { transform: [{ rotate: `${bearing}deg` }] }]}>
            <View
              style={[styles.wedge, { top: inset - WEDGE_GAP - WEDGE_H, borderBottomColor: ink }]}
            />
          </View>
        ) : null}
        {sprite ? null : (
          <View
            style={[
              styles.disc,
              {
                left: inset,
                top: inset,
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: solid ? paper : ink,
                borderWidth: solid ? 2.5 : 2,
                backgroundColor: fill,
              },
            ]}
          >
            <SymbolView
              name="bus.fill"
              size={solid ? 16 : 13}
              tintColor={glyph}
              resizeMode="scaleAspectFit"
            />
          </View>
        )}
        {primary && !passed ? (
          <View
            style={[
              styles.liveDot,
              {
                left: sprite ? FRAME - 15 : inset + size - 10,
                top: sprite ? 4 : inset - 2,
                backgroundColor: live,
                borderColor: paper,
              },
            ]}
          />
        ) : null}
      </View>
    </Marker>
  );
});

interface GhostBusMarkerProps {
  coordinate: { latitude: number; longitude: number };
  color: string;
  background: string;
}

/**
 * Where the next *scheduled* bus should be when nothing live is reporting.
 * A dashed ring with a dot: never filled, never a chevron, so it can't be
 * mistaken for a live bus.
 */
export function GhostBusMarker({ coordinate, color, background }: GhostBusMarkerProps) {
  return (
    <Marker
      coordinate={coordinate}
      flat
      zIndex={1}
      accessibilityLabel="Scheduled bus position, not live"
    >
      <View style={styles.frame} collapsable={false}>
        <View style={[styles.ghost, { borderColor: color, backgroundColor: background }]}>
          <View style={[styles.ghostDot, { backgroundColor: color }]} />
        </View>
      </View>
    </Marker>
  );
}

const GHOST = 28;

const styles = StyleSheet.create({
  frame: {
    width: FRAME,
    height: FRAME,
  },
  frameFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: FRAME,
    height: FRAME,
    alignItems: 'center',
  },
  // A triangle from borders: transparent sides, ink base.
  wedge: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: WEDGE_W / 2,
    borderRightWidth: WEDGE_W / 2,
    borderBottomWidth: WEDGE_H,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  halo: {
    position: 'absolute',
    left: (FRAME - HALO) / 2,
    top: (FRAME - HALO) / 2,
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    opacity: 0.14,
  },
  disc: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  // iOS draws a layer's shadow from its contents' alpha: it hugs the bus.
  sprite: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  liveDot: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2.5,
  },
  ghost: {
    position: 'absolute',
    left: (FRAME - GHOST) / 2,
    top: (FRAME - GHOST) / 2,
    width: GHOST,
    height: GHOST,
    borderRadius: GHOST / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
