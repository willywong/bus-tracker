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
export {
  distanceAlongRoute,
  pointAlongRoute,
  polylineLength,
  projectOntoRoute,
  type LatLng,
  type RouteProjection,
} from "./route.js";
export {
  interpolateScheduledPosition,
  type InterpolateScheduledPositionArgs,
  type ScheduledStopTime,
} from "./scheduled-position.js";
export {
  isWithinQuietHours,
  minuteOfDay,
  type QuietHoursRange,
} from "./quiet-hours.js";
export {
  shouldNotify,
  type ShouldNotifyArgs,
} from "./leave-now.js";
export {
  MY_TZ_OFFSET_MIN,
  gtfsTimeToSeconds,
  secondsToClockHHMM,
  toMalaysiaParts,
  type MalaysiaDateParts,
} from "./gtfs-time.js";
export {
  computeScheduleDelay,
  type ComputeScheduleDelayArgs,
  type OnTimeWindow,
  type ScheduleDelay,
} from "./schedule-delay.js";
export {
  getMotionStatus,
  SIGNAL_PROXIMITY_METERS,
  SLOW_SPEED_KMH,
  STOPPED_SPEED_KMH,
  type MotionStatus,
  type MotionStatusArgs,
  type MotionStatusResult,
} from "./motion-status.js";
export {
  DEFAULT_DWELL_MINUTES_PER_STOP,
  computeEta,
  countIntermediateStops,
  dwellMinutes,
  evaluateApproach,
  pickApproachingVehicle,
  type ApproachEvaluation,
  type ApproachVerdict,
  type ComputeEtaArgs,
  type ComputeEtaResult,
  type CountIntermediateStopsArgs,
  type DwellMinutesArgs,
  type EtaSource,
  type EvaluateApproachArgs,
  type PickApproachingVehicleArgs,
  type PickedVehicle,
} from "./eta.js";
