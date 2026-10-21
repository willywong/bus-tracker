import { projectOntoRoute, type LatLng } from '@bus-tracker/shared';

/**
 * The route cut where the bus is and where your stop is, so each stretch can
 * be drawn for what it means:
 * - `behind`: what the bus has already covered (ink),
 * - `ahead`: the bus's way to your stop (ink, with a travelling glint),
 * - `beyond`: past your stop, which doesn't concern you (light ink). Only
 *   when the bus is still before your stop in the shape's order: on a loop
 *   where it wraps round, the road between your stop and the bus is road it
 *   has just covered.
 *
 * Each is a list of runs because on a loop route the bus can be "before"
 * your stop by wrapping round the end of the shape.
 */
export interface RouteSplit {
  behind: LatLng[][];
  ahead: LatLng[][];
  beyond: LatLng[][];
}

interface Cut {
  index: number;
  t: number;
  point: LatLng;
}

function cut(point: LatLng, polyline: readonly LatLng[]): Cut {
  const p = projectOntoRoute(point, polyline);
  return { index: p.segmentIndex, t: p.progress, point: p.projected };
}

function before(a: Cut, b: Cut): boolean {
  return a.index < b.index || (a.index === b.index && a.t <= b.t);
}

/** The polyline between two cuts (from must not be after to). */
function slice(polyline: readonly LatLng[], from: Cut, to: Cut): LatLng[] {
  return [from.point, ...polyline.slice(from.index + 1, to.index + 1), to.point];
}

const START = (polyline: readonly LatLng[]): Cut => ({ index: 0, t: 0, point: polyline[0] });
const END = (polyline: readonly LatLng[]): Cut => ({
  index: polyline.length - 2,
  t: 1,
  point: polyline[polyline.length - 1],
});

/** Drops runs too short to draw. */
function runs(...rs: LatLng[][]): LatLng[][] {
  return rs.filter((r) => r.length >= 2);
}

export function splitRoute(
  polyline: readonly LatLng[],
  bus: LatLng | null,
  stop: LatLng | null,
): RouteSplit {
  if (polyline.length < 2) return { behind: [], ahead: [], beyond: [] };
  const start = START(polyline);
  const end = END(polyline);
  if (!stop) return { behind: runs([...polyline]), ahead: [], beyond: [] };
  const s = cut(stop, polyline);
  if (!bus) {
    return { behind: runs(slice(polyline, start, s)), ahead: [], beyond: runs(slice(polyline, s, end)) };
  }
  const b = cut(bus, polyline);
  if (before(b, s)) {
    return {
      behind: runs(slice(polyline, start, b)),
      ahead: runs(slice(polyline, b, s)),
      beyond: runs(slice(polyline, s, end)),
    };
  }
  // Loop: the bus reaches your stop by running to the end of the shape and
  // round from its start. Between your stop and the bus is road it has just
  // covered, so it stays ink; nothing is left "past your stop" on this lap.
  return {
    behind: runs(slice(polyline, s, b)),
    ahead: runs(slice(polyline, b, end), slice(polyline, start, s)),
    beyond: [],
  };
}
