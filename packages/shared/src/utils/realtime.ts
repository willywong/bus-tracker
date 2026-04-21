import type { RouteId, VehiclePosition } from "../types/bus.js";
import type { DecodedEntity, DecodedFeed } from "./protobuf.js";

export type TripRouteMap = ReadonlyMap<string, RouteId>;

/**
 * Extracts VehiclePositions for the routes present in `tripToRoute`.
 *
 * Drops entities that:
 * - are marked `is_deleted`
 * - have no `vehicle.position.latitude/longitude`
 * - have no `vehicle.trip.trip_id`, OR whose `trip_id` isn't in the map.
 *
 * `observedAt` is the entity's per-vehicle `timestamp` (seconds → ms)
 * when present, otherwise the caller-provided `fallbackNow`.
 */
export function entitiesToPositions(
  feed: DecodedFeed,
  tripToRoute: TripRouteMap,
  fallbackNow: number,
): VehiclePosition[] {
  const out: VehiclePosition[] = [];
  for (const entity of feed.entity) {
    const pos = toPosition(entity, tripToRoute, fallbackNow);
    if (pos) out.push(pos);
  }
  return out;
}

function toPosition(
  entity: DecodedEntity,
  tripToRoute: TripRouteMap,
  fallbackNow: number,
): VehiclePosition | null {
  if (entity.is_deleted) return null;
  const v = entity.vehicle;
  if (!v || !v.position || !v.trip?.trip_id) return null;

  const routeId = tripToRoute.get(v.trip.trip_id);
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

  return {
    vehicleId,
    tripId: v.trip.trip_id,
    routeId,
    lat: latitude,
    lng: longitude,
    bearing: Number.isFinite(bearing) ? bearing : undefined,
    speed: Number.isFinite(speed) ? speed : undefined,
    observedAt,
  };
}
