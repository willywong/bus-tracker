import { haversineMeters } from "@bus-tracker/shared";
import { API_BASE_URL } from "@/config/env";

export type TrafficProvider = "here" | "tomtom";

export interface TrafficEtaFetchResult {
  trafficMinutes: number;
  source: TrafficProvider;
  generatedAt: number;
}

const USE_MOCK =
  process.env.EXPO_PUBLIC_MOCK_REALTIME === "1" ||
  process.env.EXPO_PUBLIC_MOCK_REALTIME === "true";

/** Assumed mock-bus ground speed (km/h) for synthetic traffic ETAs. */
const MOCK_BUS_KMH = 22;

export async function fetchTrafficEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  opts: {
    baseUrl?: string;
    signal?: AbortSignal;
    provider?: TrafficProvider;
  } = {},
): Promise<TrafficEtaFetchResult> {
  // In mock mode the synthetic bus has no real traffic data — short-circuit
  // so the tracker's ETA pipeline receives a valid `trafficMinutes` and the
  // mock bus surfaces as a live entry (instead of silently dropping to
  // "Timetable"). Uses haversine → MOCK_BUS_KMH as a rough but stable estimate.
  if (USE_MOCK) {
    const meters = haversineMeters(origin, destination);
    const trafficMinutes = (meters / 1000 / MOCK_BUS_KMH) * 60;
    return {
      trafficMinutes: Math.max(0, trafficMinutes),
      source: opts.provider ?? "here",
      generatedAt: Date.now(),
    };
  }
  const base = opts.baseUrl ?? API_BASE_URL;
  const url = new URL(`${base}/api/traffic-eta`);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  if (opts.provider) url.searchParams.set("provider", opts.provider);
  const res = await fetch(url.toString(), { signal: opts.signal });
  if (!res.ok) throw new Error(`traffic-eta ${res.status}`);
  return (await res.json()) as TrafficEtaFetchResult;
}
