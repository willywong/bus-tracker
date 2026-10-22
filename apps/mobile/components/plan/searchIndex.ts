import { haversineMeters, type RailStation, type TransitNetwork } from '@bus-tracker/shared';

import { formatStopName } from '@/components/map/format';

/**
 * Offline name search over the compiled network's stations and stops
 * (spec §5: local results come first, instantly and with no connection).
 * Pure, so it runs under `tsx --test`.
 */

export type LatLng = { lat: number; lng: number };

export type LocalHit =
  | {
      kind: 'station';
      /** `RailStation.id`, the slug `stationIndexById` takes. */
      id: string;
      name: string;
      lat: number;
      lng: number;
      /** Unique line colours, in line order. */
      lineColors: string[];
      lineCount: number;
    }
  | {
      kind: 'stop';
      /** Namespaced stop id (`kl:1005840`), the one `stopIndexById` takes. */
      id: string;
      name: string;
      lat: number;
      lng: number;
      /** At most {@link MAX_ROUTE_LABELS} labels; `routeCount` is the full count. */
      routes: string[];
      routeCount: number;
    };

/** Twin stops with the same name closer than this are one entry. */
export const TWIN_STOP_METERS = 150;
/** Route labels a stop hit carries; the rest is a count. */
export const MAX_ROUTE_LABELS = 3;

interface StationEntry {
  kind: 'station';
  norm: string;
  alt: string | null;
  station: RailStation;
}

interface StopEntry {
  kind: 'stop';
  norm: string;
  /** `norm` without a leading stop code ("kl94 klcc" → "klcc"), or null. */
  alt: string | null;
  /** Display case (`formatStopName`). */
  name: string;
  /** Stop indices sharing this name within {@link TWIN_STOP_METERS} of the first. */
  members: number[];
}

type Entry = StationEntry | StopEntry;

export interface LocalIndex {
  readonly net: TransitNetwork;
  readonly entries: readonly Entry[];
  /** For recents and saved places: `station:<id>` / `stop:<id>` → entry. */
  readonly byRef: ReadonlyMap<string, Entry>;
}

/** Lower case, accents folded, punctuation dropped, spaces collapsed. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A leading RapidKL stop code ("KL94 KLCC (Utara)"): names still rank by what follows. */
const STOP_CODE = /^[a-z]{1,3}\d+[a-z]? /;

function withoutCode(norm: string): string | null {
  const alt = norm.replace(STOP_CODE, '');
  return alt !== norm && alt !== '' ? alt : null;
}

function stopPoint(net: TransitNetwork, s: number): LatLng {
  return { lat: net.stops.lat[s], lng: net.stops.lon[s] };
}

/**
 * Builds the index: one entry per station, and one per stop name cluster.
 * Stops inside a station are left out (the station row covers them), and
 * same-named stops within 150 m (both sides of a road) share one entry.
 */
export function buildLocalIndex(net: TransitNetwork, stations: readonly RailStation[] = net.stations): LocalIndex {
  const entries: Entry[] = [];
  const byRef = new Map<string, Entry>();

  for (const station of stations) {
    const e: StationEntry = { kind: 'station', norm: normalizeName(station.name), alt: null, station };
    entries.push(e);
    byRef.set(`station:${station.id}`, e);
  }

  // Name → clusters of that name, each anchored on its first stop.
  const clustersByName = new Map<string, StopEntry[]>();
  for (let s = 0; s < net.stops.count; s++) {
    if (net.stops.station[s] >= 0) continue;
    const name = net.stops.name[s];
    const norm = normalizeName(name);
    if (norm === '') continue;
    let clusters = clustersByName.get(norm);
    if (!clusters) clustersByName.set(norm, (clusters = []));
    const p = stopPoint(net, s);
    let home = clusters.find((c) => haversineMeters(stopPoint(net, c.members[0]), p) <= TWIN_STOP_METERS);
    if (!home) {
      home = { kind: 'stop', norm, alt: withoutCode(norm), name: formatStopName(name), members: [] };
      clusters.push(home);
      entries.push(home);
    }
    home.members.push(s);
    byRef.set(`stop:${net.stops.id[s]}`, home);
  }

  return { net, entries, byRef };
}

const cache = new WeakMap<TransitNetwork, LocalIndex>();

/** {@link buildLocalIndex} once per network object (a new blob is a new object). */
export function localIndexFor(net: TransitNetwork): LocalIndex {
  let ix = cache.get(net);
  if (!ix) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    ix = buildLocalIndex(net);
    cache.set(net, ix);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      console.log(`[plan] local index ${ix.entries.length} entries in ${ms.toFixed(1)} ms`);
    }
  }
  return ix;
}

