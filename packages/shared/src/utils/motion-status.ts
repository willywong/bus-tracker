import { haversineMeters } from "./outlier.js";
import type { LatLng } from "./route.js";

export type MotionStatus = "at-signal" | "stopped" | "slow" | "moving";

export interface MotionStatusResult {
  kind: MotionStatus;
  /** User-facing copy. Short enough for a chip. */
  label: string;
  /** Rounded km/h, or null if speed wasn't provided. */
  speedKmh: number | null;
  /** OSM id of the nearest signal when `kind === "at-signal"`, else null. */
  nearestSignalId: number | null;
}

export interface MotionStatusArgs {
  /** Speed in km/h (matches Prasarana feed convention). */
  speedKmh: number | null | undefined;
  /** Current vehicle position. */
  position: LatLng | null | undefined;
  /** Traffic signals along the current route. */
  signals: readonly { id: number; lat: number; lng: number }[];
}

/**
 * Threshold below which the bus is treated as "stopped". GPS noise at rest on
 * the Prasarana feed typically sits at 1-3 km/h; 4 is a safe floor.
 */
export const STOPPED_SPEED_KMH = 4;
/** Upper bound for "slow traffic" — anything faster is free-flowing. */
export const SLOW_SPEED_KMH = 15;
/**
 * Radius around a signal node at which a stopped bus is attributed to the
 * signal. 40 m covers the approach lanes on large KL junctions.
 */
export const SIGNAL_PROXIMITY_METERS = 40;

/**
 * Classifies the bus's current motion based on speed and proximity to a
 * traffic signal. Returns null when there isn't enough data to say anything.
 */
export function getMotionStatus(
  args: MotionStatusArgs,
): MotionStatusResult | null {
  const { speedKmh, position, signals } = args;
  if (speedKmh == null || !Number.isFinite(speedKmh)) return null;
  if (!position) return null;

  const roundedSpeed = Math.round(speedKmh);

  if (speedKmh < STOPPED_SPEED_KMH) {
    const nearest = findNearestSignal(position, signals);
    if (nearest && nearest.meters <= SIGNAL_PROXIMITY_METERS) {
      return {
        kind: "at-signal",
        label: "Stopped at a traffic light",
        speedKmh: roundedSpeed,
        nearestSignalId: nearest.id,
      };
    }
    return {
      kind: "stopped",
      label: "Stopped",
      speedKmh: roundedSpeed,
      nearestSignalId: null,
    };
  }

  if (speedKmh < SLOW_SPEED_KMH) {
    return {
      kind: "slow",
      label: `Slow traffic · ${roundedSpeed} km/h`,
      speedKmh: roundedSpeed,
      nearestSignalId: null,
    };
  }

  return {
    kind: "moving",
    label: `On the move · ${roundedSpeed} km/h`,
    speedKmh: roundedSpeed,
    nearestSignalId: null,
  };
}

function findNearestSignal(
  position: LatLng,
  signals: readonly { id: number; lat: number; lng: number }[],
): { id: number; meters: number } | null {
  let best: { id: number; meters: number } | null = null;
  for (const s of signals) {
    const m = haversineMeters(position, { lat: s.lat, lng: s.lng });
    if (!best || m < best.meters) {
      best = { id: s.id, meters: m };
    }
  }
  return best;
}
