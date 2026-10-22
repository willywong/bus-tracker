/** A point on a drawn line. */
export interface ShapePoint {
  lat: number;
  lng: number;
}

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

/**
 * Douglas–Peucker simplification: drops every point that lies within
 * `toleranceM` metres of the line between the points kept around it. The
 * first and last points are always kept, and kept points stay in order.
 *
 * Distances use a local equirectangular projection around the path's mean
 * latitude, which is exact to well under a metre across the Klang Valley.
 * Iterative (an explicit stack), so a long shape can't overflow the call stack.
 */
export function simplifyPath<P extends ShapePoint>(points: readonly P[], toleranceM = 5): P[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  let latSum = 0;
  for (const p of points) latSum += p.lat;
  const kx = M_PER_DEG * Math.cos(((latSum / n) * Math.PI) / 180);
  const ky = M_PER_DEG;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = points[i].lng * kx;
    y[i] = points[i].lat * ky;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    if (b - a < 2) continue;
    const ax = x[a];
    const ay = y[a];
    const dx = x[b] - ax;
    const dy = y[b] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD2 = tol2;
    for (let i = a + 1; i < b; i++) {
      // Distance to the segment a–b (to `a` itself when a and b coincide).
      let px = x[i] - ax;
      let py = y[i] - ay;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= t * dx;
        py -= t * dy;
      }
      const d2 = px * px + py * py;
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push(a, worst, worst, b);
  }

  const out: P[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}
