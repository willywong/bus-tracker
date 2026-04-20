export const SHARED_PKG_VERSION = "0.1.0" as const;

export { parseCsv, parseGtfsZip } from "./gtfs-parser.js";
export type { ParsedGtfs } from "./gtfs-parser.js";
export {
  filterToT816,
  T816_TARGET_CODES,
  type T816TargetCode,
} from "./t816-bundle.js";
export {
  decodeFeed,
  getFeedMessage,
  resetProtobufCacheForTests,
  type DecodedFeed,
  type DecodedEntity,
  type DecodedVehiclePosition,
  type DecodedTrip,
  type DecodedVehicle,
  type DecodedPosition,
} from "./protobuf.js";
export { entitiesToPositions, type TripRouteMap } from "./realtime.js";
export {
  createOutlierFilter,
  haversineMeters,
  type OutlierFilter,
  type OutlierFilterOptions,
} from "./outlier.js";