/** Unique route labels serving the stops, in first-seen order. */
function routeLabels(net: TransitNetwork, stops: readonly number[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of stops) {
    const start = net.stopRoutes.start[s];
    const len = net.stopRoutes.len[s];
    for (let i = start; i < start + len; i++) {
      const label = net.routes.label[net.patterns.route[net.stopRoutes.pattern[i]]];
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }
  }
  return out;
}

function nearestMember(net: TransitNetwork, members: readonly number[], near: LatLng | null): number {
  if (!near || members.length === 1) return members[0];
  let best = members[0];
  let bestM = Number.POSITIVE_INFINITY;
  for (const s of members) {
    const m = haversineMeters(near, stopPoint(net, s));
    if (m < bestM) {
      bestM = m;
      best = s;
    }
  }
  return best;
}

function toHit(ix: LocalIndex, e: Entry, near: LatLng | null): LocalHit {
  if (e.kind === 'station') {
    const st = e.station;
    const lineColors = [...new Set(st.lines.map((l) => l.color))];
    return {
      kind: 'station',
      id: st.id,
      name: st.name,
      lat: st.lat,
      lng: st.lng,
      lineColors,
      lineCount: new Set(st.lines.map((l) => l.name)).size,
    };
  }
  const s = nearestMember(ix.net, e.members, near);
  const routes = routeLabels(ix.net, e.members);
  return {
    kind: 'stop',
    id: ix.net.stops.id[s],
    name: e.name,
    lat: ix.net.stops.lat[s],
    lng: ix.net.stops.lon[s],
    routes: routes.slice(0, MAX_ROUTE_LABELS),
    routeCount: routes.length,
  };
}

/** The hit a saved or recent station / stop refers to, or null if it's gone from the network. */
export function lookupLocal(
  ix: LocalIndex,
  kind: 'station' | 'stop',
  id: string,
  near: LatLng | null = null,
): LocalHit | null {
  const e = ix.byRef.get(`${kind}:${id}`);
  if (!e) return null;
  const hit = toHit(ix, e, near);
  // A stop keeps the side it was saved with, not the nearer twin.
  if (hit.kind === 'stop' && hit.id !== id) {
    const s = e.kind === 'stop' ? e.members.find((m) => ix.net.stops.id[m] === id) : undefined;
    if (s != null) return { ...hit, id, lat: ix.net.stops.lat[s], lng: ix.net.stops.lon[s] };
  }
  return hit;
}

/** 0 whole-name prefix, 1 word prefix, 2 substring, -1 no match. */
function matchTier(norm: string, q: string): number {
  const at = norm.indexOf(q);
  if (at < 0) return -1;
  if (at === 0) return 0;
  if (norm[at - 1] === ' ' || norm.includes(` ${q}`)) return 1;
  return 2;
}

function entryPoint(ix: LocalIndex, e: Entry): LatLng {
  return e.kind === 'station' ? e.station : stopPoint(ix.net, e.members[0]);
}

/**
 * Stations and stops whose name contains the query, best first: whole-name
 * prefix, then word prefix, then substring. Within a tier stations come
 * first, then the nearer entry to `near`, then the shorter name.
 */
export function searchLocal(ix: LocalIndex, query: string, near: LatLng | null, limit = 6): LocalHit[] {
  const q = normalizeName(query);
  if (q === '' || limit <= 0) return [];
  const matches: { e: Entry; tier: number; meters: number }[] = [];
  for (const e of ix.entries) {
    let tier = matchTier(e.norm, q);
    if (e.alt != null) {
      const alt = matchTier(e.alt, q);
      if (alt >= 0 && (tier < 0 || alt < tier)) tier = alt;
    }
    if (tier < 0) continue;
    matches.push({ e, tier, meters: 0 });
  }
  if (near) {
    for (const m of matches) {
      const pts = m.e.kind === 'stop' ? m.e.members.map((s) => stopPoint(ix.net, s)) : [entryPoint(ix, m.e)];
      m.meters = Math.min(...pts.map((p) => haversineMeters(near, p)));
    }
  }
  matches.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.e.kind === b.e.kind ? 0 : a.e.kind === 'station' ? -1 : 1) ||
      a.meters - b.meters ||
      (a.e.alt ?? a.e.norm).length - (b.e.alt ?? b.e.norm).length ||
      (a.e.norm < b.e.norm ? -1 : a.e.norm > b.e.norm ? 1 : 0),
  );
  return matches.slice(0, limit).map((m) => toHit(ix, m.e, near));
}
