import type {
  OccupancyStatus,
  RouteId,
  VehiclePosition,
  VehicleStopStatus,
} from "../types/bus.js";
import type { DecodedEntity, DecodedFeed } from "./protobuf.js";

const VEHICLE_STOP_STATUSES = new Set<string>([
  "INCOMING_AT",
  "STOPPED_AT",
  "IN_TRANSIT_TO",
]);

const OCCUPANCY_STATUSES = new Set<string>([
  "EMPTY",
  "MANY_SEATS_AVAILABLE",
  "FEW_SEATS_AVAILABLE",
  "STANDING_ROOM_ONLY",
  "CRUSHED_STANDING_ROOM_ONLY",
  "FULL",
  "NOT_ACCEPTING_PASSENGERS",
  "NO_DATA_AVAILABLE",
  "NOT_BOARDABLE",
]);

function asStopStatus(v: string | undefined): VehicleStopStatus | undefined {
  return v && VEHICLE_STOP_STATUSES.has(v)
    ? (v as VehicleStopStatus)
    : undefined;
}

function asOccupancy(v: string | undefined): OccupancyStatus | undefined {
  return v && OCCUPANCY_STATUSES.has(v) ? (v as OccupancyStatus) : undefined;
}

function asWheelchair(v: number | undefined): 0 | 1 | 2 | undefined {
  // GTFS-RT enum: 0=NO_VALUE, 1=UNKNOWN, 2=WHEELCHAIR_ACCESSIBLE, 3=WHEELCHAIR_INACCESSIBLE.
  // Map to the simpler stops.txt shape: 0=no info, 1=accessible, 2=not accessible.
  if (v === 2) return 1;
  if (v === 3) return 2;
  return undefined;
}

export type TripRouteMap = ReadonlyMap<string, RouteId>;

/**
 * Extracts VehiclePositions for the routes present in `tripToRoute`.
 *
 * Drops entities that:
 * - are marked `is_deleted`
 * - have no `vehicle.position.latitude/longitude`
 * - have no `vehicle.trip.trip_id`, OR whose `trip_id` isn't in the map
 *   AND whose `trip.route_id` isn't in `allowedRouteCodes`.
 *
 * Resolution order for the route code: tripToRoute lookup first, then a
 * fallback to `vehicle.trip.route_id` when it matches `allowedRouteCodes`.
 * The fallback exists because Prasarana's GTFS feeds use date-prefixed
 * trip_ids (e.g. `260313010076S10`) and the realtime feed rotates that
 * date prefix daily, so static-vs-realtime trip_ids drift apart whenever
 * the static bundle is older than the current service day. The realtime
 * `trip.route_id` is the route short-name (e.g. "T816") and matches the
 * `routes.code` we store on-device.
 *
 * `observedAt` is the entity's per-vehicle `timestamp` (seconds → ms)
 * when present, otherwise the caller-provided `fallbackNow`.
 */
export function entitiesToPositions(
  feed: DecodedFeed,
  tripToRoute: TripRouteMap,
  fallbackNow: number,
  allowedRouteCodes?: ReadonlySet<RouteId>,
): VehiclePosition[] {
  const out: VehiclePosition[] = [];
  for (const entity of feed.entity) {
    const pos = toPosition(entity, tripToRoute, fallbackNow, allowedRouteCodes);
    if (pos) out.push(pos);
  }
  return out;
}

function toPosition(
  entity: DecodedEntity,
  tripToRoute: TripRouteMap,
  fallbackNow: number,
  allowedRouteCodes?: ReadonlySet<RouteId>,
): VehiclePosition | null {
  if (entity.is_deleted) return null;
  const v = entity.vehicle;
  if (!v || !v.position || !v.trip?.trip_id) return null;

  let routeId = tripToRoute.get(v.trip.trip_id);
  if (!routeId) {
    const fallback = v.trip.route_id as RouteId | undefined;
    if (fallback && allowedRouteCodes?.has(fallback)) {
      routeId = fallback;
    }
  }
  if (!routeId) return null;

  const { latitude, longitude, bearing, speed } = v.position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // Prasarana publishes `speed` in km/h despite the GTFS-RT spec calling for
  // m/s; pass the value through unchanged and keep the unit as km/h in
  // `VehiclePosition`. See VehiclePosition.speed for the full rationale.

  const vehicleId =
    v.vehicle?.id ?? v.vehicle?.label ?? entity.id ?? v.trip.trip_id;

  const observedAt =
    typeof v.timestamp === "number" && v.timestamp > 0
      ? v.timestamp * 1000
      : fallbackNow;

  const currentStopSequence =
    typeof v.current_stop_sequence === "number" && v.current_stop_sequence >= 0
      ? v.current_stop_sequence
      : undefined;
  const occupancyPercentage =
    typeof v.occupancy_percentage === "number" &&
    v.occupancy_percentage >= 0 &&
    v.occupancy_percentage <= 100
      ? v.occupancy_percentage
      : undefined;

  return {
    vehicleId,
    tripId: v.trip.trip_id,
    routeId,
    lat: latitude,
    lng: longitude,
    bearing: Number.isFinite(bearing) ? bearing : undefined,
    speed: Number.isFinite(speed) ? speed : undefined,
    observedAt,
    currentStopSequence,
    currentStopId: v.stop_id || undefined,
    currentStatus: asStopStatus(v.current_status),
    occupancyStatus: asOccupancy(v.occupancy_status),
    occupancyPercentage,
    wheelchairAccessible: asWheelchair(v.vehicle?.wheelchair_accessible),
  };
}

/** A fix older than this no longer says where the bus is. */
export const MAX_FIX_AGE_MS = 10 * 60_000;
/** Allow for small clock skew between the bus transponder and the phone. */
export const MAX_FIX_FUTURE_MS = 2 * 60_000;

/**
 * Drops fixes whose own timestamp can't be right for "now": in the future
 * beyond clock skew, or older than {@link MAX_FIX_AGE_MS}. data.gov.my's
 * Prasarana feeds carry at least one permanent ghost (plate VAL4552,
 * timestamped 2029, on a Dec 2024 trip) that would otherwise show up as a
 * live bus; stale fixes left over in the feed are the same problem.
 */
export function dropImplausibleFixes<T extends { observedAt: number }>(
  positions: readonly T[],
  now: number,
  maxAgeMs: number = MAX_FIX_AGE_MS,
  maxFutureMs: number = MAX_FIX_FUTURE_MS,
): T[] {
  return positions.filter(
    (p) => p.observedAt <= now + maxFutureMs && now - p.observedAt <= maxAgeMs,
  );
}
