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

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
