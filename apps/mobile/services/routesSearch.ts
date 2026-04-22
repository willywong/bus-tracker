import type { RouteSearchHit } from "@bus-tracker/shared";
import { API_BASE_URL } from "@/config/env";

export async function searchRoutes(
  q: string,
  signal?: AbortSignal,
): Promise<RouteSearchHit[]> {
  const url = `${API_BASE_URL}/api/routes/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return (await res.json()) as RouteSearchHit[];
}
