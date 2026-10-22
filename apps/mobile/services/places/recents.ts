import type { Place } from '@bus-tracker/shared';

/**
 * The plan sheet's recent destinations and starts (spec §6.2: six of them).
 * Pure; `recentsStore.ts` reads and writes them in SecureStore.
 */

export type RecentPlace = Place & {
  usedAt: number;
  /** The address or area line shown under an Apple place's name. */
  address?: string;
};

/** SecureStore key, holding JSON `RecentPlace[]`. */
export const RECENTS_KEY = 'bt.planRecents';
export const MAX_RECENTS = 6;

const KINDS: readonly Place['kind'][] = ['place', 'stop', 'station'];

/** Coordinates rounded to 4 dp (about 11 m): the same spot picked twice. */
function coordKey(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

function samePlace(a: Place, b: Place): boolean {
  if (a.ref != null && b.ref != null && a.ref === b.ref) return true;
  return coordKey(a) === coordKey(b);
}

/**
 * `place` as the newest recent: any earlier entry for the same ref or the
 * same rounded coordinates is dropped, and the list is capped at six.
 * "My location" is never a recent.
 */
export function mergeRecent(
  list: readonly RecentPlace[],
  place: Place & { address?: string },
  now: number,
): RecentPlace[] {
  if (place.kind === 'here' || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
    return list.slice(0, MAX_RECENTS);
  }
  const entry: RecentPlace = { ...place, usedAt: now };
  return [entry, ...list.filter((r) => !samePlace(r, place))].slice(0, MAX_RECENTS);
}

/** Stored JSON → recents, dropping anything malformed; newest first. */
export function parseRecents(raw: string | null): RecentPlace[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RecentPlace[] = [];
    for (const v of parsed) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      if (!KINDS.includes(o.kind as Place['kind'])) continue;
      if (typeof o.name !== 'string' || o.name.length === 0) continue;
      if (typeof o.lat !== 'number' || !Number.isFinite(o.lat)) continue;
      if (typeof o.lng !== 'number' || !Number.isFinite(o.lng)) continue;
      if (typeof o.usedAt !== 'number' || !Number.isFinite(o.usedAt)) continue;
      const r: RecentPlace = {
        kind: o.kind as Place['kind'],
        name: o.name,
        lat: o.lat,
        lng: o.lng,
        usedAt: o.usedAt,
      };
      if (typeof o.ref === 'string') r.ref = o.ref;
      if (typeof o.address === 'string') r.address = o.address;
      out.push(r);
    }
    return out.sort((a, b) => b.usedAt - a.usedAt).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}
