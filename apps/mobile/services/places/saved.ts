import { haversineMeters, type Place } from '@bus-tracker/shared';

import type { SavedPlace } from '@/hooks/useSettings';

/**
 * Saved-place rules (plan 15/07): Home, Work and up to six pins, kept in
 * `settings.savedPlaces`. Pure, so the Save menu, Settings → Places and the
 * quick actions all agree on what a save does.
 */

/** Pins beside Home and Work (spec §6.2's Saved section). */
export const MAX_PINS = 6;
/** A pin this close to a saved place is the same place. */
export const DUPLICATE_METERS = 30;

/** What a save needs to know about a place; the rules fill in id, kind and time. */
export type PlaceDraft = Pick<SavedPlace, 'name' | 'address' | 'lat' | 'lng' | 'ref'>;

export type AddPinResult =
  | { ok: true; list: SavedPlace[] }
  | { ok: false; reason: 'pins-full' | 'duplicate' };

/**
 * Home or Work: replaces the one already set, in its place, or joins the
 * end. A pin of the same place goes, so the Saved list never shows it twice.
 */
function setSingle(list: readonly SavedPlace[], kind: 'home' | 'work', place: PlaceDraft, now: number): SavedPlace[] {
  const next: SavedPlace = { ...pick(place), id: kind, kind, createdAt: now };
  const kept = list.filter((p) => !(p.kind === 'pin' && samePlace(p, place)));
  const at = kept.findIndex((p) => p.kind === kind);
  if (at < 0) return [...kept, next];
  return kept.map((p, i) => (i === at ? next : p)).filter((p, i) => i === at || p.kind !== kind);
}

export function setHome(list: readonly SavedPlace[], place: PlaceDraft, now: number): SavedPlace[] {
  return setSingle(list, 'home', place, now);
}

export function setWork(list: readonly SavedPlace[], place: PlaceDraft, now: number): SavedPlace[] {
  return setSingle(list, 'work', place, now);
}

export function pinCount(list: readonly SavedPlace[]): number {
  return list.filter((p) => p.kind === 'pin').length;
}

/** The same stop or station, or within {@link DUPLICATE_METERS} of each other. */
export function samePlace(a: PlaceDraft, b: PlaceDraft): boolean {
  if (a.ref && b.ref && a.ref.kind === b.ref.kind && a.ref.id === b.ref.id) return true;
  return haversineMeters(a, b) <= DUPLICATE_METERS;
}

/** The saved entry for this place, Home before Work before a pin, or null. */
export function findSaved(list: readonly SavedPlace[], place: PlaceDraft): SavedPlace | null {
  for (const kind of ['home', 'work', 'pin'] as const) {
    const hit = list.find((p) => p.kind === kind && samePlace(p, place));
    if (hit) return hit;
  }
  return null;
}

/** A new pin at the end. Refused once six are pinned, or when the place is already saved. */
export function addPin(list: readonly SavedPlace[], place: PlaceDraft, now: number): AddPinResult {
  if (list.some((p) => samePlace(p, place))) return { ok: false, reason: 'duplicate' };
  if (pinCount(list) >= MAX_PINS) return { ok: false, reason: 'pins-full' };
  // Ids are `pin-${createdAt}`; two saves in one millisecond still get their own.
  let at = now;
  while (list.some((p) => p.id === `pin-${at}`)) at++;
  return { ok: true, list: [...list, { ...pick(place), id: `pin-${at}`, kind: 'pin', createdAt: at }] };
}

export function removePlace(list: readonly SavedPlace[], id: string): SavedPlace[] {
  return list.filter((p) => p.id !== id);
}

/** A saved place as a journey end (spec §4.4): a stop or station keeps its id. */
export function placeToPlannerPlace(p: SavedPlace): Place {
  return p.ref
    ? { kind: p.ref.kind, name: p.name, lat: p.lat, lng: p.lng, ref: p.ref.id }
    : { kind: 'place', name: p.name, lat: p.lat, lng: p.lng };
}

/** A journey end as something to save; `address` is the line shown under its name, if any. */
export function draftFromPlannerPlace(p: Place, address: string | null): PlaceDraft {
  const ref = p.ref != null && (p.kind === 'stop' || p.kind === 'station') ? { kind: p.kind, id: p.ref } : null;
  return { name: p.name, address, lat: p.lat, lng: p.lng, ref };
}

function pick(p: PlaceDraft): PlaceDraft {
  return { name: p.name, address: p.address, lat: p.lat, lng: p.lng, ref: p.ref };
}
