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

export interface GtfsCalendar {
  service_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_date: string;
  end_date: string;
}

export interface PolylinePoint {
  lat: number;
  lng: number;
  seq: number;
}

export interface BundledRoute {
  route_id: string;
  code: string;
  long_name?: string;
}

export interface TrafficSignal {
  /** OpenStreetMap node id. */
  id: number;
  lat: number;
  lng: number;
}

export interface T816Bundle {
  generatedAt: number;
  routes: BundledRoute[];
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  shapes: Record<string, PolylinePoint[]>;
  calendar: GtfsCalendar[];
  /** OSM traffic signals along each route's polyline, keyed by route code. */
  trafficSignals?: Record<string, TrafficSignal[]>;
}
