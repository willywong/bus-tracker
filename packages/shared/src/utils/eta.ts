import type { VehiclePosition } from "../types/bus.js";
import {
  distanceAlongRoute,
  polylineLength,
  projectOntoRoute,
  type LatLng,
  type RouteProjection,
} from "./route.js";

export const DEFAULT_DWELL_MINUTES_PER_STOP = 1.5;

export type ApproachVerdict = "approaching" | "departing" | "unknown";

export interface ApproachEvaluation {
  verdict: ApproachVerdict;
  /** Signed forward distance in meters from bus → stop (loop-aware). */
  forwardMeters: number;
  /** Dot product between bus heading and polyline tangent at bus position. */
  headingDot: number;
}

export interface EvaluateApproachArgs {
  bus: VehiclePosition;
  /** Optional previous observation of the same bus — used to derive heading when `bus.bearing` is missing. */
  previousBus?: Pick<VehiclePosition, "lat" | "lng">;
  stop: LatLng;
  polyline: readonly LatLng[];
  /** Whether the route loops (T816 is circular). Default: true. */
  loop?: boolean;
  /** Max off-route distance in meters before verdict drops to 'unknown'. Default: 500. */
  maxOffRouteMeters?: number;
  /** Forward distance in meters below which we treat the bus as already passed (for non-loop). Default: 25. */
  justPassedMeters?: number;
}

/**
 * Decides whether a bus position is approaching (vs. departing) the user's stop.
 *
 * A bus is approaching when:
 *   - its heading points the same direction as the polyline tangent at its
 *     current projection (dot product > 0), AND
 *   - its forward distance along the route to the stop is positive.
 *
 * For circular routes (`loop: true`), a bus that just passed the stop will
 * still have a large positive `forwardMeters` (wraps around the loop) — the
 * heading check is what prevents a wrong-direction bus from being picked.
 */
export function evaluateApproach(args: EvaluateApproachArgs): ApproachEvaluation {
  const {
    bus,
    previousBus,
    stop,
    polyline,
    loop = true,
    maxOffRouteMeters = 500,
    justPassedMeters = 25,
  } = args;

  const busProj = projectOntoRoute({ lat: bus.lat, lng: bus.lng }, polyline);
  const stopProj = projectOntoRoute(stop, polyline);

  if (busProj.offRouteMeters > maxOffRouteMeters) {
    return { verdict: "unknown", forwardMeters: 0, headingDot: 0 };
  }

  const tangent = tangentAt(busProj, polyline);
  const heading = busHeading(bus, previousBus);
  const headingDot = heading ? dot2(heading, tangent) : NaN;

  const forwardMeters = distanceAlongRoute(busProj, stopProj, polyline, { loop });

  if (!Number.isFinite(headingDot)) {
    // No heading info — fall back to pure geometry.
    const approaching = loop
      ? forwardMeters > 0 && forwardMeters < polylineLength(polyline) - justPassedMeters
      : forwardMeters > justPassedMeters;
    return {
      verdict: approaching ? "approaching" : "departing",
      forwardMeters,
      headingDot: 0,
    };
  }

  if (headingDot <= 0) {
    return { verdict: "departing", forwardMeters, headingDot };
  }

  if (!loop && forwardMeters < justPassedMeters) {
    return { verdict: "departing", forwardMeters, headingDot };
  }

  return { verdict: "approaching", forwardMeters, headingDot };
}

/**
 * Convenience: pick the vehicle with the smallest forward-distance to the
 * stop among those classified as approaching. Returns null if none qualify.
 */
export interface PickApproachingVehicleArgs {
  vehicles: VehiclePosition[];
  previousByVehicleId?: Map<string, Pick<VehiclePosition, "lat" | "lng">>;
  stop: LatLng;
  polyline: readonly LatLng[];
  loop?: boolean;
  maxOffRouteMeters?: number;
}

export interface PickedVehicle {
  vehicle: VehiclePosition;
  evaluation: ApproachEvaluation;
}

export function pickApproachingVehicle(
  args: PickApproachingVehicleArgs,
): PickedVehicle | null {
  const { vehicles, previousByVehicleId, stop, polyline, loop, maxOffRouteMeters } =
    args;
  let best: PickedVehicle | null = null;
  for (const v of vehicles) {
    const evaluation = evaluateApproach({
      bus: v,
      previousBus: previousByVehicleId?.get(v.vehicleId),
      stop,
      polyline,
      loop,
      maxOffRouteMeters,
    });
    if (evaluation.verdict !== "approaching") continue;
    if (!best || evaluation.forwardMeters < best.evaluation.forwardMeters) {
      best = { vehicle: v, evaluation };
    }
  }
  return best;
}

export type EtaSource = "traffic" | "schedule";

export interface ComputeEtaArgs {
  /** Live vehicles. */
  vehicles: VehiclePosition[];
  /** Optional previous position by vehicleId (enables heading fallback). */
  previousByVehicleId?: Map<string, Pick<VehiclePosition, "lat" | "lng">>;
  /** User's destination stop. */
  stop: LatLng;
  /** Route polyline. */
  polyline: readonly LatLng[];
  /** All other stops on the route (for intermediate stop counting). */
  intermediateCandidates: readonly LatLng[];
  /** Current traffic minutes from HERE for (bus → stop). Null when unavailable. */
  trafficMinutes: number | null;
  /** Whether the route is circular. Default: true. */
  loop?: boolean;
  /** Passenger dwell time per intermediate stop in minutes. Default: 1.5. */
  dwellMinutesPerStop?: number;
}

