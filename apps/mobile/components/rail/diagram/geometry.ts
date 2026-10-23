import type { DiagramLine, DiagramStation } from './klRailDiagram';

/**
 * Drawing geometry for the schematic (plan 13/06), in diagram points (grid
 * units × `grid`, scale 1). Pure, so the renderer, the hit test and the
 * tests share it.
 *
 * Lines that share a run of stations (AG and SP from Sentul Timur to Chan
 * Sow Lin, the two KTM lines from Putra to KL Sentral) are drawn side by
 * side, `gap` apart, in `lines` order. Each shared segment takes its sides
 * from the first line through it, in that line's direction, so a bundle
 * doesn't twist where it bends.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LinePath {
  code: string;
  color: string;
  /** One polyline per branch. */
  branches: Point[][];
}

export interface StationMarker {
  id: string;
  /** Centre, in diagram points. */
  x: number;
  y: number;
  /** Single line: its colour. Two or more: null (an ink-bordered pill). */
  color: string | null;
  width: number;
  height: number;
  /** An interchange rather than a stop on a shared run: its label stays at low zoom. */
  interchange: boolean;
}

/** A shared run's lines sit this far apart, centre to centre. */
export const BUNDLE_GAP = 8;
/** Side of a single-line station square. */
export const STOP_SIZE = 8;
/** Paper around the lines inside a multi-line station's pill. */
const PILL_PAD = 5;
/** Smallest multi-line pill side. */
const PILL_MIN = 12;
/** Past this, a corner is cut rather than mitred. */
const MITER_LIMIT = 3;

const segKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface SegInfo {
  /** Canonical direction: the first line's, from `from` to the other end. */
  from: string;
  /** Codes through this segment, in `lines` order. */
  codes: string[];
}

function segments(lines: readonly DiagramLine[]): Map<string, SegInfo> {
  const out = new Map<string, SegInfo>();
  for (const line of lines) {
    for (const branch of line.branches) {
      for (let i = 1; i < branch.length; i++) {
        const k = segKey(branch[i - 1], branch[i]);
        const seg = out.get(k);
        if (!seg) out.set(k, { from: branch[i - 1], codes: [line.code] });
        else if (!seg.codes.includes(line.code)) seg.codes.push(line.code);
      }
    }
  }
  return out;
}

/** Every line's branches as offset polylines, in diagram points. */
export function linePaths(
  stations: readonly DiagramStation[],
  lines: readonly DiagramLine[],
  grid: number,
  gap = BUNDLE_GAP,
): LinePath[] {
  const at = new Map(stations.map((s) => [s.id, { x: s.x * grid, y: s.y * grid }]));
  const segs = segments(lines);

  // The offset of `code` on segment a→b, as a vector.
  const offset = (code: string, a: string, b: string): Point => {
    const seg = segs.get(segKey(a, b))!;
    const n = seg.codes.length;
    if (n < 2) return { x: 0, y: 0 };
    const [p, q] = seg.from === a ? [at.get(a)!, at.get(b)!] : [at.get(b)!, at.get(a)!];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    // Right-hand normal of the canonical direction (y down).
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const k = (seg.codes.indexOf(code) - (n - 1) / 2) * gap;
    return { x: nx * k, y: ny * k };
  };

  return lines.map((line) => ({
    code: line.code,
    color: line.color,
    branches: line.branches.map((ids) => {
      const pts: Point[] = [];
      for (let i = 0; i < ids.length; i++) {
        const p = at.get(ids[i])!;
        const before = i > 0 ? offset(line.code, ids[i - 1], ids[i]) : null;
        const after = i < ids.length - 1 ? offset(line.code, ids[i], ids[i + 1]) : null;
        if (!before || !after) {
          const o = before ?? after ?? { x: 0, y: 0 };
          pts.push({ x: p.x + o.x, y: p.y + o.y });
          continue;
        }
        const a = at.get(ids[i - 1])!;
        const b = at.get(ids[i + 1])!;
        const corner = miter(p, before, { x: p.x - a.x, y: p.y - a.y }, after, { x: b.x - p.x, y: b.y - p.y });
        if (corner && Math.hypot(corner.x - p.x, corner.y - p.y) <= MITER_LIMIT * gap) {
          pts.push(corner);
        } else {
          // Straight on with a change of slot, or too sharp: step across at the station.
          pts.push({ x: p.x + before.x, y: p.y + before.y }, { x: p.x + after.x, y: p.y + after.y });
        }
      }
      return pts;
    }),
  }));
}

