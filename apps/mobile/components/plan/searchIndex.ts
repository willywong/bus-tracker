import { haversineMeters, MODES, type RailStation, type TransitNetwork } from '@bus-tracker/shared';

import { formatStopName } from '@/components/map/format';
import { placeName } from '@/components/sheet/nearby/model';

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

// --- Routes -----------------------------------------------------------------

/** A bus route whose code matches the query, with where you'd board it. */
export interface RouteHit {
  /** Route index (the first, when routes share a code). */
  route: number;
  /** "T816". */
  label: string;
  longName: string;
  /** The direction and stop you'd board at: nearest to you, else the first stop. */
  pattern: number;
  fromStopIndex: number;
  stopName: string;
  /** The direction's last stop, as the route preview names it. */
  towards: string;
  /** From `near` to that stop, or null with no position. */
  meters: number | null;
}

/** Route codes a search shows at most. */
export const MAX_ROUTE_HITS = 4;

/** Bus and feeder routes have codes people type; rail lines are found by their stations. */
const CODED_MODES = new Set([MODES.indexOf('bus'), MODES.indexOf('feeder')]);

const compact = (s: string) => normalizeName(s).replace(/ /g, '');

/**
 * 0 the whole code ("t816"), 1 a code prefix ("t81"), 2 the number alone
 * ("816" for T816), -1 no match. A query needs a digit, so a name search
 * ("klcc") never lists routes.
 */
function codeTier(code: string, q: string): number {
  if (code === q) return 0;
  if (code.startsWith(q)) return 1;
  if (/^\d+$/.test(q) && code.replace(/^[a-z]+/, '').startsWith(q)) return 2;
  return -1;
}

/**
 * Bus routes whose code matches the query, best first: whole code, then
 * prefix, then number alone; then the nearer boarding stop; then the
 * shorter code. Routes sharing a code are one hit.
 */
export function searchRoutes(
  net: TransitNetwork,
  query: string,
  near: LatLng | null,
  limit = MAX_ROUTE_HITS,
): RouteHit[] {
  const q = compact(query);
  if (q === '' || q.length > 8 || !/\d/.test(q) || limit <= 0) return [];

  const byCode = new Map<string, { tier: number; routes: number[] }>();
  for (let r = 0; r < net.routes.count; r++) {
    if (!CODED_MODES.has(net.routes.mode[r])) continue;
    const code = compact(net.routes.label[r]);
    const tier = codeTier(code, q);
    if (tier < 0) continue;
    const found = byCode.get(code);
    if (found) found.routes.push(r);
    else byCode.set(code, { tier, routes: [r] });
  }
  if (byCode.size === 0) return [];

  const hits: (RouteHit & { tier: number })[] = [];
  for (const { tier, routes } of byCode.values()) {
    const board = boardingStop(net, new Set(routes), near);
    if (!board) continue;
    const route = net.patterns.route[board.pattern];
    hits.push({
      tier,
      route,
      label: net.routes.label[route],
      longName: net.routes.longName[route] ?? '',
      pattern: board.pattern,
      fromStopIndex: board.stop,
      stopName: placeName(net.stops.name[board.stop]),
      towards: placeName(net.stops.name[lastStop(net, board.pattern)]),
      meters: board.meters,
    });
  }
  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.meters ?? Number.POSITIVE_INFINITY) - (b.meters ?? Number.POSITIVE_INFINITY) ||
      a.label.length - b.label.length ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
  return hits.slice(0, limit).map(({ tier: _, ...hit }) => hit);
}

/** A pattern's last stop. */
function lastStop(net: TransitNetwork, p: number): number {
  return net.patterns.stops[net.patterns.stopStart[p] + net.patterns.stopLen[p] - 1];
}

/**
 * Where to board one of `routes`: the stop nearest `near` on any of their
 * patterns, never a pattern's last stop (nothing leaves it). With no
 * position, the first pattern's first stop.
 */
function boardingStop(
  net: TransitNetwork,
  routes: ReadonlySet<number>,
  near: LatLng | null,
): { pattern: number; stop: number; meters: number | null } | null {
  let best: { pattern: number; stop: number; meters: number | null } | null = null;
  for (let p = 0; p < net.patterns.count; p++) {
    if (!routes.has(net.patterns.route[p])) continue;
    const start = net.patterns.stopStart[p];
    const len = net.patterns.stopLen[p];
    if (len < 2) continue;
    if (!near) return { pattern: p, stop: net.patterns.stops[start], meters: null };
    for (let i = start; i < start + len - 1; i++) {
      const s = net.patterns.stops[i];
      const m = haversineMeters(near, stopPoint(net, s));
      if (!best || m < (best.meters ?? Number.POSITIVE_INFINITY)) best = { pattern: p, stop: s, meters: m };
    }
  }
  return best;
}
