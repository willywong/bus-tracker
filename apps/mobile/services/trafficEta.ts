import { API_BASE_URL } from "@/config/env";

export type TrafficProvider = "here" | "tomtom";

export interface TrafficEtaFetchResult {
  trafficMinutes: number;
  source: TrafficProvider;
  generatedAt: number;
}

export async function fetchTrafficEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  opts: {
    baseUrl?: string;
    signal?: AbortSignal;
    provider?: TrafficProvider;
  } = {},
): Promise<TrafficEtaFetchResult> {
  const base = opts.baseUrl ?? API_BASE_URL;
  const url = new URL(`${base}/api/traffic-eta`);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  if (opts.provider) url.searchParams.set("provider", opts.provider);
  const res = await fetch(url.toString(), { signal: opts.signal });
  if (!res.ok) throw new Error(`traffic-eta ${res.status}`);
  return (await res.json()) as TrafficEtaFetchResult;
}
