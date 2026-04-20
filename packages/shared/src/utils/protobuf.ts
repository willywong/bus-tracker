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
}

export interface DecodedVehicle {
  id?: string;
  label?: string;
}

export interface DecodedTrip {
  trip_id?: string;
  route_id?: string;
  direction_id?: number;
  start_time?: string;
  start_date?: string;
}

export interface DecodedVehiclePosition {
  trip?: DecodedTrip;
  vehicle?: DecodedVehicle;
  position?: DecodedPosition;
  timestamp?: number;
}

export interface DecodedEntity {
  id: string;
  is_deleted?: boolean;
  vehicle?: DecodedVehiclePosition;
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
