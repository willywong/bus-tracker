import { feedOfStopId } from '@bus-tracker/shared';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

/**
 * The RealityKit bus (iOS only). The models live in `ios/Assets/`, built by
 * `scripts/build-feeder-bus.py` (the MRT feeder bus) and
 * `scripts/build-lrt-bus.py` (the rapidKL city bus); any replacement must
 * follow the feeder script's contract (Y-up, metres, front to +Z, a
 * `Headsign` quad).
 */

/**
 * Which bus to draw: the MRT feeder bus on MRT feeder routes, the rapidKL
 * city bus (which also works the LRT feeders) everywhere else.
 */
export type BusKind = 'feeder' | 'rapid';

/**
 * The bus for a trip, vehicle or stop id: Rapid KL ids carry their feed's
 * prefix ('kl:…') and MRT feeder ids are raw.
 */
export function busKindOf(id: string | null | undefined): BusKind {
  return id == null || feedOfStopId(id) === 'feeder' ? 'feeder' : 'rapid';
}

export type BusModelViewProps = ViewProps & {
  kind: BusKind;
  /** Drawn in red at the left of the LED headsign, as "T816". */
  routeCode: string;
  /** Drawn in amber beside it; "rapidKL" when unknown. */
  destination: string | null;
  /** The sheet's paper, as a hex string, so the scene sits on it seamlessly. */
  paper: string;
  /** Idle turntable; off under Reduce Motion (a drag still turns it). */
  spins: boolean;
};

// Null where the native module isn't in the build (Android, or a dev client
// built before this module).
const native =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<{
        hasModel: boolean;
        mapSprites: Partial<Record<BusKind, string[]>>;
        pillIcons: Partial<Record<BusKind, string>>;
        nightSprites?: Partial<Record<BusKind, string[]>>;
        nightPillIcons?: Partial<Record<BusKind, string>>;
        landmarks?: Partial<Record<Landmark, string>>;
        launch(x: number, y: number, width: number, height: number, kind: BusKind): Promise<void>;
        rideAlong?(identifier: string, heading: number, bottomInset: number): Promise<void>;
        rideAlongTurn?(heading: number): Promise<void>;
        rideAlongInset?(bottomInset: number): Promise<void>;
        rideAlongPause?(): Promise<void>;
        rideAlongStop?(): Promise<void>;
      }>('BusModel')
    : null;

// Null too when the models aren't bundled, so callers render nothing instead
// of a blank gap.
export const BusModelView: ComponentType<BusModelViewProps> | null = native?.hasModel
  ? requireNativeView<BusModelViewProps>('BusModel')
  : null;

/**
 * The map's tiny buses, rendered from the same models: per kind, 24 file
 * URIs, frame k heading k × 15° clockwise from north. Empty without them, so
 * the map keeps its plain markers.
 */
const mapSprites: Partial<Record<BusKind, readonly string[]>> = native?.mapSprites ?? {};
/** The same at night: headlamps on, the sign lit. Empty in a build without them. */
const nightSprites: Partial<Record<BusKind, readonly string[]>> = native?.nightSprites ?? {};

/** The bus pill's icon, the bus three-quarters on (44 × 36 pt), lit at night; or null. */
export function pillIconFor(kind: BusKind, night = false): string | null {
  return (night ? native?.nightPillIcons?.[kind] : null) ?? native?.pillIcons[kind] ?? null;
}

/**
 * The map's landmarks, drawn from our own Blender models
 * (`scripts/build-map-landmarks.py`): a stop shelter, your stop's larger
 * shelter with someone waiting, a rail station (its line band a separate
 * mask to tint), the MRT station a feeder ends at; each with a night version.
 * Square, the ground point at 50% across and 70% down.
 */
export type Landmark =
  | 'shelter'
  | 'shelter-night'
  | 'your-stop'
  | 'your-stop-night'
  | 'mrt-station'
  | 'mrt-station-night'
  | 'station'
  | 'station-band'
  | 'station-night';

/** Where the landmark's ground point sits in its square image (fractions). */
export const LANDMARK_GROUND = { x: 0.5, y: 0.7 } as const;

/** The landmark's file URI, its night version at night when there is one; null without it. */
export function landmarkSprite(
  name: 'shelter' | 'your-stop' | 'mrt-station' | 'station' | 'station-band',
  night = false,
): string | null {
  const all = native?.landmarks ?? {};
  const lit = night && name !== 'station-band' ? all[`${name}-night`] : undefined;
  return lit ?? all[name] ?? null;
}

/**
 * Sends the pill's bus (at this frame, in window points) flying into the trip
 * sheet as it opens: the sheet's 3D bus takes off from there. Nothing under
 * Reduce Motion, or where the module isn't built.
 */
export function launchBusFlight(
  frame: { x: number; y: number; width: number; height: number },
  kind: BusKind,
) {
  void native?.launch(frame.x, frame.y, frame.width, frame.height, kind);
}

/** The sprite of this bus facing closest to a compass bearing (degrees). */
export function spriteForBearing(bearing: number, kind: BusKind, night = false): string | null {
  const lit = night ? (nightSprites[kind] ?? []) : [];
  const sprites = lit.length > 0 ? lit : (mapSprites[kind] ?? []);
  if (sprites.length === 0) return null;
  const n = sprites.length;
  const k = Math.round((((bearing % 360) + 360) % 360) / (360 / n)) % n;
  return sprites[k] ?? null;
}

/** Whether this build can ride along (the native follow camera is in it). */
export const canRideAlong = native?.rideAlong != null;

/**
 * Ride along: the map's camera follows the bus marker whose `identifier` is
 * this, from behind and above, pitched over the 3D buildings and turned to
 * `heading`. It runs natively frame by frame; `bottomInset` is how much of
 * the map's bottom is covered (points), so the bus stays in the open part.
 */
export function rideAlong(identifier: string, heading: number, bottomInset: number) {
  void native?.rideAlong?.(identifier, heading, bottomInset);
}

/** The ridden bus turned a corner. */
export function rideAlongTurn(heading: number) {
  void native?.rideAlongTurn?.(heading);
}

/** The covered bottom of the map changed while riding along. */
export function rideAlongInset(bottomInset: number) {
  void native?.rideAlongInset?.(bottomInset);
}

/** Stops following while the map is out of sight; `rideAlong` carries on from there. */
export function rideAlongPause() {
  void native?.rideAlongPause?.();
}

/** Back to the flat map. */
export function rideAlongStop() {
  void native?.rideAlongStop?.();
}
