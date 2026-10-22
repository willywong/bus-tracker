import { CodedError } from 'expo';

import native from './src/TransitMapsModule';

/**
 * Keyless Apple MapKit services (spec §5): place suggestions, place lookup,
 * walking paths, Look Around photos and map snapshots. iOS only; elsewhere
 * every call resolves empty or null, and `walk`/`resolve` reject with
 * `ERR_UNAVAILABLE`.
 */

export type LatLng = { lat: number; lng: number };
export type Region = { lat: number; lng: number; latDelta: number; lngDelta: number };
export type Completion = { id: string; title: string; subtitle: string };
export type ResolvedPlace = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** `MKPointOfInterestCategory` raw value; null for an address. */
  category: string | null;
};
export type WalkPath = { seconds: number; meters: number; coords: { lat: number; lng: number }[] };
export type MapsErrorCode = 'ERR_OFFLINE' | 'ERR_THROTTLED' | 'ERR_NOT_FOUND' | 'ERR_UNAVAILABLE';

/** The Klang Valley box (spec §3.1): lat 2.70–3.45, lon 101.25–101.95. */
export const KLANG_VALLEY: Region = { lat: 3.1, lng: 101.6, latDelta: 0.75, lngDelta: 0.7 };

// Seeded from the clock so ids keep growing across JS reloads (the native
// completer outlives them and drops any id older than the newest).
let queryId = Date.now();

/**
 * As-you-type place suggestions (at most 8). Only the latest call is live:
 * an earlier one still in flight resolves with `superseded: true`, which
 * callers ignore.
 */
export async function complete(
  query: string,
  region: Region = KLANG_VALLEY,
): Promise<{ results: Completion[]; superseded: boolean }> {
  if (!native) return { results: [], superseded: false };
  const batch = await native.complete(++queryId, query, region);
  return { results: batch.results, superseded: batch.superseded || batch.queryId !== queryId };
}

/** Turns a completion id from the last two `complete` batches into a place. */
export async function resolve(id: string): Promise<ResolvedPlace> {
  if (!native) throw unavailable();
  return native.resolve(id);
}

/** Apple's walking path between two points (thinned to ≤ 200 points). */
export async function walk(from: LatLng, to: LatLng): Promise<WalkPath> {
  if (!native) throw unavailable();
  const path = await native.walk({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  return {
    seconds: path.seconds,
    meters: path.meters,
    coords: path.coords.map(([lat, lng]) => ({ lat, lng })),
  };
}

/** A cached Look Around photo (`file://` JPEG), or null without coverage. */
export async function lookAround(lat: number, lng: number, w: number, h: number): Promise<string | null> {
  if (!native) return null;
  return native.lookAround(lat, lng, w, h);
}

/** A cached muted map tile (`file://` PNG); empty string without the module. */
export async function snapshot(region: Region, w: number, h: number, dark: boolean): Promise<string> {
  if (!native) return '';
  return native.snapshot(region, w, h, dark);
}

/** QA only: clears cached images and walking paths. */
export async function clearCache(): Promise<void> {
  if (!native) return;
  return native.clearCache();
}

const CODES: readonly MapsErrorCode[] = ['ERR_OFFLINE', 'ERR_THROTTLED', 'ERR_NOT_FOUND', 'ERR_UNAVAILABLE'];

/** The typed reason a call failed; anything unrecognised counts as not found. */
export function mapsErrorCode(e: unknown): MapsErrorCode {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : null;
  return CODES.find((c) => c === code) ?? 'ERR_NOT_FOUND';
}

function unavailable(): CodedError {
  return new CodedError('ERR_UNAVAILABLE', 'Apple Maps services are only available on iOS');
}
