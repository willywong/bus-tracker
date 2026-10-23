/**
 * Pan and zoom maths for the schematic (plan 13/06). A transform maps a
 * diagram point p (points at scale 1) to the screen as `x + scale · p`, with
 * the transform origin at the diagram's top left. Every function is a
 * worklet, so the gesture callbacks run them on the UI thread; they're plain
 * functions elsewhere, so the tests can call them too.
 */

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A box in diagram points. */
export interface Rect extends Size {
  x: number;
  y: number;
}

/** The viewport, and how much of its top and bottom the header and home indicator cover. */
export interface Viewport extends Size {
  top: number;
  bottom: number;
}

/** Zoom range. Below MIN_SCALE only as far as the whole network needs (`fitTransform`). */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 4;
/** Paper round the whole network when it's fitted. */
const FIT_PAD = 12;

// Worklets capture the functions they call when the module loads, and the
// worklet transform turns declarations into constants, so a worklet must
// come after every worklet it calls.

export function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
}

/** The whole diagram, centred in the uncovered part of the view. */
export function fitTransform(content: Size, view: Viewport): Transform {
  'worklet';
  const w = Math.max(1, view.width - FIT_PAD * 2);
  const h = Math.max(1, view.height - view.top - view.bottom - FIT_PAD * 2);
  const scale = Math.min(MAX_SCALE, w / content.width, h / content.height);
  return {
    scale,
    x: (view.width - content.width * scale) / 2,
    y: view.top + (view.height - view.top - view.bottom - content.height * scale) / 2,
  };
}

/** The smallest scale: 0.6, or less when the whole network needs it. */
export function minScale(content: Size, view: Viewport): number {
  'worklet';
  return Math.min(MIN_SCALE, fitTransform(content, view).scale);
}

/**
 * Translation bounds on one axis, so at least a quarter of the diagram (or of
 * the screen, once the diagram is bigger) stays in view.
 */
export function translateBounds(contentLen: number, viewLen: number, scale: number): [number, number] {
  'worklet';
  const len = contentLen * scale;
  const keep = Math.min(len, viewLen) / 4;
  return [keep - len, viewLen - keep];
}

export function clampTransform(t: Transform, content: Size, view: Viewport): Transform {
  'worklet';
  const [x0, x1] = translateBounds(content.width, view.width, t.scale);
  const [y0, y1] = translateBounds(content.height, view.height, t.scale);
  return { scale: t.scale, x: clamp(t.x, x0, x1), y: clamp(t.y, y0, y1) };
}

/**
 * `t` zoomed by `factor` about screen point (`fx`, `fy`), which stays put,
 * with the scale held to [lo, hi] and the result clamped.
 */
export function zoomAbout(
  t: Transform,
  factor: number,
  fx: number,
  fy: number,
  content: Size,
  view: Viewport,
  lo: number,
  hi?: number,
): Transform {
  'worklet';
  // In the body, not a default parameter: worklets don't capture names used there.
  const scale = clamp(t.scale * factor, lo, hi ?? MAX_SCALE);
  const k = scale / t.scale;
  return clampTransform({ scale, x: fx - (fx - t.x) * k, y: fy - (fy - t.y) * k }, content, view);
}

/** Most a fitted selection zooms in, so a short line doesn't fill the screen with one stop. */
export const FIT_MAX_SCALE = 1.6;

/**
 * Box `r` (diagram points) centred in the uncovered part of the view, as big
 * as fits up to `FIT_MAX_SCALE` and no smaller than `floor` (by default the
 * whole diagram fitted). Clamped like a pan.
 */
export function fitRectTransform(r: Rect, content: Size, view: Viewport, floor?: number): Transform {
  'worklet';
  const w = Math.max(1, view.width - FIT_PAD * 2);
  const h = Math.max(1, view.height - view.top - view.bottom - FIT_PAD * 2);
  const lo = floor ?? Math.min(MAX_SCALE, w / content.width, h / content.height);
  const scale = Math.max(lo, Math.min(FIT_MAX_SCALE, w / Math.max(1, r.width), h / Math.max(1, r.height)));
  const cy = view.top + (view.height - view.top - view.bottom) / 2;
  const t = { scale, x: view.width / 2 - (r.x + r.width / 2) * scale, y: cy - (r.y + r.height / 2) * scale };
  return clampTransform(t, content, view);
}

/** Diagram point (`px`, `py`) centred in the uncovered part of the view at `scale`. */
export function centreOn(px: number, py: number, scale: number, content: Size, view: Viewport): Transform {
  'worklet';
  const cy = view.top + (view.height - view.top - view.bottom) / 2;
  return clampTransform({ scale, x: view.width / 2 - px * scale, y: cy - py * scale }, content, view);
}

/** The diagram point under screen point (`sx`, `sy`). */
export function toDiagram(t: Transform, sx: number, sy: number): { x: number; y: number } {
  'worklet';
  return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
}
