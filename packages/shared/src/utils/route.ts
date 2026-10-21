import { haversineMeters } from "./outlier.js";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteProjection {
  /** Index of the segment (polyline[i] → polyline[i+1]) the point projects onto. */
  segmentIndex: number;
  /** Position along the segment in [0, 1]. */
  progress: number;
  /** Foot of perpendicular on the polyline. */
  projected: LatLng;
  /** Straight-line distance from the input point to `projected`, in meters. */
  offRouteMeters: number;
  /** Distance along the polyline from `projected` to the last point. */
  remainingMeters: number;
}

const LAT_DEG_METERS = 110_540;

function lngDegMeters(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Projects `point` onto the closest segment of `polyline` using a local
 * equirectangular approximation (valid for urban-scale distances).
 *
 * Segment lengths for `remainingMeters` are computed with haversine so
 * the result is accurate along long polylines.
 */
export function projectOntoRoute(
  point: LatLng,
  polyline: readonly LatLng[],
): RouteProjection {
  if (polyline.length < 2) {
    throw new Error("projectOntoRoute: polyline must have at least 2 points");
  }

  let bestIndex = 0;
  let bestT = 0;
  let bestProjected: LatLng = polyline[0];
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const meanLat = (a.lat + b.lat) / 2;
    const lngM = lngDegMeters(meanLat);

    const ax = a.lng * lngM;
    const ay = a.lat * LAT_DEG_METERS;
    const bx = b.lng * lngM;
    const by = b.lat * LAT_DEG_METERS;
    const px = point.lng * lngM;
    const py = point.lat * LAT_DEG_METERS;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);

    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const d = Math.hypot(px - fx, py - fy);

    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
      bestT = t;
      bestProjected = { lat: fy / LAT_DEG_METERS, lng: fx / lngM };
    }
  }

  const segLen = haversineMeters(polyline[bestIndex], polyline[bestIndex + 1]);
  let remaining = (1 - bestT) * segLen;
  for (let i = bestIndex + 1; i < polyline.length - 1; i++) {
    remaining += haversineMeters(polyline[i], polyline[i + 1]);
  }

  return {
    segmentIndex: bestIndex,
    progress: bestT,
    projected: bestProjected,
    offRouteMeters: bestDist,
    remainingMeters: remaining,
  };
}

/**
 * Forward-only distance in meters along `polyline` from projection `from` to
 * projection `to`. If `to` is before `from` and `loop` is true, the distance
 * wraps around the end of the polyline back to the beginning.
 *
 * For a non-loop polyline where `to` is before `from`, returns a negative
 * number (caller should treat that as "bus has already passed the stop").
 */
export function distanceAlongRoute(
  from: RouteProjection,
  to: RouteProjection,
  polyline: readonly LatLng[],
  opts: { loop?: boolean } = {},
): number {
  const forward = signedForward(from, to, polyline);
  if (forward >= 0) return forward;
  if (!opts.loop) return forward;
  const total = polylineLength(polyline);
  return total + forward;
}

function signedForward(
  from: RouteProjection,
  to: RouteProjection,
  polyline: readonly LatLng[],
): number {
  if (from.segmentIndex === to.segmentIndex) {
    const segLen = haversineMeters(
      polyline[from.segmentIndex],
      polyline[from.segmentIndex + 1],
    );
    return (to.progress - from.progress) * segLen;
  }

  if (to.segmentIndex < from.segmentIndex) {
    return -signedForward(to, from, polyline);
  }

  const fromSeg = haversineMeters(
    polyline[from.segmentIndex],
    polyline[from.segmentIndex + 1],
  );
  let meters = (1 - from.progress) * fromSeg;
  for (let i = from.segmentIndex + 1; i < to.segmentIndex; i++) {
    meters += haversineMeters(polyline[i], polyline[i + 1]);
  }
  const toSeg = haversineMeters(
    polyline[to.segmentIndex],
    polyline[to.segmentIndex + 1],
  );
  meters += to.progress * toSeg;
  return meters;
}

/** Total length of `polyline` in meters. */
export function polylineLength(polyline: readonly LatLng[]): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += haversineMeters(polyline[i], polyline[i + 1]);
  }
  return total;
}

