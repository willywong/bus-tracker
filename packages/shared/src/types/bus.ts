export type StopId = "HOTEL_LISA_DE_INN" | "PJ210";
export type RouteId = "T816" | "T786" | "PJ01" | "PJ02";

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
  speed?: number;
  observedAt: number;
}

export interface EtaResult {
  minutesToStop: number;
  source: "traffic" | "schedule" | "hybrid";
  generatedAt: number;
  isStale: boolean;
}
