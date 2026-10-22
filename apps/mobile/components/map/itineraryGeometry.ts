import type { Itinerary, LatLng, Leg } from '@bus-tracker/shared';

import type { Coord, DrawLeg } from './drawOn';

/**
 * Where each itinerary leg runs on the map (plan 15/05), as plain data:
 * - a rail leg follows its line's stored shape (`rail_shapes`, 13/02),
 *   sliced between the two stations;
 * - a bus leg follows a known road shape for its route when there is one
 *   (the tracked route's), sliced the same way;
 * - otherwise a ride runs stop to stop (`[from, ...via, to]`);
 * - a walk follows Apple's walking path once loaded, else a straight line.
 * No React Native here, so it runs under `tsx --test`.
 */

type Ride = Extract<Leg, { kind: 'ride' }>;

/** At most this many walking paths per itinerary (spec §5: one `walk()` per walk leg, ≤ 4). */
export const MAX_WALK_PATHS = 4;
/** Shorter walks (a snap to the stop) stay a straight line: no request. */
export const MIN_WALK_PATH_M = 40;
/** A stop further than this from a shape isn't on it: the slice is refused. */
const MAX_OFF_SHAPE_M = 150;
/** A slice longer than this × the stop-to-stop path (+ slack) took a wrong pass of a looping shape. */
const MAX_DETOUR = 1.6;
const DETOUR_SLACK_M = 300;
const M_PER_DEG = 111_320;

const isBus = (l: Ride) => l.mode === 'bus' || l.mode === 'feeder';
const toCoord = (p: LatLng): Coord => ({ latitude: p.lat, longitude: p.lng });

export interface LegSources {
  /** `net.routes.id`, to find a rail leg's shape. */
  routeIds: readonly string[];
  /** Stored rail line shapes by network route id: lat, lng pairs. */
  railShapes?: ReadonlyMap<string, Float32Array>;
  /** Road shapes by bus route label ("T816"). */
  busShapes?: ReadonlyMap<string, readonly LatLng[]>;
  /** Apple walking paths for this itinerary, by leg index. */
  walkPaths?: Readonly<Record<number, readonly LatLng[]>>;
}

/** The legs to draw, one per itinerary leg, in order. */
export function itineraryDrawLegs(it: Itinerary, src: LegSources): DrawLeg[] {
  return it.legs.map((l, i) => {
    if (l.kind === 'walk') {
      const path = src.walkPaths?.[i];
      const coords = path && path.length >= 2 ? [l.from, ...path, l.to] : [l.from, l.to];
      return { kind: 'walk', coords: coords.map(toCoord), color: null };
    }
    const stops: LatLng[] = [l.from, ...l.via, l.to];
    let shape: readonly LatLng[] | null = null;
    if (isBus(l)) {
      shape = src.busShapes?.get(l.label) ?? null;
    } else {
      const flat = src.railShapes?.get(src.routeIds[l.route] ?? '');
      if (flat && flat.length >= 4) shape = unflatten(flat);
    }
    const sliced = shape ? sliceShape(shape, l.from, l.to, stops) : null;
    return {
      kind: isBus(l) ? 'bus' : 'rail',
      coords: (sliced ?? stops).map(toCoord),
      color: isBus(l) ? null : lineColor(l.color),
    };
  });
}

/** "#RRGGBB" whether or not the feed wrote the '#'. */
function lineColor(c: string): string {
  return /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : c;
}

function unflatten(flat: Float32Array): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ lat: flat[i], lng: flat[i + 1] });
  return out;
}

/** Local metres (equirectangular around `lat0`): exact to well under a metre across the Klang Valley. */
function projector(lat0: number) {
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  return (p: LatLng) => ({ x: p.lng * kx, y: p.lat * M_PER_DEG });
}

/** Where `p` falls along `shape`: segment index plus fraction, and how far off it is. */
function locate(shape: readonly LatLng[], p: LatLng, xy: ReturnType<typeof projector>): { pos: number; meters: number } {
  const q = xy(p);
  let best = { pos: 0, meters: Infinity };
  let a = xy(shape[0]);
  for (let i = 0; i + 1 < shape.length; i++) {
    const b = xy(shape[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
    if (d < best.meters) best = { pos: i + t, meters: d };
    a = b;
  }
  return best;
}

function pathMeters(path: readonly LatLng[], xy: ReturnType<typeof projector>): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    const a = xy(path[i - 1]);
    const b = xy(path[i]);
    m += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return m;
}

/**
 * The stretch of `shape` between `from` and `to`, starting and ending
 * exactly on them, in travel order (either direction of the shape). Null
 * when either end is off the shape, they meet at one point, or the stretch
 * is far longer than the stop-to-stop path (`stops`): a looping shape
 * matched on the wrong pass.
 */
export function sliceShape(shape: readonly LatLng[], from: LatLng, to: LatLng, stops: readonly LatLng[]): LatLng[] | null {
  if (shape.length < 2) return null;
  const xy = projector(from.lat);
  const a = locate(shape, from, xy);
  const b = locate(shape, to, xy);
  if (a.meters > MAX_OFF_SHAPE_M || b.meters > MAX_OFF_SHAPE_M) return null;
  if (Math.abs(a.pos - b.pos) < 1e-9) return null;
  const lo = Math.min(a.pos, b.pos);
  const hi = Math.max(a.pos, b.pos);
  const between: LatLng[] = [];
  for (let k = Math.floor(lo) + 1; k <= Math.ceil(hi) - 1; k++) between.push(shape[k]);
  if (a.pos > b.pos) between.reverse();
  const out = [from, ...between, to];
  if (pathMeters(out, xy) > MAX_DETOUR * pathMeters(stops, xy) + DETOUR_SLACK_M) return null;
  return out;
}

/** The walks to ask Apple for, in leg order: at least 40 m, at most four. */
export function walkRequests(it: Itinerary): { index: number; from: LatLng; to: LatLng }[] {
  const out: { index: number; from: LatLng; to: LatLng }[] = [];
  it.legs.forEach((l, index) => {
    if (l.kind !== 'walk' || l.meters < MIN_WALK_PATH_M || out.length >= MAX_WALK_PATHS) return;
    out.push({ index, from: { lat: l.from.lat, lng: l.from.lng }, to: { lat: l.to.lat, lng: l.to.lng } });
  });
  return out;
}
