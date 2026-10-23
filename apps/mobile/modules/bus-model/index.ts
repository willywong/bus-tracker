import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

/**
 * The RealityKit bus (iOS only). The model lives in `ios/Assets/RapidBus.usdz`,
 * built by `scripts/build-feeder-bus.py`; any replacement must follow that
 * script's contract (Y-up, metres, front to +Z, a `Headsign` quad).
 */
export type BusModelViewProps = ViewProps & {
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
        mapSprites: string[];
        pillIcon: string | null;
      }>('BusModel')
    : null;

// Null too when the model isn't bundled (it's gitignored until its author
// agrees), so callers render nothing instead of a blank gap.
export const BusModelView: ComponentType<BusModelViewProps> | null = native?.hasModel
  ? requireNativeView<BusModelViewProps>('BusModel')
  : null;

/**
 * The map's tiny buses, rendered from the same model: 24 file URIs, frame k
 * heading k × 15° clockwise from north. Empty without them, so the map keeps
 * its plain markers.
 */
export const mapSprites: readonly string[] = native?.mapSprites ?? [];

/** The bus pill's icon, the bus three-quarters on (44 × 36 pt), or null. */
export const pillIcon: string | null = native?.pillIcon ?? null;

/** The sprite facing closest to a compass bearing (degrees). */
export function spriteForBearing(bearing: number): string | null {
  if (mapSprites.length === 0) return null;
  const n = mapSprites.length;
  const k = Math.round((((bearing % 360) + 360) % 360) / (360 / n)) % n;
  return mapSprites[k] ?? null;
}
