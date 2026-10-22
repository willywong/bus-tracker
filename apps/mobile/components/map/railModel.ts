import {
  FEED_IDS,
  MODES,
  RAIL_LINES,
  RAIL_STATIONS,
  type Mode,
  type RailLine,
  type RailStation,
  type TransitNetwork,
} from '@bus-tracker/shared';

/**
 * The map's rail layer as plain data (plan 13/02): which lines to draw, in
 * which colour and through which points, and which station squares to show.
 * `RailLayer` renders it; nothing here touches React Native.
 */

export type Coord = { latitude: number; longitude: number };

export interface RailLineDraw {
  /**
   * Network `routes.id` ('rail:KJ', 'ktm:…'). Lines drawn from the bundled
   * `RAIL_STATIONS` fallback (no network) use the line's code ('LRT KJ').
   */
  routeId: string;
  /** Official line colour, '#RRGGBB'. */
  color: string;
  coords: Coord[];
}

/** One station square: a dot per line colour. */
export interface RailStationDraw {
  /** `RailStation.id`, the `station` param of `/station`. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Distinct official line colours, '#RRGGBB', one dot each. */
  colors: string[];
  /** Served by more than one line: shown at every zoom, `displayPriority` high. */
  interchange: boolean;
  /** VoiceOver: "Kelana Jaya Line and Kajang Line station, Pasar Seni". */
  label: string;
}

/** Below this zoom, lines fade to 35% so the streets read. */
export const RAIL_DIM_BELOW_ZOOM = 11;
/** From this zoom, every station shows; below it, interchanges only. */
export const RAIL_ALL_STATIONS_FROM_ZOOM = 12;

const RAIL_MODES: ReadonlySet<Mode> = new Set<Mode>(['lrt', 'mrt', 'monorail', 'brt', 'ktm']);
const RAIL_FEED = FEED_IDS.indexOf('rail');
const FALLBACK_COLOR = '#8A8A8E';

/** `#RRGGBB`, so an alpha suffix can go on the end. */
function hex6(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(color)) return `#${color.toUpperCase()}`;
  return FALLBACK_COLOR;
}

/** Whether `net` has the rail feed's routes in it (it is left out when expired). */
export function hasRailFeed(net: TransitNetwork | null): boolean {
  if (!net) return false;
  for (let r = 0; r < net.routes.count; r++) if (net.routes.feed[r] === RAIL_FEED) return true;
  return false;
}

/**
 * Every rail line to draw, in network route order.
 * - A rail route with a stored shape draws that shape.
 * - KTM (no shapes.txt), or a route whose shape isn't stored yet, draws
 *   straight segments between the stops of its longest pattern.
 * - With no network (first launch offline) or the rail feed left out, the
 *   rail lines come from the bundled `RAIL_STATIONS`, each line's stations in
 *   the order of their codes (KJ1…KJ37, KG18A after KG18).
 */
export function railLines(
  net: TransitNetwork | null,
  shapes: ReadonlyMap<string, Float32Array>,
): RailLineDraw[] {
  const out: RailLineDraw[] = [];
  if (net) {
    const longest = longestPatterns(net);
    for (let r = 0; r < net.routes.count; r++) {
      if (!RAIL_MODES.has(MODES[net.routes.mode[r]])) continue;
      const routeId = net.routes.id[r];
      const color = hex6(net.routes.color[r]);
      const shape = shapes.get(routeId);
      if (shape && shape.length >= 4) {
        out.push({ routeId, color, coords: shapeCoords(shape) });
        continue;
      }
      const p = longest.get(r);
      if (p === undefined) continue;
      const P = net.patterns;
      const coords: Coord[] = [];
      for (let s = 0; s < P.stopLen[p]; s++) {
        const stop = P.stops[P.stopStart[p] + s];
        coords.push({ latitude: net.stops.lat[stop], longitude: net.stops.lon[stop] });
      }
      if (coords.length >= 2) out.push({ routeId, color, coords });
    }
  }
  if (!hasRailFeed(net)) out.unshift(...fallbackLines());
  return out;
}

/** Per route, its pattern with the most stops (the first such, on a tie). */
function longestPatterns(net: TransitNetwork): Map<number, number> {
  const P = net.patterns;
  const best = new Map<number, number>();
  for (let p = 0; p < P.count; p++) {
    const r = P.route[p];
    const b = best.get(r);
    if (b === undefined || P.stopLen[p] > P.stopLen[b]) best.set(r, p);
  }
  return best;
}

