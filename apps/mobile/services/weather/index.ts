// Public facade for rain-aware nudges. See nudge.ts for the rules, api.ts
// for the endpoints and caching, and areas.ts for the location mapping.

import { defaultWeatherClient, type WeatherClient } from "./api";
import { areaForLocation } from "./areas";
import { buildRainNudge } from "./nudge";
import type { ForecastRow, RainNudge } from "./types";

export type { RainNudge } from "./types";
export { areaForLocation, type WeatherArea } from "./areas";
export { buildRainNudge, translateForecast } from "./nudge";

export interface GetRainNudgeInput {
  lat: number;
  lng: number;
  now?: number | Date;
  signal?: AbortSignal;
  /** For tests. Defaults to the shared client with its 30-minute cache. */
  client?: WeatherClient;
}

/**
 * Returns a rain or thunderstorm nudge for a stop, or null. It never throws.
 * Outside the Klang Valley it returns null without any network call.
 *
 * Cost: at most two requests on a cold cache (warnings, plus the district
 * forecast). A third request, for the state forecast, happens only if the
 * district id returns no rows. All are cached for 30 minutes, so calling
 * this on every sheet focus is fine.
 */
export async function getRainNudge(input: GetRainNudgeInput): Promise<RainNudge | null> {
  try {
    const area = areaForLocation(input.lat, input.lng);
    if (!area) return null;
    const client = input.client ?? defaultWeatherClient;
    const { signal } = input;

    const [warnings, forecastRows] = await Promise.all([
      client.fetchWarnings(signal),
      (async (): Promise<ForecastRow[] | null> => {
        for (const id of area.forecastLocationIds) {
          const rows = await client.fetchForecast(id, signal);
          // null means an error or a 429, so don't spend another request.
          // Only an empty result falls through to the state id.
          if (rows === null || rows.length > 0) return rows;
        }
        return null;
      })(),
    ]);

    if (signal?.aborted) return null;
    return buildRainNudge({
      forecastRows,
      warnings,
      area,
      now: input.now ?? Date.now(),
    });
  } catch {
    return null;
  }
}
