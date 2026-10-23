import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { LANDMARK_GROUND } from '@/modules/bus-model';

/** From this zoom (a few streets across), stops and stations are drawn as little buildings. */
export const LANDMARKS_FROM_ZOOM = 15.5;

interface LandmarkFrameProps {
  /** The sprite (`landmarkSprite`), square, its ground point at `LANDMARK_GROUND`. */
  uri: string;
  /** Its side, in points. */
  size: number;
  /** A mask drawn over it in `tint`: a rail station's line band. */
  band?: { uri: string; tint: string } | null;
  /** Room under the sprite for a label, and how wide the label may be (points). */
  below?: number;
  width?: number;
  children?: ReactNode;
  /** A faint disc on the ground under it: the one open in the sheet. */
  halo?: string | null;
}

const HALO = 40;

/**
 * A landmark sprite on a map marker. Apple Maps centres every marker view on
 * its coordinate (it ignores `anchor`), so the frame is sized for its centre
 * to be the sprite's ground point: as much room below the ground point as
 * above it, with any label in the room below.
 */
export function LandmarkFrame({
  uri,
  size,
  band,
  below = 0,
  width = size,
  children,
  halo,
}: LandmarkFrameProps) {
  const frame = Math.max(size, width);
  const above = size * LANDMARK_GROUND.y;
  const under = size - above + below;
  const half = Math.max(above, under);
  const top = half - above;
  const left = (frame - size) / 2;
  return (
    <View style={{ width: frame, height: half * 2 }} collapsable={false}>
      {halo ? (
        <View
          style={[
            styles.halo,
            { backgroundColor: halo, left: frame / 2 - HALO / 2, top: half - HALO / 2 },
          ]}
        />
      ) : null}
      <Image source={{ uri }} style={[styles.sprite, { left, top, width: size, height: size }]} />
      {band ? (
        <Image
          source={{ uri: band.uri }}
          style={[styles.sprite, { left, top, width: size, height: size, tintColor: band.tint }]}
        />
      ) : null}
      {children ? <View style={[styles.below, { top: top + size }]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: {
    position: 'absolute',
  },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    opacity: 0.14,
  },
  below: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
