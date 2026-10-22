/**
 * The itinerary's draw-on (spec §7.1, plan 15/05) as plain data. MapKit
 * re-adds an overlay on every prop change, so instead of growing each
 * leg's `Polyline` on a 60 Hz timer the legs are cut into a few chunks,
 * each mounted once at its time and never changed. No React Native or
 * Reanimated here, so it runs under `tsx --test`.
 */

export type Coord = { latitude: number; longitude: number };

/** One leg as the map draws it. */
export interface DrawLeg {
  kind: 'walk' | 'bus' | 'rail';
  coords: Coord[];
  /** The line colour for rail; null for a bus or walk (ink). */
  color: string | null;
}

/** Points `from`..`to` (inclusive) of leg `leg`, mounted `atMs` after the draw starts. */
export interface DrawChunk {
  leg: number;
  from: number;
  to: number;
  atMs: number;
}

/** The whole draw, origin to destination. */
export const DRAW_MS = 650;
/** At most this many chunks per ride leg… */
export const MAX_CHUNKS_PER_LEG = 6;
/** …and in total: each is one more MapKit overlay. */
export const MAX_CHUNKS = 24;

/** `EASE_OUT` in `theme/design.ts`: cubic-bezier(0.23, 1, 0.32, 1). */
const X1 = 0.23;
const Y1 = 1;
const X2 = 0.32;
const Y2 = 1;

const bez = (s: number, p1: number, p2: number) => 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;

/**
 * The time fraction at which the `EASE_OUT` curve reaches `progress`: the
 * inverse of the easing, so a chunk ending at that share of the line lands
 * when an eased stroke would reach it. Solved by bisection on the curve's
 * parameter (its progress is monotonic).
 */
export function easeOutTimeAt(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, Y1, Y2) < progress) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, X1, X2);
}

/**
 * When each chunk of each leg is mounted, in mount order.
 * - A walk is one chunk at 0 ms: it appears at once.
 * - Ride legs share `totalMs` in leg order, in proportion to their point
 *   counts. The stroke follows the `EASE_OUT` curve, and a chunk lands once
 *   the stroke reaches its end, so the last lands at `totalMs`.
 * - A ride gets at most 6 chunks; all chunks together stay within 24.
 *   Consecutive chunks share their joining point, so there are no gaps.
 * - `reduceMotion` puts everything at 0.
 * Legs with fewer than two points draw nothing.
 */
export function drawSchedule(
  legs: readonly { kind: DrawLeg['kind']; points: number }[],
  totalMs: number = DRAW_MS,
  reduceMotion = false,
): DrawChunk[] {
  const out: DrawChunk[] = [];
  const rides: number[] = [];
  let walks = 0;
  legs.forEach((l, i) => {
    if (l.points < 2) return;
    if (l.kind === 'walk') {
      out.push({ leg: i, from: 0, to: l.points - 1, atMs: 0 });
      walks++;
    } else {
      rides.push(i);
    }
  });
  if (rides.length === 0) return out;

  const budget = Math.max(rides.length, MAX_CHUNKS - walks);
  const per = Math.max(1, Math.min(MAX_CHUNKS_PER_LEG, Math.floor(budget / rides.length)));
  const totalSegments = rides.reduce((n, i) => n + legs[i].points - 1, 0);
  let done = 0;
  for (const i of rides) {
    const segments = legs[i].points - 1;
    const k = Math.min(per, segments);
    let from = 0;
    for (let j = 1; j <= k; j++) {
      const to = Math.round((j * segments) / k);
      const atMs = reduceMotion ? 0 : Math.round(totalMs * easeOutTimeAt((done + to) / totalSegments));
      out.push({ leg: i, from, to, atMs });
      from = to;
    }
    done += segments;
  }
  // Stable: walks (at 0) first, then the rides in leg order.
  return out.sort((a, b) => a.atMs - b.atMs);
}
