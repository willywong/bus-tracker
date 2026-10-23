import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { MapMarker, Marker } from 'react-native-maps';

import type { Glider } from '@/components/map/glide';
import { mapHeading } from '@/components/map/mapHeading';
import { type BusKind, hasRideSprites, spriteForBearing } from '@/modules/bus-model';

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
/**
 * Riding along, the map tilts and zooms in on the ridden bus, so the sprites
 * are seen from low behind and drawn larger: the ridden bus big enough to
 * read as the sheet's 3D bus, the rest a little larger than on the flat map.
 */
const RIDE_SOLID = 120;
const RIDE = 64;
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
  /** Riding along: the map is tilted, so the sprite is seen from low behind, larger. */
  tilted?: boolean;
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
  tilted = false,
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
  // The bus model at its heading on the screen (its bearing less the map's),
  // when the model is bundled. Only a change of sprite redraws the marker.
  const ride = tilted && hasRideSprites;
  const spriteNow = useCallback(
    () => spriteForBearing(hasHeading ? bearing - mapHeading.get() : SIDE_ON, kind, night, ride),
    [hasHeading, bearing, kind, night, ride],
  );
  const sprite = useSyncExternalStore(mapHeading.subscribe, spriteNow);
  const spriteSize = ride ? (solid ? RIDE_SOLID : RIDE) : solid ? SPRITE_SOLID : SPRITE;
  const frame = Math.max(FRAME, spriteSize);
  const inset = (frame - size) / 2;

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
        style={{ width: frame, height: frame, opacity: solid ? 1 : passed ? 0.45 : 0.85 }}
        collapsable={false}
      >
        {selected ? (
          <View
            style={[
              styles.halo,
              { backgroundColor: ink, left: (frame - HALO) / 2, top: (frame - HALO) / 2 },
            ]}
          />
        ) : null}
        {sprite ? (
          <Image
            source={{ uri: sprite }}
            style={[
              styles.sprite,
              {
                left: (frame - spriteSize) / 2,
                top: (frame - spriteSize) / 2,
                width: spriteSize,
                height: spriteSize,
              },
            ]}
          />
        ) : null}
        {!sprite && hasHeading ? (
          <View
            style={[
              styles.frameFill,
              { width: frame, height: frame, transform: [{ rotate: `${bearing}deg` }] },
            ]}
          >
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
                // Over the bus's roof: on the tilted map the ridden bus is
                // mostly seen from behind, narrow and tall.
                left: sprite ? (ride && solid ? frame * 0.62 : frame - 15) : inset + size - 10,
                top: sprite ? (ride && solid ? frame * 0.12 : 4) : inset - 2,
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
