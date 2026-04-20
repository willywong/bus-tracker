import type { Db } from "./database";

export interface StopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface RouteRow {
  route_id: string;
  code: string;
  long_name: string | null;
}

export interface TripRow {
  trip_id: string;
  route_id: string;
  service_id: string;
  shape_id: string | null;
  direction_id: number | null;
}

export interface PolylinePoint {
  lat: number;
  lng: number;
  seq: number;
}

export async function getStops(db: Db): Promise<StopRow[]> {
  return db.getAllAsync<StopRow>(
    "SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops ORDER BY stop_name;",
  );
}

export async function getRoutes(db: Db): Promise<RouteRow[]> {
  return db.getAllAsync<RouteRow>(
    "SELECT route_id, code, long_name FROM routes ORDER BY code;",
  );
}

export async function getTripsForRoute(
  db: Db,
  routeId: string,
): Promise<TripRow[]> {
  return db.getAllAsync<TripRow>(
    "SELECT trip_id, route_id, service_id, shape_id, direction_id FROM trips WHERE route_id = ?;",
    routeId,
  );
}

export async function getRoutePolyline(
  db: Db,
  routeId: string,
): Promise<PolylinePoint[]> {
  const shape = await db.getFirstAsync<{ shape_id: string }>(
    `SELECT shape_id FROM trips
     WHERE route_id = ? AND shape_id IS NOT NULL
     GROUP BY shape_id
     ORDER BY COUNT(*) DESC
     LIMIT 1;`,
    routeId,
  );
  if (!shape) return [];
  return db.getAllAsync<PolylinePoint>(
    "SELECT lat, lng, seq FROM shape_points WHERE shape_id = ? ORDER BY seq;",
    shape.shape_id,
  );
}
