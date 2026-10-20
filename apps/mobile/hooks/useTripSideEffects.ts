import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { TripModel } from '@/components/trip/model';
import { AT_STOP_NOTIFICATION_KIND, syncArrivalGeofences } from '@/services/arrival/geofence';
import { syncCommuteReminders, useCommuteSettings } from '@/services/reminders/commuteSettings';
import {
  cancelLastBusReminder,
  cancelLeaveNow,
  scheduleLastBusReminder,
  scheduleLeaveNow,
} from '@/services/reminders/notifications';
import { getRainNudge, type RainNudge } from '@/services/weather';
import { syncNextBusWidget } from '@/widgets/NextBusWidget';
import type { ArrivalLike } from '@/components/trip/model';

/** Reschedule "Leave now" only when the plan moves by at least this much. */
const LEAVE_DRIFT_MS = 60_000;
/** How long before leave-by the last-bus reminder fires. */
const LAST_BUS_LEAD_MIN = 10;

export interface TripSideEffectsInput {
  routeCode: string;
  stopId: string;
  stopName: string | null;
  primaryArrival: ArrivalLike | null;
  laterArrivals: readonly ArrivalLike[];
  lastBusToday: number | null;
  lastUpdated: number | null;
  model: TripModel;
  now: number;
  isFollowing: boolean;
  walkMinutes: number;
  favorites: readonly { routeCode: string; stopId: string; lat: number; lng: number }[];
  /** Called when a tapped notification asks to follow the bus. */
  onFollowRequest: (routeCode: string) => void;
}

/**
 * Everything the trip does outside the sheet: the Home Screen widget, the
 * "Leave now" and last-bus notifications, commute reminders and arrival
 * geofences kept in step with favourites, and taps on
 * our notifications. Each is a no-op without the permission it needs; none
 * of them asks for one.
 */
export function useTripSideEffects(input: TripSideEffectsInput): {
  lastBusReminder: boolean;
  setLastBusReminder: (on: boolean) => void;
} {
  const {
    routeCode,
    stopId,
    stopName,
    primaryArrival,
    laterArrivals,
    lastBusToday,
    lastUpdated,
    model,
    isFollowing,
    walkMinutes,
  } = input;

  // --- Widget ---------------------------------------------------------------
  useEffect(() => {
    if (!routeCode || !stopId) {
      syncNextBusWidget(null);
      return;
    }
    if (!stopName) return;
    const departures = [
      ...(primaryArrival ? [{ epochMs: primaryArrival.epochMs, live: primaryArrival.kind === 'live' }] : []),
      ...laterArrivals
        .filter((a) => !primaryArrival || a.tripId == null || a.tripId !== primaryArrival.tripId)
        .map((a) => ({ epochMs: a.epochMs, live: a.kind === 'live' })),
    ];
    syncNextBusWidget({
      routeCode,
      stopName,
      departures,
      updatedAtMs: lastUpdated ?? Date.now(),
      firstBusTomorrowMs: null,
      lastBusTodayMs: lastBusToday,
    });
  }, [routeCode, stopId, stopName, primaryArrival, laterArrivals, lastBusToday, lastUpdated]);

  // --- Leave now (while following) -----------------------------------------
  const leaveAt = useRef<number | null>(null);
  const followLeaveIn = model.action.kind === 'follow' ? model.action.leaveInMinutes : null;
  useEffect(() => {
    if (!isFollowing || followLeaveIn == null || !primaryArrival || !stopName) {
      if (!isFollowing && leaveAt.current != null) {
        leaveAt.current = null;
        void cancelLeaveNow().catch(() => {});
      }
      return;
    }
    const at = primaryArrival.epochMs - walkMinutes * 60_000;
    if (leaveAt.current != null && Math.abs(leaveAt.current - at) < LEAVE_DRIFT_MS) return;
    leaveAt.current = at;
    void scheduleLeaveNow({
      routeCode,
      stopName,
      leaveAtMs: at,
      busAtMs: primaryArrival.epochMs,
      live: primaryArrival.kind === 'live',
    }).catch(() => {});
  }, [isFollowing, followLeaveIn, primaryArrival, stopName, routeCode, walkMinutes]);

  // --- Last-bus reminder (opt-in per day) ------------------------------------
  const [lastBusReminder, setLastBusReminder] = useState(false);
  useEffect(() => {
    setLastBusReminder(false);
  }, [routeCode, stopId]);
  useEffect(() => {
    if (!lastBusReminder || lastBusToday == null || !stopName) {
      void cancelLastBusReminder().catch(() => {});
      return;
    }
    void scheduleLastBusReminder({
      routeCode,
      stopName,
      lastBusMs: lastBusToday,
      walkMinutes,
      leadMinutes: LAST_BUS_LEAD_MIN,
    }).catch(() => {});
  }, [lastBusReminder, lastBusToday, stopName, routeCode, walkMinutes]);

  // --- Commute reminders: re-plan on change and on foreground -----------------
  const commute = useCommuteSettings();
  const [foregroundTick, setForegroundTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setForegroundTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!commute.ready || !routeCode || !stopId || !stopName) return;
    void syncCommuteReminders({ routeCode, stopId, stopName, walkMinutes }).catch(() => {});
  }, [
    commute.ready,
    commute.enabled,
    commute.weekdays,
    commute.targetMinuteOfDay,
    commute.bufferMinutes,
    routeCode,
    stopId,
    stopName,
    walkMinutes,
    foregroundTick,
  ]);

  // --- Arrival geofences follow the favourites --------------------------------
  const favKey = input.favorites.map((f) => `${f.routeCode}|${f.stopId}`).join(',');
  const favorites = useRef(input.favorites);
  favorites.current = input.favorites;
  useEffect(() => {
    void syncArrivalGeofences(favorites.current).catch(() => {});
  }, [favKey]);

  // --- Notification taps --------------------------------------------------------
  const onFollow = useRef(input.onFollowRequest);
  onFollow.current = input.onFollowRequest;
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier + response.notification.date;
    if (handled.current === id) return;
    handled.current = id;
    const data = response.notification.request.content.data as
      | { kind?: string; routeCode?: string }
      | undefined;
    if (
      (data?.kind === AT_STOP_NOTIFICATION_KIND || data?.kind === 'leave-now') &&
      typeof data.routeCode === 'string'
    ) {
      onFollow.current(data.routeCode);
    }
  }, [response]);

  return { lastBusReminder, setLastBusReminder };
}

/**
 * MET Malaysia rain or flood nudge for the stop's area. Refreshed on
 * foreground (the weather client caches for 30 min), dropped once it expires.
 */
export function useRainNudge(
  stopPoint: { lat: number; lng: number } | null,
  now: number,
): RainNudge | null {
  const [rain, setRain] = useState<RainNudge | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);
  const lat = stopPoint?.lat;
  const lng = stopPoint?.lng;
  useEffect(() => {
    if (lat == null || lng == null) {
      setRain(null);
      return;
    }
    const ac = new AbortController();
    void getRainNudge({ lat, lng, signal: ac.signal }).then((n) => {
      if (!ac.signal.aborted) setRain(n);
    });
    return () => ac.abort();
  }, [lat, lng, tick]);
  return rain && (rain.validUntilMs == null || rain.validUntilMs > now) ? rain : null;
}
