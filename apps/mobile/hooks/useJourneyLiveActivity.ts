import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { BusActivityProps } from '@/activities/BusArrivalActivity';
import { endOrphanedActivities, startBusActivity } from '@/services/liveActivity';
import { devClockOffsetMs } from '@/utils/devClock';

type Instance = ReturnType<typeof startBusActivity>;

/** As `useBusLiveActivity`: a live leg's countdown greys out this long after its fix. */
const LIVE_STALE_AFTER_MS = 3 * 60_000;

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Go mode's Live Activity (15/06): the same activity as a followed bus
 * (`BusArrivalActivity`, `kind: 'journey'`), one at a time, so Go stops
 * following first. Starts with the first props, updates only when they
 * change, and ends when they go (Go ended) or on arrival.
 *
 * The countdown is SwiftUI's own timer against the device clock, so the
 * times are moved off a dev clock offset (`EXPO_PUBLIC_DEV_NOW_OFFSET_MS`);
 * a stale date is set only for a live bus leg.
 */
export function useJourneyLiveActivity(props: BusActivityProps | null): void {
  const instanceRef = useRef<Instance | null>(null);
  const lastPropsRef = useRef<BusActivityProps | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const inst = instanceRef.current;
    if (!props) {
      if (inst) {
        void inst.end('immediate');
        instanceRef.current = null;
        lastPropsRef.current = null;
      }
      return;
    }

    const offset = devClockOffsetMs();
    const next: BusActivityProps =
      offset === 0
        ? props
        : {
            ...props,
            arrivalEpochMs: props.arrivalEpochMs - offset,
            tripStartEpochMs: props.tripStartEpochMs - offset,
          };
    const staleDate =
      next.source === 'live' && next.updatedAtEpochMs != null
        ? new Date(next.updatedAtEpochMs + LIVE_STALE_AFTER_MS)
        : undefined;

    if (next.arrivalStatus === 'arrived') {
      if (inst) {
        void inst.end('default', next, new Date());
        instanceRef.current = null;
        lastPropsRef.current = null;
      }
      return;
    }

    if (!inst) {
      try {
        instanceRef.current = startBusActivity(next, staleDate);
        lastPropsRef.current = next;
      } catch (err) {
        console.warn('[live-activity] journey start failed', err);
      }
      return;
    }

    if (lastPropsRef.current && shallowEqual(lastPropsRef.current, next)) return;
    try {
      inst.update(next, staleDate);
      lastPropsRef.current = next;
    } catch (err) {
      console.warn('[live-activity] journey update failed', err);
    }
  }, [props]);

  useEffect(() => {
    // Mounted for the app's life: a launch with nothing to show still clears what a killed run left.
    if (Platform.OS === 'ios') endOrphanedActivities();
    return () => {
      const inst = instanceRef.current;
      if (inst) {
        void inst.end('immediate');
        instanceRef.current = null;
        lastPropsRef.current = null;
      }
    };
  }, []);
}
