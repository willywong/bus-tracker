export type StopId = "HOTEL_LISA_DE_INN" | "PJ210";
export type RouteId = string;

export interface Stop {
  id: StopId;
  name: string;
  lat: number;
  lng: number;
}

export type VehicleStopStatus = "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO";

export type OccupancyStatus =
  | "EMPTY"
  | "MANY_SEATS_AVAILABLE"
  | "FEW_SEATS_AVAILABLE"
  | "STANDING_ROOM_ONLY"
  | "CRUSHED_STANDING_ROOM_ONLY"
  | "FULL"
  | "NOT_ACCEPTING_PASSENGERS"
  | "NO_DATA_AVAILABLE"
  | "NOT_BOARDABLE";

export interface VehiclePosition {
  vehicleId: string;
  tripId: string;
  routeId: RouteId;
  lat: number;
  lng: number;
  bearing?: number;
  /**
   * Vehicle speed in **km/h**.
   *
   * Note: GTFS-Realtime spec defines `Position.speed` as m/s, but the
   * Prasarana RapidKL feed (api.data.gov.my) actually publishes km/h.
   * `entitiesToPositions` passes the raw value through unchanged, so
   * downstream consumers should treat this field as km/h.
   */
  speed?: number;
  observedAt: number;
  /** Stop the bus is at/heading toward (GTFS-RT current_stop_sequence). */
  currentStopSequence?: number;
  /** Stop id the bus is at/heading toward. */
  currentStopId?: string;
  /** Motion state relative to `currentStopId`. */
  currentStatus?: VehicleStopStatus;
  /** Crowding signal — rendered as a badge. */
  occupancyStatus?: OccupancyStatus;
  /** 0–100% occupancy if the provider publishes it. */
  occupancyPercentage?: number;
  /** 1 = accessible, 2 = not accessible, 0 = no info. Mapped from GTFS-RT. */
  wheelchairAccessible?: 0 | 1 | 2;
}

export interface EtaResult {
  minutesToStop: number;
  source: "traffic" | "schedule" | "hybrid";
  generatedAt: number;
  isStale: boolean;
}

export type AlertCause =
  | "UNKNOWN_CAUSE"
  | "OTHER_CAUSE"
  | "TECHNICAL_PROBLEM"
  | "STRIKE"
  | "DEMONSTRATION"
  | "ACCIDENT"
  | "HOLIDAY"
  | "WEATHER"
  | "MAINTENANCE"
  | "CONSTRUCTION"
  | "POLICE_ACTIVITY"
  | "MEDICAL_EMERGENCY";

export type AlertEffect =
  | "NO_SERVICE"
  | "REDUCED_SERVICE"
  | "SIGNIFICANT_DELAYS"
  | "DETOUR"
  | "ADDITIONAL_SERVICE"
  | "MODIFIED_SERVICE"
  | "OTHER_EFFECT"
  | "UNKNOWN_EFFECT"
  | "STOP_MOVED"
  | "NO_EFFECT"
  | "ACCESSIBILITY_ISSUE";

export type AlertSeverity = "UNKNOWN_SEVERITY" | "INFO" | "WARNING" | "SEVERE";

export interface ServiceAlert {
  id: string;
  headerText: string | null;
  descriptionText: string | null;
  url: string | null;
  cause: AlertCause | null;
  effect: AlertEffect | null;
  severity: AlertSeverity | null;
  /** Epoch ms window(s) when this alert is active. Empty means always-on. */
  activePeriod: Array<{ startMs: number | null; endMs: number | null }>;
  /** Routes / stops / trips that this alert applies to. Empty means system-wide. */
  affectedRouteIds: string[];
  affectedStopIds: string[];
  affectedTripIds: string[];
}

export interface StopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrivalDelaySec?: number;
  arrivalTimeMs?: number;
  departureDelaySec?: number;
  departureTimeMs?: number;
  scheduleRelationship?:
    | "SCHEDULED"
    | "SKIPPED"
    | "NO_DATA"
    | "UNSCHEDULED"
    | string;
}

export interface TripUpdateRecord {
  tripId: string;
  routeId?: string;
  vehicleId?: string;
  delaySec?: number;
  timestamp?: number;
  stopTimeUpdates: StopTimeUpdate[];
}
