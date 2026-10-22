import { lookAround, snapshot } from '@/modules/transit-maps';

/** Half-width of the snapshot box: a 600 m square around the point. */
const BOX_M = 600;
const M_PER_DEG_LAT = 111_320;

/**
 * Station and place imagery seam (13/03 → 15/01). Look Around first; the
 * caller falls back to Street View (`StopPhoto`), then `snapshotUri`.
 * Both are cached on disk by the native module for 30 days.
 */

/** A Look Around photo `file://` URI, or null (no coverage, offline, Android). */
export async function lookAroundUri(lat: number, lng: number, w = 640, h = 360): Promise<string | null> {
  try {
    return await lookAround(lat, lng, w, h);
  } catch {
    return null;
  }
}

/**
 * A muted map tile of the box around the point (600 m, or `boxM` for a
 * closer look such as a saved place's 400 m thumbnail), or null.
 */
export async function snapshotUri(
  lat: number,
  lng: number,
  w: number,
  h: number,
  dark: boolean,
  boxM: number = BOX_M,
): Promise<string | null> {
  const latDelta = boxM / M_PER_DEG_LAT;
  const lngDelta = boxM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  try {
    return (await snapshot({ lat, lng, latDelta, lngDelta }, w, h, dark)) || null;
  } catch {
    return null;
  }
}
