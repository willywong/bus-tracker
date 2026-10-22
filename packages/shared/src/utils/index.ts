export const SHARED_PKG_VERSION = "0.1.0" as const;

export { parseCsv, parseCsvTable, parseGtfsZip, type ParseGtfsOptions } from "./gtfs-parser.js";
export type { CsvTable, ParsedGtfs } from "./gtfs-parser.js";
export {
  BARE_KEY_CATEGORIES,
  BUS_CATEGORIES,
  BUS_CATEGORY_INFO,
  categoriesForKey,
  isBusCategory,
  namespaceId,
  namespaceParsedGtfs,
  parseRouteKey,
  rawGtfsId,
  routeCodeOf,
  routeKeyFor,
  vehiclePositionsUrl,
  type BusCategory,
  type BusCategoryInfo,
  type ParsedRouteKey,
} from "./categories.js";
export {
  expandFrequencies,
  filterToRoutes,
  matchesCode,
  filterToT816,
  frequencyInstanceId,
  frequencyTemplateId,
  parseFrequencyInstanceId,
  FREQUENCY_INSTANCE_SEPARATOR,
  type FilterToRoutesOptions,
  T816_TARGET_CODES,
  type T816TargetCode,
} from "./t816-bundle.js";
export {
  buildRouteSearchIndex,
  buildRouteSearchIndexFromZip,
  deserializeRouteSearchIndex,
  searchRouteIndexes,
  searchRoutes,
  serializeRouteSearchIndex,
  type RouteSearchHit,
  type RouteSearchIndex,
  type SerializedRouteSearchIndex,
} from "./search-routes.js";
export { runSteps } from "./steps.js";
export {
  orderStopsByTrip,
  pickRepresentativeTrip,
  type RepresentativeTrip,
} from "./stop-order.js";
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
export {
  MAX_FIX_AGE_MS,
  MAX_FIX_FUTURE_MS,
  dropImplausibleFixes,
  entitiesToPositions,
  resolveRouteAlias,
  type RouteAliases,
  type TripRouteMap,
} from "./realtime.js";
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
  SNAP_MAX_OFF_ROUTE_M,
  snapToRoute,
  type LatLng,
  type RouteProjection,
  type RouteSnap,
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
  computeNextPollDelay,
  parseRetryAfterMs,
  type NextPollDelayArgs,
} from "./backoff.js";
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
  DEFAULT_BUS_CRUISE_KMH,
  DEFAULT_DWELL_MINUTES_PER_STOP,
  computeEta,
  countIntermediateStops,
  dwellMinutes,
  estimateLiveMinutes,
  evaluateApproach,
  pickApproachingVehicle,
  type ApproachEvaluation,
  type ApproachVerdict,
  type ComputeEtaArgs,
  type ComputeEtaResult,
  type CountIntermediateStopsArgs,
  type DwellMinutesArgs,
  type EstimateLiveMinutesArgs,
  type EtaSource,
  type EvaluateApproachArgs,
  type PickApproachingVehicleArgs,
  type PickedVehicle,
} from "./eta.js";