export interface ComputeEtaResult {
  minutesToStop: number | null;
  vehicleId: string | null;
  source: EtaSource | null;
  /** Forward distance bus → stop, in meters. Null when no approaching vehicle. */
  forwardMeters: number | null;
  /** The picked vehicle's projection on the polyline (for callers that want to hit /traffic-eta). */
  busProjection: RouteProjection | null;
  /** The user's stop's projection on the polyline. */
  stopProjection: RouteProjection;
}

/**
 * Pure composition of the ETA pipeline.
 *
 * - If no vehicle is approaching → returns `source: null`, `minutesToStop: null`
 *   (caller can choose to fall back to a schedule lookup).
 * - If `trafficMinutes` is provided → adds dwell buffer → returns `source: 'traffic'`.
 * - If `trafficMinutes` is null (traffic API unavailable) → returns `source: 'schedule'`
 *   with `minutesToStop: null` so the caller can fill in a schedule value.
 */
export function computeEta(args: ComputeEtaArgs): ComputeEtaResult {
  const {
    vehicles,
    previousByVehicleId,
    stop,
    polyline,
    intermediateCandidates,
    trafficMinutes,
    loop = true,
    dwellMinutesPerStop,
  } = args;

  const stopProjection = projectOntoRoute(stop, polyline);

  const picked = pickApproachingVehicle({
    vehicles,
    previousByVehicleId,
    stop,
    polyline,
    loop,
  });

  if (!picked) {
    return {
      minutesToStop: null,
      vehicleId: null,
      source: null,
      forwardMeters: null,
      busProjection: null,
      stopProjection,
    };
  }

  const busProjection = projectOntoRoute(
    { lat: picked.vehicle.lat, lng: picked.vehicle.lng },
    polyline,
  );
  const forwardMeters = picked.evaluation.forwardMeters;

  if (trafficMinutes == null) {
    return {
      minutesToStop: null,
      vehicleId: picked.vehicle.vehicleId,
      source: "schedule",
      forwardMeters,
      busProjection,
      stopProjection,
    };
  }

  const dwell = dwellMinutes({
    bus: busProjection,
    stop: stopProjection,
    intermediateCandidates,
    polyline,
    loop,
    minutesPerStop: dwellMinutesPerStop,
  });

  return {
    minutesToStop: Math.max(0, trafficMinutes + dwell),
    vehicleId: picked.vehicle.vehicleId,
    source: "traffic",
    forwardMeters,
    busProjection,
    stopProjection,
  };
}

export interface CountIntermediateStopsArgs {
  bus: RouteProjection;
  stop: RouteProjection;
  intermediateCandidates: readonly LatLng[];
  polyline: readonly LatLng[];
  loop?: boolean;
}

/**
 * Count stops on the route that lie strictly between the bus and the target
 * stop along the direction of travel. Stops at either endpoint are excluded.
 */
export function countIntermediateStops(args: CountIntermediateStopsArgs): number {
  const { bus, stop, intermediateCandidates, polyline, loop = true } = args;
  const target = distanceAlongRoute(bus, stop, polyline, { loop });
  if (target <= 0) return 0;
  let count = 0;
  for (const candidate of intermediateCandidates) {
    const proj = projectOntoRoute(candidate, polyline);
    const forward = distanceAlongRoute(bus, proj, polyline, { loop });
    if (forward > 0 && forward < target) count++;
  }
  return count;
}

export interface DwellMinutesArgs extends CountIntermediateStopsArgs {
  minutesPerStop?: number;
}

/**
 * Buffer minutes to add to the raw drive time to account for passenger
 * loading at each intermediate stop.
 */
export function dwellMinutes(args: DwellMinutesArgs): number {
  const minutesPerStop = args.minutesPerStop ?? DEFAULT_DWELL_MINUTES_PER_STOP;
  return countIntermediateStops(args) * minutesPerStop;
}

/** Unit tangent vector (metres-scaled, then normalised) along the polyline at `proj`. */
function tangentAt(
  proj: RouteProjection,
  polyline: readonly LatLng[],
): { x: number; y: number } {
  const a = polyline[proj.segmentIndex];
  const b = polyline[proj.segmentIndex + 1];
  const meanLat = (a.lat + b.lat) / 2;
  const lngM = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const dx = (b.lng - a.lng) * lngM;
  const dy = (b.lat - a.lat) * 110_540;
  return normalise({ x: dx, y: dy });
}

/** Unit heading vector in local metre-space (x east, y north). */
function busHeading(
  bus: VehiclePosition,
  previous?: Pick<VehiclePosition, "lat" | "lng">,
): { x: number; y: number } | null {
  if (typeof bus.bearing === "number" && Number.isFinite(bus.bearing)) {
    // GTFS-RT bearing is degrees clockwise from north.
    const rad = (bus.bearing * Math.PI) / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
  }
  if (previous) {
    const meanLat = (bus.lat + previous.lat) / 2;
    const lngM = 111_320 * Math.cos((meanLat * Math.PI) / 180);
    const dx = (bus.lng - previous.lng) * lngM;
    const dy = (bus.lat - previous.lat) * 110_540;
    if (Math.hypot(dx, dy) < 1) return null;
    return normalise({ x: dx, y: dy });
  }
  return null;
}

function dot2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

function normalise(v: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(v.x, v.y);
  if (m === 0) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}