/**
 * Returns the LatLng that lies `distanceMeters` along `polyline` from its
 * start. With `loop: true`, distances are taken modulo polyline length so a
 * value past the end wraps back to the beginning. Without `loop`, values are
 * clamped to the endpoints.
 */
export function pointAlongRoute(
  polyline: readonly LatLng[],
  distanceMeters: number,
  opts: { loop?: boolean } = {},
): LatLng {
  if (polyline.length < 2) {
    throw new Error("pointAlongRoute: polyline must have at least 2 points");
  }
  const total = polylineLength(polyline);
  let d = distanceMeters;
  if (opts.loop && total > 0) {
    d = ((d % total) + total) % total;
  } else {
    if (d <= 0) return polyline[0];
    if (d >= total) return polyline[polyline.length - 1];
  }
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = haversineMeters(a, b);
    if (d <= segLen) {
      const t = segLen === 0 ? 0 : d / segLen;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    d -= segLen;
  }
  return polyline[polyline.length - 1];
}

/** How far a GPS fix may sit from the route line and still be drawn on it. */
export const SNAP_MAX_OFF_ROUTE_M = 60;

export interface RouteSnap {
  /** Where to draw the bus: on the line when snapped, else the raw point. */
  point: LatLng;
  /**
   * Heading in degrees clockwise from north. When snapped with a heading
   * hint, the direction of the route segment the bus is on; otherwise the
   * hint unchanged (undefined without one).
   */
  bearing: number | undefined;
  snapped: boolean;
}

/**
 * Pulls a bus position onto the route line, so a fix that drifted off the
 * road (GPS noise, a coarse shape, or a stop pin set back from the kerb) is
 * still drawn in the lane. Positions farther than `maxOffMeters` are left
 * where they are: the bus is genuinely off the route (a detour, a depot).
 *
 * With a `heading` hint (the bus's GPS bearing), segments running the other
 * way are passed over when one running with it is in range, so on a road
 * the route uses in both directions the bus lands on its own side's trip
 * and its arrow follows the road instead of the jittery GPS bearing.
 */
export function snapToRoute(
  point: LatLng,
  polyline: readonly LatLng[],
  opts: { heading?: number; maxOffMeters?: number } = {},
): RouteSnap {
  const maxOff = opts.maxOffMeters ?? SNAP_MAX_OFF_ROUTE_M;
  const heading =
    typeof opts.heading === "number" && Number.isFinite(opts.heading) ? opts.heading : undefined;
  const unsnapped: RouteSnap = { point, bearing: heading, snapped: false };
  if (polyline.length < 2) return unsnapped;

  let nearest: { at: LatLng; dist: number } | null = null;
  let aligned: { at: LatLng; dist: number; bearing: number } | null = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const { at, dist, bearing } = projectOntoSegment(point, a, b);
    if (!nearest || dist < nearest.dist) nearest = { at, dist };
    if (
      heading != null &&
      bearing != null &&
      angleBetween(bearing, heading) <= 90 &&
      (!aligned || dist < aligned.dist)
    ) {
      aligned = { at, dist, bearing };
    }
  }

  if (aligned && aligned.dist <= maxOff) {
    return { point: aligned.at, bearing: aligned.bearing, snapped: true };
  }
  if (nearest && nearest.dist <= maxOff) {
    return { point: nearest.at, bearing: heading, snapped: true };
  }
  return unsnapped;
}

function projectOntoSegment(
  point: LatLng,
  a: LatLng,
  b: LatLng,
): { at: LatLng; dist: number; bearing: number | null } {
  const lngM = lngDegMeters((a.lat + b.lat) / 2);
  const ax = a.lng * lngM;
  const ay = a.lat * LAT_DEG_METERS;
  const dx = b.lng * lngM - ax;
  const dy = b.lat * LAT_DEG_METERS - ay;
  const px = point.lng * lngM;
  const py = point.lat * LAT_DEG_METERS;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const fx = ax + t * dx;
  const fy = ay + t * dy;
  return {
    at: { lat: fy / LAT_DEG_METERS, lng: fx / lngM },
    dist: Math.hypot(px - fx, py - fy),
    bearing: lenSq === 0 ? null : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
  };
}

/** Smallest angle between two headings, in [0, 180]. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
