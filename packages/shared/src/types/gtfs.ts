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
  /** 0/blank = no info, 1 = accessible, 2 = not accessible (GTFS spec). */
  wheelchair_boarding?: 0 | 1 | 2;
}

export interface GtfsTrip {
  route_id: string;
  service_id: string;
  trip_id: string;
  shape_id?: string;
  direction_id?: 0 | 1;
  trip_headsign?: string;
}

export interface GtfsCalendarDate {
  service_id: string;
  /** YYYYMMDD as in GTFS. */
  date: string;
  /** 1 = service added, 2 = service removed. */
  exception_type: 1 | 2;
}

export interface GtfsFareAttribute {
  fare_id: string;
  price: number;
  currency_type: string;
  payment_method?: 0 | 1;
  transfers?: 0 | 1 | 2 | null;
  transfer_duration?: number;
}

export interface GtfsFareRule {
  fare_id: string;
  route_id?: string;
  origin_id?: string;
  destination_id?: string;
  contains_id?: string;
}

export interface GtfsTransfer {
  from_stop_id: string;
  to_stop_id: string;
  /** 0 = recommended, 1 = timed, 2 = min time required, 3 = not possible. */
  transfer_type: 0 | 1 | 2 | 3;
  min_transfer_time?: number;
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
  /** Service-exception rows keyed by the same service_ids as `calendar`. */
  calendarDates?: GtfsCalendarDate[];
  /** Fare catalog (optional — RapidKL may not publish fares). */
  fareAttributes?: GtfsFareAttribute[];
  fareRules?: GtfsFareRule[];
  /** Stop-to-stop transfers within the RapidKL feed. */
  transfers?: GtfsTransfer[];
  /** OSM traffic signals along each route's polyline, keyed by route code. */
  trafficSignals?: Record<string, TrafficSignal[]>;
}
