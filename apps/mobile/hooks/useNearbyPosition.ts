import type { LatLng } from '@bus-tracker/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { useNear } from '@/components/plan/useNear';
import { useAppActive } from '@/components/rail/EstimatedTrains';

/** Walking this far moves "around you" (Nearby's list re-sorts). */
const WATCH_DISTANCE_M = 75;

export type LocationState = 'unknown' | 'granted' | 'denied';

export interface NearbyPosition {
  /** Where you are; null without permission or before the first fix, never a stale fix. */
  here: LatLng | null;
  locationState: LocationState;
  /** Asks for permission, or opens Settings once iOS won't ask again. */
  requestLocation: () => void;
}

/**
 * Where you are for Nearby's list (plan 17/02). Reads permission without
 * prompting (the map asks at launch), takes one fix, then follows you in
 * 75 m steps while `active` (the list is on screen) and the app is in the
 * foreground. Permission is read again when the app returns, so turning it
 * on in Settings shows the list at once.
 */
export function useNearbyPosition(active: boolean): NearbyPosition {
  const appActive = useAppActive();
  const [perm, setPerm] = useState<{ state: LocationState; canAskAgain: boolean }>({
    state: 'unknown',
    canAskAgain: true,
  });

  useEffect(() => {
    if (!appActive) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((p) => {
        if (!cancelled) setPerm(permOf(p));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appActive]);

  const granted = perm.state === 'granted';
  const first = useNear(granted);
  const [watched, setWatched] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!granted || !active || !appActive) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: WATCH_DISTANCE_M },
      (fix) => setWatched({ lat: fix.coords.latitude, lng: fix.coords.longitude }),
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [granted, active, appActive]);

  // Losing permission drops the fix too, so the list never shows old places.
  useEffect(() => {
    if (!granted) setWatched(null);
  }, [granted]);

  const { canAskAgain } = perm;
  const requestLocation = useCallback(() => {
    if (!canAskAgain) {
      void Linking.openSettings();
      return;
    }
    Location.requestForegroundPermissionsAsync()
      .then((p) => setPerm(permOf(p)))
      .catch(() => {});
  }, [canAskAgain]);

  return { here: granted ? (watched ?? first) : null, locationState: perm.state, requestLocation };
}

function permOf(p: Location.LocationPermissionResponse): { state: LocationState; canAskAgain: boolean } {
  return {
    state: p.granted ? 'granted' : p.status === 'undetermined' ? 'unknown' : 'denied',
    canAskAgain: p.canAskAgain,
  };
}
