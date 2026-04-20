import type { RouteId } from "./bus.js";

export interface GtfsRoute {
  route_id: RouteId | string;
  route_short_name: string;
  route_long_name?: string;
}

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface GtfsTrip {
  route_id: string;
  service_id: string;
  trip_id: string;
  shape_id?: string;
  direction_id?: 0 | 1;
}

export interface GtfsStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time?: string;
  departure_time?: string;
}

export interface GtfsShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}
