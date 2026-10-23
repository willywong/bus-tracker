import type { DiagramLine, DiagramStation } from './klRailDiagram';
import type { Rect } from './viewport';

/**
 * Line filtering for the schematic: which lines the chips pick, what that
 * leaves drawn in full, and the box the camera fits to. Pure, so the
 * renderer, the chips and the tests share it.
 *
 * A selection is a set of `DiagramLine.code`s. Empty means every line, the
 * map as it opens; otherwise only the picked lines keep their colour and
 * names, and the rest fade back.
 */
export type LineSelection = ReadonlySet<string>;

export const ALL_LINES: LineSelection = new Set();

/** The selection with `code` picked or unpicked. Picking the last unpicked line goes back to all. */
export function toggleLine(sel: LineSelection, code: string, lineCount: number): LineSelection {
  const next = new Set(sel);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  return next.size >= lineCount ? ALL_LINES : next;
}

export function lineShown(sel: LineSelection, code: string): boolean {
  return sel.size === 0 || sel.has(code);
}

/** Stations on at least one shown line. */
export function shownStations(sel: LineSelection, lines: readonly DiagramLine[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    if (!lineShown(sel, line.code)) continue;
    for (const branch of line.branches) for (const id of branch) out.add(id);
  }
  return out;
}

/** Diagram label size, so the fitted box holds the names as well as the dots. */
export const LABEL_FONT_SIZE = 11;
/** Average glyph advance of the label face at 11 pt, a little generous. */
const LABEL_ADVANCE = 6.4;
const LABEL_ASCENT = 9;
const LABEL_DESCENT = 3;
/** Room round a station's dot. */
const DOT_PAD = 8;

export type { Rect };

/** A label's box in diagram points: anchored at the station plus its offset, `dy` to the baseline. */
export function labelRect(s: DiagramStation, grid: number): Rect | null {
  if (!s.label) return null;
  const w = s.name.length * LABEL_ADVANCE;
  const ax = s.x * grid + s.label.dx;
  const x = s.label.anchor === 'start' ? ax : s.label.anchor === 'end' ? ax - w : ax - w / 2;
  return {
    x,
    y: s.y * grid + s.label.dy - LABEL_ASCENT,
    width: w,
    height: LABEL_ASCENT + LABEL_DESCENT,
  };
}

/**
 * The box round every station on the shown lines and their names, in
 * diagram points, or null when nothing is shown. `labelGrowth` is how much
 * bigger than 11 pt the names are drawn at the scale being fitted
 * (`placeLabels`), each grown about its station.
 */
export function selectionBounds(
  sel: LineSelection,
  stations: readonly DiagramStation[],
  lines: readonly DiagramLine[],
  grid: number,
  labelGrowth = 1,
): Rect | null {
  const ids = shownStations(sel, lines);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (r: Rect) => {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  };
  for (const s of stations) {
    if (!ids.has(s.id)) continue;
    take({
      x: s.x * grid - DOT_PAD,
      y: s.y * grid - DOT_PAD,
      width: DOT_PAD * 2,
      height: DOT_PAD * 2,
    });
    const r = labelRect(s, grid);
    if (!r) continue;
    const cx = s.x * grid;
    const cy = s.y * grid;
    const k = labelGrowth;
    take({
      x: cx + (r.x - cx) * k,
      y: cy + (r.y - cy) * k,
      width: r.width * k,
      height: r.height * k,
    });
  }
  return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** `color` (#RRGGBB) a fraction `k` of the way to `toward` (#RRGGBB): a faded line on paper. */
export function mixHex(color: string, toward: string, k: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(ch(color, i) + (ch(toward, i) - ch(color, i)) * k);
    out += v.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/** "LRT KJ" → "KJ"; KTM lines, whose codes are names, → "KTM". */
export function chipBadge(line: Pick<DiagramLine, 'code'>): string {
  if (line.code.startsWith('KTM')) return 'KTM';
  const parts = line.code.trim().split(/\s+/);
  return parts[parts.length - 1] || line.code;
}

/** "Kelana Jaya Line" → "Kelana Jaya", "Komuter Port Klang Line" → "Port Klang", "KL Monorail Line" → "Monorail". */
export function chipName(line: Pick<DiagramLine, 'name'>): string {
  return line.name.replace(/\s+Line$/, '').replace(/^(Komuter|KL)\s+/, '');
}

/**
 * The network route (`net.routes.id`, the `/line` param) a diagram line runs
 * as. Rapid KL routes are labelled with the code's last word ("KJ"), KTM
 * routes with the whole code ("KTM Seremban").
 */
export function routeIdOfLine(
  routes: { count: number; id: readonly string[]; label: readonly string[] },
  code: string,
): string | null {
  const short = code.trim().split(/\s+/).pop();
  for (let r = 0; r < routes.count; r++) {
    if (routes.label[r] === code) return routes.id[r];
  }
  for (let r = 0; r < routes.count; r++) {
    if (routes.label[r] === short && !code.startsWith('KTM')) return routes.id[r];
  }
  return null;
}
