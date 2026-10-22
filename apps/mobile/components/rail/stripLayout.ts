/**
 * Geometry of the line strip map (plan 13/04): where each station's bead
 * sits, where a train is between two beads, and which runs to mount for the
 * part of the strip on screen. Pure, so the worklets and the tests share it.
 */

/** Row height at the default text size; rows grow with Dynamic Type and are then measured. */
export const ROW_H = 56;
/** At most this many estimated trains are mounted at once. */
export const MAX_TRAINS = 12;
/**
 * How far ahead the mounted set must stay right: JS recomputes it on the
 * 15 s tick and on scroll end, so a train entering the viewport in between
 * is already mounted.
 */
export const LOOKAHEAD_SEC = 20;

/** Centre of row `i` at the default row height. */
export function beadY(i: number): number {
  return i * ROW_H + ROW_H / 2;
}

/**
 * The y of a train `r` seconds into its run: linear between the beads, so it
 * crosses each segment in the template run time. Clamped to the ends.
 */
export function yAtRun(r: number, offsets: readonly number[], ys: readonly number[]): number {
  const n = Math.min(offsets.length, ys.length);
  if (n === 0) return 0;
  if (r <= offsets[0]) return ys[0];
  for (let i = 1; i < n; i++) {
    if (r <= offsets[i]) {
      const span = offsets[i] - offsets[i - 1];
      const f = span > 0 ? (r - offsets[i - 1]) / span : 1;
      return ys[i - 1] + (ys[i] - ys[i - 1]) * f;
    }
  }
  return ys[n - 1];
}

/**
 * Indices into `runs` (departures from the first stop, service seconds,
 * ascending) whose train is on the line and inside the viewport ± one row at
 * some point in `[t, t + LOOKAHEAD_SEC]`. At most `MAX_TRAINS`: past that,
 * the ones nearest the viewport's centre. Returned ascending.
 *
 * The plan sketched this as `{ kMin, count }` over a phase that wraps at the
 * headway. Runs here are absolute departures, which also covers trains
 * still running from an earlier window and timetabled KTM trips.
 */
export function slotWindow(
  runs: readonly number[],
  t: number,
  totalRunSec: number,
  offsets: readonly number[],
  ys: readonly number[],
  viewTopY: number,
  viewBottomY: number,
  rowH = ROW_H,
): number[] {
  const top = viewTopY - rowH;
  const bottom = viewBottomY + rowH;
  const hits: Array<{ i: number; d: number }> = [];
  const centre = (viewTopY + viewBottomY) / 2;
  for (let i = 0; i < runs.length; i++) {
    const r = t - runs[i];
    if (r + LOOKAHEAD_SEC < 0 || r > totalRunSec) continue;
    const y0 = yAtRun(Math.max(0, r), offsets, ys);
    const y1 = yAtRun(Math.min(totalRunSec, r + LOOKAHEAD_SEC), offsets, ys);
    if (Math.max(y0, y1) < top || Math.min(y0, y1) > bottom) continue;
    hits.push({ i, d: Math.abs((y0 + y1) / 2 - centre) });
  }
  if (hits.length > MAX_TRAINS) hits.sort((a, b) => a.d - b.d || a.i - b.i).length = MAX_TRAINS;
  return hits.map((h) => h.i).sort((a, b) => a - b);
}
