import type { VehiclePosition } from "../types/bus.js";

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters between two lat/lng points. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface OutlierFilterOptions {
  /** Max allowed jump between consecutive accepted positions, in meters. */
  maxJumpMeters?: number;
  onReject?: (rejected: VehiclePosition, reason: string, meters: number) => void;
}

export interface OutlierFilter {
  /** Run a batch of incoming positions, returning only the accepted ones. */
  accept(positions: VehiclePosition[]): VehiclePosition[];
  /** Clear remembered last-accepted positions. */
  reset(): void;
}

/**
 * Per-vehicle outlier rejector.
 *
 * Rejects any position whose distance from the previous accepted position
 * for the same `vehicleId` exceeds `maxJumpMeters` (default 500m).
 * The first reading for a vehicle is always accepted.
 */
export function createOutlierFilter(
  opts: OutlierFilterOptions = {},
): OutlierFilter {
  const maxJump = opts.maxJumpMeters ?? 500;
  const onReject =
    opts.onReject ??
    ((p, reason, meters) =>
      console.warn(
        `[outlier] rejected ${p.vehicleId}: ${reason} (${Math.round(meters)}m)`,
      ));
  const lastAccepted = new Map<string, VehiclePosition>();

  return {
    accept(positions) {
      const out: VehiclePosition[] = [];
      for (const p of positions) {
        const prev = lastAccepted.get(p.vehicleId);
        if (!prev) {
          lastAccepted.set(p.vehicleId, p);
          out.push(p);
          continue;
        }
        const meters = haversineMeters(prev, p);
        if (meters > maxJump) {
          onReject(p, `jump >${maxJump}m`, meters);
          continue;
        }
        lastAccepted.set(p.vehicleId, p);
        out.push(p);
      }
      return out;
    },
    reset() {
      lastAccepted.clear();
    },
  };
}
