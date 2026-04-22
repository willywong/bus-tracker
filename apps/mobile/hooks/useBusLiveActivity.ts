import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { ScheduleDelay } from '@bus-tracker/shared';
import BusArrivalActivity, {
  type BusActivityProps,
} from '@/activities/BusArrivalActivity';
import { formatStopName } from '@/components/map/format';
import type { ArrivalEntry } from '@/hooks/useEta';
import type {
  ArrivalStatus,
  ResolvedEta,
} from '@/components/tracker/logic';
import { devNow } from '@/utils/devClock';

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
  /** Contextual proximity status — drives the Live Activity's "ARRIVING" / "ARRIVED" pill and keeps the activity alive through the 45s arrived-latch. */
  arrivalStatus: ArrivalStatus;
  /** True when the latest realtime ping is older than the stale threshold. */
  isStale?: boolean;
  /** True when today's service hasn't started yet. */
  beforeServiceStart?: boolean;
  /** Epoch ms of the first bus of today's service. */
  firstBusToday?: number | null;
  enabled?: boolean;
}

/**
 * Reflects the tracker's resolved ETA onto a Dynamic Island / Lock Screen
 * Live Activity. Supports two modes:
 *  - 'arrival': a bus is approaching — shows minutes + progress + rich pills
 *  - 'pre-service': no buses yet today — shows "First bus at HH:MM"
 */
export function useBusLiveActivity({
  routeCode,
  stopName,
  primaryArrival,
  resolved,
  arrivalStatus,
  isStale = false,
  beforeServiceStart = false,
  firstBusToday = null,
  enabled = true,
}: UseBusLiveActivityArgs): void {
  const instanceRef = useRef<Instance | null>(null);
  const lastPropsRef = useRef<BusActivityProps | null>(null);
  // Stable across updates so the progress bar advances smoothly. Set on start,
  // cleared on end.
  const tripStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // User toggled tracking off — tear down any running activity.
    if (!enabled) {
      const inst = instanceRef.current;
      if (inst) {
        void inst.end('immediate');
        instanceRef.current = null;
        lastPropsRef.current = null;
        tripStartRef.current = null;
      }
      return;
    }

    const formattedStop = stopName ? formatStopName(stopName) : 'your stop';

    // --- Pre-service branch: waiting for first bus of the day -----------
    if (primaryArrival == null && beforeServiceStart && firstBusToday != null) {
      if (tripStartRef.current == null) tripStartRef.current = devNow();

      const next: BusActivityProps = {
        kind: 'pre-service',
        routeCode,
        minutesToStop: null,
        arrivalEpochMs: firstBusToday,
        tripStartEpochMs: tripStartRef.current,
        delayMinutes: null,
        delayTone: null,
        stopName: formattedStop,
        busPlate: null,
        source: 'schedule',
        distanceToStopMeters: null,
        isStale: false,
        arrivalStatus: 'en-route',
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
      return;
    }

    // --- Arrival branch: a bus is approaching ---------------------------
    const minutes = resolved.minutesToStop ?? primaryArrival?.live?.minutesToStop ?? null;
    const arrivalEpoch = primaryArrival?.epochMs ?? null;

    // End once we lose a usable ETA OR the bus is en-route past the stop
    // (minutes ≤ 0 AND no longer arriving/arrived — the latch has expired or
    // the next trip has rolled in). Keeping the activity alive while status is
    // 'arriving' or 'arrived' preserves the ~45s "Arrived" linger.
    const shouldEnd =
      primaryArrival == null ||
      arrivalEpoch == null ||
      (arrivalStatus === 'en-route' && (minutes == null || minutes <= 0));
    if (shouldEnd) {
      const inst = instanceRef.current;
      if (inst) {
        void inst.end('default', lastPropsRef.current ?? undefined, new Date());
        instanceRef.current = null;
        lastPropsRef.current = null;
        tripStartRef.current = null;
      }
      return;
    }

    if (tripStartRef.current == null) tripStartRef.current = devNow();

    const forwardMeters = primaryArrival.live?.forwardMeters ?? null;

    const next: BusActivityProps = {
      kind: 'arrival',
      routeCode,
      minutesToStop: minutes,
      arrivalEpochMs: arrivalEpoch,
      tripStartEpochMs: tripStartRef.current,
      delayMinutes: resolved.delay?.delayMinutes ?? null,
      delayTone: delayToneOf(resolved.delay),
      stopName: formattedStop,
      busPlate: primaryArrival.live?.vehicleId ?? null,
      source: primaryArrival.kind === 'live' ? 'live' : 'schedule',
      distanceToStopMeters:
        forwardMeters != null && Number.isFinite(forwardMeters) ? forwardMeters : null,
      isStale,
      arrivalStatus,
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
    isStale,
    beforeServiceStart,
    firstBusToday,
    arrivalStatus,
  ]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      const inst = instanceRef.current;
      if (inst) {
        void inst.end('immediate');
        instanceRef.current = null;
        lastPropsRef.current = null;
        tripStartRef.current = null;
      }
    };
  }, []);
}
