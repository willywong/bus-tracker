export type StopId = "HOTEL_LISA_DE_INN" | "PJ210";
export type RouteId = "T816" | "T815" | "T786" | "PJ01" | "PJ02";

export interface Stop {
  id: StopId;
  name: string;
  lat: number;
  lng: number;
}

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
}

export interface EtaResult {
  minutesToStop: number;
  source: "traffic" | "schedule" | "hybrid";
  generatedAt: number;
  isStale: boolean;
}
