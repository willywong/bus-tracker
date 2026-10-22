import { DIAGRAM_STATIONS, GRID, type DiagramStation } from './klRailDiagram';

/** Tap radius in screen points: a 44 pt target at every zoom. */
export const TAP_RADIUS = 22;

/**
 * The station nearest diagram point (`x`, `y`), in points at scale 1, if it's
 * within `TAP_RADIUS / scale` of it; otherwise null. The radius shrinks as the
 * diagram grows, so the target stays 44 pt on screen. Pure, so it can run
 * on the JS side of a tap and in tests.
 */
export function nearestStation(
  x: number,
  y: number,
  scale: number,
  stations: readonly DiagramStation[] = DIAGRAM_STATIONS,
  grid = GRID,
): string | null {
  const radius = TAP_RADIUS / Math.max(scale, 1e-6);
  let best: string | null = null;
  let bestD2 = radius * radius;
  for (const s of stations) {
    const dx = s.x * grid - x;
    const dy = s.y * grid - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = s.id;
    }
  }
  return best;
}
