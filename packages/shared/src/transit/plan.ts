/** Spec §4.4: one end of a journey. `ref` is a stop id (`kind: "stop"`) or a station slug (`"station"`). */
export interface Place { kind: "here" | "place" | "stop" | "station"; name: string; lat: number; lng: number; ref?: string }