/** Where the two offset lines through `p` meet, or null when they're parallel. */
function miter(p: Point, o1: Point, d1: Point, o2: Point, d2: Point): Point | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-9) {
    return Math.abs(o1.x - o2.x) < 1e-9 && Math.abs(o1.y - o2.y) < 1e-9 ? { x: p.x + o1.x, y: p.y + o1.y } : null;
  }
  // p + o1 + t·d1 = p + o2 + u·d2
  const rx = o2.x - o1.x;
  const ry = o2.y - o1.y;
  const t = (rx * d2.y - ry * d2.x) / cross;
  return { x: p.x + o1.x + t * d1.x, y: p.y + o1.y + t * d1.y };
}

/** Codes of the lines calling at each station. */
export function linesByStation(lines: readonly DiagramLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of lines) {
    for (const branch of line.branches) {
      for (const id of branch) {
        const codes = out.get(id) ?? [];
        if (!codes.includes(line.code)) codes.push(line.code);
        out.set(id, codes);
      }
    }
  }
  return out;
}

/**
 * Stations where riders change: two or more lines that don't simply run
 * through together, plus either end of a walking link. A stop on a shared
 * run (Sultan Ismail on AG and SP) isn't one.
 */
export function interchangeIds(
  lines: readonly DiagramLine[],
  links: readonly (readonly [string, string])[] = [],
): Set<string> {
  const neighbours = new Map<string, Map<string, Set<string>>>();
  for (const line of lines) {
    for (const branch of line.branches) {
      branch.forEach((id, i) => {
        const byLine = neighbours.get(id) ?? new Map<string, Set<string>>();
        const set = byLine.get(line.code) ?? new Set<string>();
        if (i > 0) set.add(branch[i - 1]);
        if (i < branch.length - 1) set.add(branch[i + 1]);
        byLine.set(line.code, set);
        neighbours.set(id, byLine);
      });
    }
  }
  const out = new Set<string>();
  for (const [id, byLine] of neighbours) {
    if (byLine.size < 2) continue;
    const keys = [...byLine.values()].map((s) => [...s].sort().join('|'));
    if (keys.some((k) => k !== keys[0])) out.add(id);
  }
  for (const [a, b] of links) {
    out.add(a);
    out.add(b);
  }
  return out;
}

/** One marker per station, sized to the lines through it. */
export function stationMarkers(
  stations: readonly DiagramStation[],
  lines: readonly DiagramLine[],
  paths: readonly LinePath[],
  grid: number,
  links: readonly (readonly [string, string])[] = [],
): StationMarker[] {
  const served = linesByStation(lines);
  const interchanges = interchangeIds(lines, links);
  const colorOf = new Map(lines.map((l) => [l.code, l.color]));
  // Every drawn vertex near a station, so a pill spans the bundle there.
  const verts = paths.flatMap((p) => p.branches.flat());
  return stations.map((s) => {
    const x = s.x * grid;
    const y = s.y * grid;
    const codes = served.get(s.id) ?? [];
    if (codes.length < 2) {
      return {
        id: s.id,
        x,
        y,
        color: codes.length === 1 ? colorOf.get(codes[0])! : null,
        width: STOP_SIZE,
        height: STOP_SIZE,
        interchange: interchanges.has(s.id),
      };
    }
    let minX = x;
    let maxX = x;
    let minY = y;
    let maxY = y;
    for (const v of verts) {
      if (Math.abs(v.x - x) > BUNDLE_GAP * 2 || Math.abs(v.y - y) > BUNDLE_GAP * 2) continue;
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    return {
      id: s.id,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      color: null,
      width: Math.max(PILL_MIN, maxX - minX + PILL_PAD * 2),
      height: Math.max(PILL_MIN, maxY - minY + PILL_PAD * 2),
      interchange: interchanges.has(s.id),
    };
  });
}