function shapeCoords(shape: Float32Array): Coord[] {
  const coords: Coord[] = [];
  for (let i = 0; i + 1 < shape.length; i += 2) {
    coords.push({ latitude: shape[i], longitude: shape[i + 1] });
  }
  return coords;
}

/** The letters that start a line's station codes: 'LRT KJ' → 'KJ', 'BRT' → 'BRT'. */
function linePrefix(line: RailLine): string {
  return line.code.split(' ').pop() ?? line.code;
}

/** Each bundled line through its stations in code order. */
function fallbackLines(): RailLineDraw[] {
  const out: RailLineDraw[] = [];
  for (const line of RAIL_LINES) {
    const re = new RegExp(`^${linePrefix(line)}(\\d+)([A-Z]*)$`);
    const calls: { num: number; suffix: string; station: RailStation }[] = [];
    for (const station of RAIL_STATIONS) {
      if (!station.lines.some((l) => l.code === line.code)) continue;
      for (const id of station.stopIds) {
        const m = re.exec(id);
        if (m) {
          calls.push({ num: Number(m[1]), suffix: m[2], station });
          break;
        }
      }
    }
    calls.sort((a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix));
    if (calls.length < 2) continue;
    out.push({
      routeId: line.code,
      color: hex6(line.color),
      coords: calls.map(({ station }) => ({ latitude: station.lat, longitude: station.lng })),
    });
  }
  return out;
}

/**
 * The stations to mark: the network's (rail and KTM) when it has the rail
 * feed; otherwise the bundled `RAIL_STATIONS` plus whatever KTM stations the
 * network has.
 */
export function railStationsFor(net: TransitNetwork | null): readonly RailStation[] {
  if (net && hasRailFeed(net)) return net.stations;
  return net ? [...RAIL_STATIONS, ...net.stations] : RAIL_STATIONS;
}

/** "LRT Kelana Jaya Line" → "Kelana Jaya Line", as a rider says it. */
export function spokenLineName(name: string): string {
  return name.replace(/^(LRT|MRT|BRT)\s+/, '');
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function railStationMarks(stations: readonly RailStation[]): RailStationDraw[] {
  return stations.map((s) => {
    const colors = [...new Set(s.lines.map((l) => hex6(l.color)))];
    const names = [...new Set(s.lines.map((l) => spokenLineName(l.name)))];
    return {
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      colors,
      interchange: names.length > 1,
      label: names.length > 0 ? `${joinAnd(names)} station, ${s.name}` : `Rail station, ${s.name}`,
    };
  });
}

/**
 * The stations to mark under a focus: only those on a focused line (matched
 * by line colour, since a mark carries colours, not route ids), so the 15%
 * lines don't keep full-strength squares. No focus: every station.
 */
export function stationsInFocus(
  stations: readonly RailStationDraw[],
  lines: readonly RailLineDraw[],
  focus: readonly string[] | null,
): readonly RailStationDraw[] {
  if (!focus) return stations;
  const colors = new Set(lines.filter((l) => focus.includes(l.routeId)).map((l) => l.color.toUpperCase()));
  return stations.filter((s) => s.colors.some((c) => colors.has(c.toUpperCase())));
}

/**
 * Alpha suffix for a line's `#RRGGBB`. A focus (an itinerary's lines) keeps
 * its routes full and drops the rest to 15%; otherwise lines are full, or
 * 35% when zoomed out (`dim`).
 */
export function railAlpha(
  routeId: string,
  focus: readonly string[] | null,
  dim: boolean,
): 'FF' | '59' | '26' {
  if (focus) return focus.includes(routeId) ? 'FF' : '26';
  return dim ? '59' : 'FF';
}

/** Web-Mercator zoom level of a region `longitudeDelta` wide on a `widthPts` wide map. */
export function zoomFromRegion(longitudeDelta: number, widthPts: number): number {
  return Math.log2((360 * (widthPts / 256)) / longitudeDelta);
}

/** 0: below 11 (dim, interchanges), 1: 11–12 (interchanges), 2: 12 and up (all stations). */
export type RailZoomBand = 0 | 1 | 2;

export function railZoomBand(zoom: number): RailZoomBand {
  if (!(zoom >= RAIL_DIM_BELOW_ZOOM)) return 0;
  return zoom >= RAIL_ALL_STATIONS_FROM_ZOOM ? 2 : 1;
}
