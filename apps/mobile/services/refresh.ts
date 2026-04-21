import { bootstrapStaticGtfs } from "@/db/bootstrap";
import { realtimeStore } from "@/services/realtime";

/**
 * Minimum interval between successful refreshes. Matches the realtime poller's
 * own 30 s tick — pulling more often than that wastes the data.gov.my quota
 * without gaining fresher data.
 */
export const REFRESH_THROTTLE_MS = 30_000;

export type RefreshOutcome =
  | { status: "refreshed"; finishedAt: number }
  | { status: "throttled"; lastUpdated: number }
  | { status: "failed"; error: Error };

/**
 * Force-refreshes the static GTFS bundle and triggers an immediate realtime
 * tick. Skips when the realtime feed was last updated less than
 * `REFRESH_THROTTLE_MS` ago — the data won't have changed and the user gets
 * a snappy "no work to do" gesture.
 *
 * Use from pull-to-refresh handlers / explicit refresh buttons.
 */
export async function refreshAll(opts?: {
  /** Bypass the 30 s throttle. Reserved for failure-recovery paths. */
  force?: boolean;
  now?: () => number;
}): Promise<RefreshOutcome> {
  const now = (opts?.now ?? Date.now)();
  const lastUpdated = realtimeStore.getSnapshot().lastUpdated ?? 0;
  if (!opts?.force && lastUpdated > 0 && now - lastUpdated < REFRESH_THROTTLE_MS) {
    return { status: "throttled", lastUpdated };
  }

  try {
    // Force-bootstrap rewrites SQLite even if TTL hasn't elapsed — the user
    // pulled because something looks wrong, so we re-fetch.
    await bootstrapStaticGtfs({ force: true });
    await realtimeStore.refresh();
    return { status: "refreshed", finishedAt: (opts?.now ?? Date.now)() };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
