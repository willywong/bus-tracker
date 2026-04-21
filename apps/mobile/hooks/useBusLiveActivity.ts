import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { ScheduleDelay } from '@bus-tracker/shared';
import BusArrivalActivity, {
  type BusActivityProps,
} from '@/activities/BusArrivalActivity';
import type { ArrivalEntry } from '@/hooks/useEta';
import type { ResolvedEta } from '@/components/tracker/logic';

type Instance = ReturnType<typeof BusArrivalActivity.start>;

function delayToneOf(delay: ScheduleDelay | null): BusActivityProps['delayTone'] {
  if (!delay) return null;
  if (delay.onTimeWindow === 'on-time') return 'on-time';
  if (delay.onTimeWindow === 'late') return 'late';
  return 'early';
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

interface UseBusLiveActivityArgs {
  routeCode: string;
  stopName: string | null;
  primaryArrival: ArrivalEntry | null;
  resolved: ResolvedEta;
  enabled?: boolean;
}

/**
 * Reflects the tracker's resolved ETA onto a Dynamic Island / Lock Screen
 * Live Activity. Starts when a primary arrival is present with a usable
 * minutes-to-stop, updates on value change, and ends on arrival or teardown.
 */
export function useBusLiveActivity({
  routeCode,
  stopName,
  primaryArrival,
  resolved,
  enabled = true,
}: UseBusLiveActivityArgs): void {
  const instanceRef = useRef<Instance | null>(null);
  const lastPropsRef = useRef<BusActivityProps | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (!enabled) return;

    const minutes = resolved.minutesToStop ?? primaryArrival?.live?.minutesToStop ?? null;
    const arrivalEpoch = primaryArrival?.epochMs ?? null;

    // End once the bus has arrived or we lose a usable ETA.
    if (primaryArrival == null || arrivalEpoch == null || minutes == null || minutes <= 0) {
      const inst = instanceRef.current;
      if (inst) {
        void inst.end('default', lastPropsRef.current ?? undefined, new Date());
        instanceRef.current = null;
        lastPropsRef.current = null;
      }
      return;
    }

    const next: BusActivityProps = {
      routeCode,
      minutesToStop: minutes,
      arrivalEpochMs: arrivalEpoch,
      delayMinutes: resolved.delay?.delayMinutes ?? null,
      delayTone: delayToneOf(resolved.delay),
      stopName: stopName ?? 'your stop',
      busPlate: primaryArrival.live?.vehicleId ?? null,
      source: primaryArrival.kind === 'live' ? 'live' : 'schedule',
    };

    const inst = instanceRef.current;
    if (!inst) {
      try {
        instanceRef.current = BusArrivalActivity.start(next, 't816://');
        lastPropsRef.current = next;
      } catch (err) {
        console.warn('[live-activity] start failed', err);
      }
      return;
    }

    if (lastPropsRef.current && shallowEqual(lastPropsRef.current, next)) return;
    try {
      inst.update(next);
      lastPropsRef.current = next;
    } catch (err) {
      console.warn('[live-activity] update failed', err);
    }
  }, [
    enabled,
    routeCode,
    stopName,
    primaryArrival,
    resolved.minutesToStop,
    resolved.delay,
  ]);

  // Final cleanup on unmount.
  useEffect(() => {
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
