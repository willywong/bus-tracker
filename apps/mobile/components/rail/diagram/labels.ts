import type { DiagramLine, DiagramStation } from './klRailDiagram';
import {
  LABEL_FONT_SIZE,
  labelRect,
  shownStations,
  type LineSelection,
  type Rect,
  selectionBounds,
} from './lineFilter';
import { fitRectTransform, type Size, type Transform, type Viewport } from './viewport';

/**
 * Station names that stay legible as the schematic zooms out (plan 13/06,
 * the line-filter redesign). At scale 0.9 and up every name is drawn where
 * it was placed by hand, 11 pt. Further out each name grows against the
 * zoom so it stays about 10 pt on screen, and the ones that would overlap
 * an already placed name are left out: interchanges first, then the ends of
 * each line, then every other stop before the rest, so a line keeps an even
 * spread of names rather than a clump at one end.
 *
 * Only stations on the shown lines are named. The scale comes in steps
 * (`labelStep`), so the SVG re-renders a handful of times through a pinch,
 * never per frame.
 */

/** At and above this scale, names are drawn at 11 pt where they were placed. */
export const LABEL_FULL_SCALE = 0.9;
/** Screen gap kept between two names. */
const LABEL_GAP = 2;
/** Each label step is this much smaller than the last. */
const STEP = 1.25;

export interface PlacedLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fontSize: number;
  bold: boolean;
}

/**
 * `scale` rounded down to a label step: LABEL_FULL_SCALE, then ÷1.25 per
 * step. A worklet, so the gesture reaction can compare steps.
 */
export function labelStep(scale: number): number {
  'worklet';
  if (scale >= LABEL_FULL_SCALE) return LABEL_FULL_SCALE;
  const n = Math.ceil(Math.log(LABEL_FULL_SCALE / scale) / Math.log(STEP) - 1e-9);
  return LABEL_FULL_SCALE / Math.pow(STEP, n);
}

/** How much bigger than 11 pt names are drawn at label step `step`. */
export function labelGrowth(step: number): number {
  return step >= LABEL_FULL_SCALE ? 1 : LABEL_FULL_SCALE / step;
}

const overlaps = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.width + pad &&
  b.x < a.x + a.width + pad &&
  a.y < b.y + b.height + pad &&
  b.y < a.y + a.height + pad;

const inside = (r: Rect, f: Rect) =>
  r.x >= f.x && r.y >= f.y && r.x + r.width <= f.x + f.width && r.y + r.height <= f.y + f.height;

/** The station with its name on the other side, or null for a centred name. */
function flip(s: DiagramStation): DiagramStation | null {
  const l = s.label!;
  if (l.anchor === 'middle') return null;
  return { ...s, label: { dx: -l.dx, dy: l.dy, anchor: l.anchor === 'start' ? 'end' : 'start' } };
}

/**
 * The part of the drawing a transform shows between the header and the
 * bars, in diagram points, `pad` screen points in from each edge: the frame
 * a fitted view keeps its names inside.
 */
export function visibleRect(t: Transform, view: Viewport, pad = 6): Rect {
  return {
    x: (pad - t.x) / t.scale,
    y: (view.top + pad - t.y) / t.scale,
    width: (view.width - pad * 2) / t.scale,
    height: (view.height - view.top - view.bottom - pad * 2) / t.scale,
  };
}

/** `r` grown by `k` about (`cx`, `cy`). */
const grow = (r: Rect, cx: number, cy: number, k: number): Rect => ({
  x: cx + (r.x - cx) * k,
  y: cy + (r.y - cy) * k,
  width: r.width * k,
  height: r.height * k,
});

export function placeLabels(
  stations: readonly DiagramStation[],
  lines: readonly DiagramLine[],
  interchanges: ReadonlySet<string>,
  sel: LineSelection,
  step: number,
  grid: number,
  frame: Rect | null = null,
): PlacedLabel[] {
  const shown = shownStations(sel, lines);
  const k = labelGrowth(step);

  // Rank: interchange 0, line end 1, even stop 2, odd stop 3; ties keep line order.
  const rank = new Map<string, number>();
  const order: string[] = [];
  for (const line of lines) {
    if (sel.size > 0 && !sel.has(line.code)) continue;
    for (const branch of line.branches) {
      branch.forEach((id, i) => {
        const r = interchanges.has(id)
          ? 0
          : i === 0 || i === branch.length - 1
            ? 1
            : i % 2 === 0
              ? 2
              : 3;
        if (!rank.has(id)) order.push(id);
        rank.set(id, Math.min(rank.get(id) ?? r, r));
      });
    }
  }
  const at = new Map(stations.map((s) => [s.id, s]));
  const candidates = order
    .map((id, i) => ({ s: at.get(id)!, r: rank.get(id)!, i }))
    .filter((c) => c.s && c.s.label && shown.has(c.s.id))
    .sort((a, b) => a.r - b.r || a.i - b.i);

  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [];
  const pad = LABEL_GAP / step;
  for (const { s: station } of candidates) {
    let s = station;
    const cx = s.x * grid;
    const cy = s.y * grid;
    const boxOf = (st: DiagramStation) => grow(labelRect(st, grid)!, cx, cy, k);
    let box = boxOf(s);
    if (frame && !inside(box, frame)) {
      // Across the screen edge: try the station's other side, else leave it out.
      const flipped = flip(s);
      if (!flipped || !inside(boxOf(flipped), frame)) continue;
      s = flipped;
      box = boxOf(s);
    }
    if (k > 1) {
      if (taken.some((t) => overlaps(t, box, pad))) continue;
      taken.push(box);
    }
    const label = s.label!;
    placed.push({
      id: s.id,
      name: s.name,
      x: cx + label.dx * k,
      y: cy + label.dy * k,
      anchor: label.anchor,
      fontSize: LABEL_FONT_SIZE * k,
      bold: interchanges.has(s.id),
    });
  }
  return placed;
}

/**
 * The picked lines fitted with their names in the uncovered part of `view`.
 * Names grow as the fit zooms out, which widens the box, so try each label
 * step from the largest down and take the first whose fitted scale draws
 * names no bigger than the box allowed for. Null when nothing is picked.
 */
export function fitWithLabels(
  sel: LineSelection,
  stations: readonly DiagramStation[],
  lines: readonly DiagramLine[],
  grid: number,
  content: Size,
  view: Viewport,
): Transform | null {
  let t: Transform | null = null;
  for (let step = LABEL_FULL_SCALE; step > 0.05; step = labelStep(step * 0.99)) {
    const box = selectionBounds(sel, stations, lines, grid, labelGrowth(step));
    if (!box) return null;
    t = fitRectTransform(box, content, view);
    if (labelStep(t.scale) >= step) return t;
  }
  return t;
}
