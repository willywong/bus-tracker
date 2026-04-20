import { API_BASE_URL } from "@/config/env";

export interface TrafficEtaFetchResult {
  trafficMinutes: number;
  source: "here";
  generatedAt: number;
}

export async function fetchTrafficEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<TrafficEtaFetchResult> {
  const base = opts.baseUrl ?? API_BASE_URL;
  const url = new URL(`${base}/api/traffic-eta`);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  const res = await fetch(url.toString(), { signal: opts.signal });
  if (!res.ok) throw new Error(`traffic-eta ${res.status}`);
  return (await res.json()) as TrafficEtaFetchResult;
}
