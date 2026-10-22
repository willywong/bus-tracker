import BusArrivalActivity, { type BusActivityProps } from '@/activities/BusArrivalActivity';

let swept = false;

/**
 * Ends, once per JS run and before its first start, any activity an earlier
 * run left behind (the app was killed, or reloaded in dev): nothing updates
 * it any more, so it would sit on the Lock Screen with stale times.
 */
export function endOrphanedActivities(): void {
  if (swept) return;
  swept = true;
  try {
    for (const orphan of BusArrivalActivity.getInstances()) void orphan.end('immediate').catch(() => {});
  } catch {
    // No instances to read (Live Activities off): nothing to end.
  }
}

/** Starts the bus/journey Live Activity, after `endOrphanedActivities`. */
export function startBusActivity(props: BusActivityProps, staleDate?: Date): ReturnType<typeof BusArrivalActivity.start> {
  endOrphanedActivities();
  return BusArrivalActivity.start(props, 't816://', staleDate);
}
