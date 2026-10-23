import type { Place } from '@bus-tracker/shared';
import type { SFSymbol } from 'expo-symbols';

import { formatDistance } from '@/components/map/format';
import type { SavedPlace } from '@/hooks/useSettings';
import type { ResolvedPlace } from '@/modules/transit-maps';
import type { PlaceHit } from '@/services/places/placeSearch';
import { MAX_PINS } from '@/services/places/saved';
import type { RecentPlace } from '@/services/places/recents';

import { normalizeName, type LocalHit, type RouteHit } from './searchIndex';

/**
 * Pure presentation model for the plan sheet's search state (spec §6.2):
 * every row's glyph, text and spoken label, and the When rules. The views
 * in `SuggestionRow.tsx` and `FromWhen.tsx` stay dumb.
 */

/** Line-colour squares shown before "+n". */
export const MAX_LINE_SQUARES = 4;
export const MAX_SAVED_PINS = MAX_PINS;
export const MAX_PLACE_ROWS = 8;
export const MAX_LOCAL_ROWS = 6;

export type RowLead = { kind: 'symbol'; name: SFSymbol } | { kind: 'squares'; colors: string[]; more: number };

export interface RowModel {
  key: string;
  lead: RowLead;
  title: string;
  /** One line, secondary. */
  subtitle: string | null;
  /** Right-aligned, secondary (a place's distance). */
  trailing: string | null;
  accessibilityLabel: string;
  /** A saved place's map thumbnail (15/07), shown instead of the lead glyph. */
  thumb?: { lat: number; lng: number };
}

