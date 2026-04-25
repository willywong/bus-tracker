import protobuf from "protobufjs";
import { GTFS_REALTIME_PROTO } from "../proto/gtfs-realtime-text.js";

let _feedMessage: protobuf.Type | null = null;

function loadFeedMessage(): protobuf.Type {
  if (_feedMessage) return _feedMessage;
  const root = protobuf.parse(GTFS_REALTIME_PROTO, {
    keepCase: true,
  }).root;
  _feedMessage = root.lookupType("transit_realtime.FeedMessage");
  return _feedMessage;
}

export function getFeedMessage(): protobuf.Type {
  return loadFeedMessage();
}

export interface DecodedPosition {
  latitude: number;
  longitude: number;
  bearing?: number;
  speed?: number;
  odometer?: number;
}

export interface DecodedVehicle {
  id?: string;
  label?: string;
  license_plate?: string;
  /** 0=NO_VALUE, 1=UNKNOWN, 2=WHEELCHAIR_ACCESSIBLE, 3=WHEELCHAIR_INACCESSIBLE. */
  wheelchair_accessible?: number;
}

export interface DecodedTrip {
  trip_id?: string;
  route_id?: string;
  direction_id?: number;
  start_time?: string;
  start_date?: string;
  schedule_relationship?: string;
}

/** GTFS-RT Vehicle.VehicleStopStatus: INCOMING_AT | STOPPED_AT | IN_TRANSIT_TO. */
export type VehicleStopStatus =
  | "INCOMING_AT"
  | "STOPPED_AT"
  | "IN_TRANSIT_TO"
  | string;

/** GTFS-RT Vehicle.CongestionLevel. */
export type CongestionLevel =
  | "UNKNOWN_CONGESTION_LEVEL"
  | "RUNNING_SMOOTHLY"
  | "STOP_AND_GO"
  | "CONGESTION"
  | "SEVERE_CONGESTION"
  | string;

/** GTFS-RT Vehicle.OccupancyStatus. */
export type OccupancyStatus =
  | "EMPTY"
  | "MANY_SEATS_AVAILABLE"
  | "FEW_SEATS_AVAILABLE"
  | "STANDING_ROOM_ONLY"
  | "CRUSHED_STANDING_ROOM_ONLY"
  | "FULL"
  | "NOT_ACCEPTING_PASSENGERS"
  | "NO_DATA_AVAILABLE"
  | "NOT_BOARDABLE"
  | string;

export interface DecodedVehiclePosition {
  trip?: DecodedTrip;
  vehicle?: DecodedVehicle;
  position?: DecodedPosition;
  timestamp?: number;
  current_stop_sequence?: number;
  stop_id?: string;
  current_status?: VehicleStopStatus;
  congestion_level?: CongestionLevel;
  occupancy_status?: OccupancyStatus;
  occupancy_percentage?: number;
}

export interface DecodedTripUpdate {
  trip?: DecodedTrip;
  vehicle?: DecodedVehicle;
  timestamp?: number;
  delay?: number;
  stop_time_update?: DecodedStopTimeUpdate[];
}

export interface DecodedStopTimeEvent {
  delay?: number;
  time?: number;
  uncertainty?: number;
}

export interface DecodedStopTimeUpdate {
  stop_sequence?: number;
  stop_id?: string;
  arrival?: DecodedStopTimeEvent;
  departure?: DecodedStopTimeEvent;
  schedule_relationship?: string;
  departure_occupancy_status?: OccupancyStatus;
}

export interface DecodedAlert {
  active_period?: DecodedTimeRange[];
  informed_entity?: DecodedInformedEntity[];
  cause?: string;
  effect?: string;
  url?: DecodedTranslatedString;
  header_text?: DecodedTranslatedString;
  description_text?: DecodedTranslatedString;
  severity_level?: string;
}

export interface DecodedTimeRange {
  start?: number;
  end?: number;
}

export interface DecodedInformedEntity {
  agency_id?: string;
  route_id?: string;
  route_type?: number;
  trip?: DecodedTrip;
  stop_id?: string;
}

export interface DecodedTranslatedString {
  translation?: Array<{ text?: string; language?: string }>;
}

export interface DecodedEntity {
  id: string;
  is_deleted?: boolean;
  vehicle?: DecodedVehiclePosition;
  trip_update?: DecodedTripUpdate;
  alert?: DecodedAlert;
}

export interface DecodedFeed {
  header: {
    gtfs_realtime_version: string;
    timestamp?: number;
  };
  entity: DecodedEntity[];
}

export function decodeFeed(buf: Uint8Array): DecodedFeed {
  const FeedMessage = loadFeedMessage();
  const msg = FeedMessage.decode(buf);
  const obj = FeedMessage.toObject(msg, {
    longs: Number,
    enums: String,
    defaults: false,
  }) as DecodedFeed;
  if (!Array.isArray(obj.entity)) obj.entity = [];
  return obj;
}

export function resetProtobufCacheForTests(): void {
  _feedMessage = null;
}