/** "a", "a and b", "a, b and c". */
export function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function linesText(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`;
}

/** "T816 · T815 · T817 · +2". */
export function routesText(routes: readonly string[], count: number): string {
  const more = count - routes.length;
  return [...routes, ...(more > 0 ? [`+${more}`] : [])].join(' · ');
}

function routesSpoken(routes: readonly string[], count: number): string {
  if (count === 0) return '';
  const more = count - routes.length;
  const words = more > 0 ? [...routes, `${more} more`] : [...routes];
  return `${count === 1 ? 'route' : 'routes'} ${listAnd(words)}`;
}

/** "450 metres", "1.2 kilometres": `formatDistance`, spoken. */
export function spokenDistance(meters: number): string {
  const shown = formatDistance(meters);
  if (shown.endsWith(' km')) {
    const n = shown.slice(0, -3);
    return `${n} ${n === '1' ? 'kilometre' : 'kilometres'}`;
  }
  if (shown.endsWith(' m')) return `${shown.slice(0, -2)} metres`;
  return shown;
}

const spoken = (...parts: (string | null | undefined)[]) => parts.filter((p) => p).join(', ');

function stationParts(hit: Extract<LocalHit, { kind: 'station' }>) {
  const subtitle = linesText(hit.lineCount);
  return { subtitle, a11y: spoken('Station', hit.name, subtitle) };
}

function stopParts(hit: Extract<LocalHit, { kind: 'stop' }>) {
  return {
    subtitle: hit.routeCount > 0 ? routesText(hit.routes, hit.routeCount) : null,
    a11y: spoken('Bus stop', hit.name, routesSpoken(hit.routes, hit.routeCount)),
  };
}

export function localRow(hit: LocalHit): RowModel {
  if (hit.kind === 'station') {
    const { subtitle, a11y } = stationParts(hit);
    return {
      key: `station:${hit.id}`,
      lead: {
        kind: 'squares',
        colors: hit.lineColors.slice(0, MAX_LINE_SQUARES),
        more: Math.max(0, hit.lineColors.length - MAX_LINE_SQUARES),
      },
      title: hit.name,
      subtitle,
      trailing: null,
      accessibilityLabel: a11y,
    };
  }
  const { subtitle, a11y } = stopParts(hit);
  return {
    key: `stop:${hit.id}`,
    lead: { kind: 'symbol', name: 'bus.fill' },
    title: hit.name,
    subtitle,
    trailing: null,
    accessibilityLabel: a11y,
  };
}

const code = (s: string) => normalizeName(s).replace(/ /g, '');

/**
 * A bus route by its code: its name (or, when the name is just the code,
 * where it's headed from your nearest stop) and how far that stop is.
 */
export function routeRow(hit: RouteHit): RowModel {
  const named = hit.longName !== '' && code(hit.longName) !== code(hit.label);
  const subtitle = named ? hit.longName : hit.towards ? `To ${hit.towards}` : null;
  return {
    key: `route:${hit.label}`,
    lead: { kind: 'symbol', name: 'point.bottomleft.forward.to.point.topright.scurvepath' },
    title: hit.label,
    subtitle,
    trailing: hit.meters != null ? formatDistance(hit.meters) : null,
    accessibilityLabel: spoken(
      'Route',
      hit.label,
      subtitle,
      `nearest stop ${hit.stopName}`,
      hit.meters != null ? spokenDistance(hit.meters) : null,
    ),
  };
}

export function placeRow(hit: PlaceHit): RowModel {
  const subtitle = hit.subtitle || hit.resolved?.address || null;
  const trailing = hit.meters != null ? formatDistance(hit.meters) : null;
  return {
    key: `place:${hit.id}`,
    lead: { kind: 'symbol', name: hit.symbol },
    title: hit.title,
    subtitle,
    trailing,
    accessibilityLabel: spoken('Place', hit.title, subtitle, hit.meters != null ? spokenDistance(hit.meters) : null),
  };
}

/** A recent: the clock glyph, otherwise as its kind (`local` is its network entry, if any). */
export function recentRow(r: RecentPlace, local: LocalHit | null): RowModel {
  const base = { key: `recent:${r.kind}:${r.ref ?? `${r.lat},${r.lng}`}`, title: r.name, trailing: null };
  const lead: RowLead = { kind: 'symbol', name: 'clock.arrow.circlepath' };
  if (local?.kind === 'station') {
    const { subtitle, a11y } = stationParts({ ...local, name: r.name });
    return { ...base, lead, subtitle, accessibilityLabel: `Recent, ${a11y}` };
  }
  if (local?.kind === 'stop') {
    const { subtitle, a11y } = stopParts({ ...local, name: r.name });
    return { ...base, lead, subtitle, accessibilityLabel: `Recent, ${a11y}` };
  }
  const kind = r.kind === 'station' ? 'Station' : r.kind === 'stop' ? 'Bus stop' : 'Place';
  const subtitle = r.address ?? null;
  return { ...base, lead, subtitle, accessibilityLabel: spoken('Recent', kind, r.name, subtitle) };
}

const SAVED_SYMBOL: Record<SavedPlace['kind'], SFSymbol> = {
  home: 'house.fill',
  work: 'briefcase.fill',
  pin: 'mappin',
};

export function savedRow(p: SavedPlace): RowModel {
  const title = p.kind === 'home' ? 'Home' : p.kind === 'work' ? 'Work' : p.name;
  const subtitle = p.kind === 'pin' ? p.address : p.address ?? p.name;
  return {
    key: `saved:${p.id}`,
    lead: { kind: 'symbol', name: SAVED_SYMBOL[p.kind] },
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : null,
    trailing: null,
    accessibilityLabel: spoken(title, p.kind === 'pin' ? null : p.name, p.address),
    thumb: { lat: p.lat, lng: p.lng },
  };
}

/** Home, then Work, then up to six pins, newest first. */
export function savedInOrder(saved: readonly SavedPlace[]): SavedPlace[] {
  const home = saved.find((p) => p.kind === 'home');
  const work = saved.find((p) => p.kind === 'work');
  const pins = saved
    .filter((p) => p.kind === 'pin')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SAVED_PINS);
  return [...(home ? [home] : []), ...(work ? [work] : []), ...pins];
}

export function hereRow(): RowModel {
  return {
    key: 'here',
    lead: { kind: 'symbol', name: 'location.fill' },
    title: 'My location',
    subtitle: null,
    trailing: null,
    accessibilityLabel: 'My location',
  };
}

/** A station or stop hit as a journey end; `ref` is what `access.ts` looks up. */
export function placeFromLocal(hit: LocalHit): Place {
  return { kind: hit.kind, name: hit.name, lat: hit.lat, lng: hit.lng, ref: hit.id };
}

/** A resolved Apple place as a journey end, with the line shown under its name. */
export function placeFromResolved(r: ResolvedPlace, fallbackSubtitle: string | null): Place & { address?: string } {
  const address = r.address ?? fallbackSubtitle ?? undefined;
  return { kind: 'place', name: r.name, lat: r.lat, lng: r.lng, ...(address ? { address } : {}) };
}

// --- When -----------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const MYT_OFFSET_MS = 8 * HOUR_MS;
const SERVICE_DAY_OFFSET_MS = 4 * HOUR_MS;

/**
 * The latest "Depart at…" time: 04:00 MYT at the end of tomorrow's service
 * day. The service day turns over at 04:00 and the app holds today's and
 * tomorrow's networks (spec §3.5), so nothing later can be planned.
 */
export function networkEndMs(now: number): number {
  const d = new Date(now - SERVICE_DAY_OFFSET_MS + MYT_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2, 4) - MYT_OFFSET_MS;
}

/** "Depart at…" starts on the next five minutes from now. */
export function defaultDepartAt(now: number): number {
  const step = 5 * 60 * 1000;
  return Math.ceil((now + 60_000) / step) * step;
}

// --- Sections -------------------------------------------------------------

/** What a tap on a row turns into a journey end. */
export type PickTarget =
  | { kind: 'local'; hit: LocalHit }
  /** Not a journey end: opens the route's preview in the sheet. */
  | { kind: 'route'; hit: RouteHit }
  | { kind: 'place'; hit: PlaceHit }
  | { kind: 'ready'; place: Place & { address?: string } }
  | { kind: 'here' };

export type SearchItem =
  | { kind: 'row'; row: RowModel; target: PickTarget }
  | { kind: 'note'; symbol: SFSymbol | null; text: string };

export interface SearchSection {
  key: string;
  title: string | null;
  items: SearchItem[];
}

export type SearchView =
  | { kind: 'sections'; sections: SearchSection[] }
  | { kind: 'no-results'; query: string };

export const QUIET_EMPTY = 'Search for a station, a stop, a route or a place.';
export const NETWORK_PENDING = 'Stations appear once today’s timetable has downloaded.';
export const PLACES_OFFLINE = 'Places need a connection';

/** A saved place as a journey end: a stop or station keeps its id. */
export function placeFromSaved(p: SavedPlace): Place & { address?: string } {
  const address = p.address ?? undefined;
  return p.ref
    ? { kind: p.ref.kind, name: p.name, lat: p.lat, lng: p.lng, ref: p.ref.id, ...(address ? { address } : {}) }
    : { kind: 'place', name: p.name, lat: p.lat, lng: p.lng, ...(address ? { address } : {}) };
}

export interface SearchInput {
  query: string;
  /** Null while the network hasn't loaded. */
  local: LocalHit[] | null;
  /** Bus routes by code; empty while choosing a start. */
  routes: readonly RouteHit[];
  places: PlaceHit[];
  placesOffline: boolean;
  placesLoading: boolean;
  recents: { recent: RecentPlace; local: LocalHit | null }[];
  saved: readonly SavedPlace[];
  /** Editing From away from My location: offer it back first. */
  offerHere: boolean;
}

/**
 * The search state's sections (spec §6.2). Empty query: Recent, then Saved
 * (or one quiet line). Typing: Routes (a code like "T816"), then Stations
 * and stops, then Places (none for a whole route code).
 */
export function searchSections(i: SearchInput): SearchView {
  const q = i.query.trim();
  const sections: SearchSection[] = [];
  if (i.offerHere) {
    sections.push({ key: 'here', title: null, items: [{ kind: 'row', row: hereRow(), target: { kind: 'here' } }] });
  }

  if (q === '') {
    const recents = i.recents.slice(0, 6).map(
      ({ recent, local }): SearchItem => ({ kind: 'row', row: recentRow(recent, local), target: { kind: 'ready', place: recent } }),
    );
    const saved = savedInOrder(i.saved).map(
      (p): SearchItem => ({ kind: 'row', row: savedRow(p), target: { kind: 'ready', place: placeFromSaved(p) } }),
    );
    if (recents.length) sections.push({ key: 'recent', title: 'Recent', items: recents });
    if (saved.length) sections.push({ key: 'saved', title: 'Saved', items: saved });
    if (!recents.length && !saved.length) {
      sections.push({ key: 'quiet', title: null, items: [{ kind: 'note', symbol: null, text: QUIET_EMPTY }] });
    }
    return { kind: 'sections', sections };
  }

  const localItems: SearchItem[] =
    i.local == null
      ? [{ kind: 'note', symbol: null, text: NETWORK_PENDING }]
      : i.local.slice(0, MAX_LOCAL_ROWS).map((hit) => ({ kind: 'row', row: localRow(hit), target: { kind: 'local', hit } }));
  // A whole route code ("T816") is what you meant: places matching it are
  // postcodes abroad.
  const routeCode = i.routes.some((r) => code(r.label) === code(q));
  const placeItems: SearchItem[] = routeCode
    ? []
    : i.placesOffline
    ? [{ kind: 'note', symbol: 'wifi.slash', text: PLACES_OFFLINE }]
    : i.places.slice(0, MAX_PLACE_ROWS).map((hit) => ({ kind: 'row', row: placeRow(hit), target: { kind: 'place', hit } }));

  const routeItems = i.routes.map(
    (hit): SearchItem => ({ kind: 'row', row: routeRow(hit), target: { kind: 'route', hit } }),
  );

  if (routeItems.length === 0 && i.local != null && i.local.length === 0 && !i.placesOffline && i.places.length === 0 && !i.placesLoading) {
    return i.offerHere ? { kind: 'sections', sections } : { kind: 'no-results', query: q };
  }
  if (routeItems.length) sections.push({ key: 'routes', title: 'Routes', items: routeItems });
  if (localItems.length) sections.push({ key: 'local', title: 'Stations and stops', items: localItems });
  if (placeItems.length) sections.push({ key: 'places', title: 'Places', items: placeItems });
  return { kind: 'sections', sections };
}
