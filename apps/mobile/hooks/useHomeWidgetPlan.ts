import { plan, WALKING_METERS_PER_MINUTE, type PlanQuery } from '@bus-tracker/shared';
import * as Location from 'expo-location';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useSettings } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { placeToPlannerPlace } from '@/services/places/saved';
import { homeLineOf, shouldReplanHome, type LastHomePlan } from '@/services/planner/homePlan';
import { quickFix } from '@/services/planner/quickFix';
import { runPlan } from '@/services/planner/runPlan';
import { networkFor } from '@/services/planner/session';
import { holdWorkspace, workspaceBusy } from '@/services/planner/workspace';
import { usePlanner } from '@/state/PlannerContext';
import { devClockOffsetMs, devNow } from '@/utils/devClock';
import type { NextBusHomePlan } from '@/widgets/nextBusTimeline';

// --- The line, shared with the widget sync (useTripSideEffects) ------------

let line: NextBusHomePlan | null = null;
const listeners = new Set<() => void>();

/** Sets the widget's home line; the trip's widget sync picks it up. */
export function setHomeWidgetLine(next: NextBusHomePlan | null): void {
  if (
    line === next ||
    (line && next && line.label === next.label && line.leaveMs === next.leaveMs && line.arriveMs === next.arriveMs)
  ) {
    return;
  }
  line = next;
  for (const l of listeners) l();
}

/** The home line the widget should show, or null. */
export function useHomeWidgetLine(): NextBusHomePlan | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => line,
  );
}

// --- Planning it -------------------------------------------------------------

/** How often the rules are checked while the app is open (they rarely say plan). */
const CHECK_EVERY_MS = 60_000;
/** A fix this old still says where you are, give or take a walk. */
const FIX_MAX_AGE_MS = 5 * 60_000;

async function currentFix(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // As "My location" (`quickFix`), with the widget's wider fresh window.
    const fix = await quickFix(
      {
        lastKnown: (maxAge) => Location.getLastKnownPositionAsync({ maxAge }),
        current: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      },
      { freshMaxAgeMs: FIX_MAX_AGE_MS },
    );
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the "Next bus" widget's "Home by 18:14 · leave in 6:00" line (plan
 * 15/07). While the app is active and today's network is loaded it plans
 * from your location to Home, as "Leave now" does, and hands the best
 * itinerary to the widget sync. `shouldReplanHome` decides when: a plan
 * older than 15 min, past its leave time, or after a 500 m move; never
 * within 500 m of Home. No Home or no location permission clears the line.
 *
 * The plan shares the network's RAPTOR workspace with the planner sheet's
 * and Go's, so it only runs while no planner sheet is up and the workspace
 * is free, holds it while it runs, and is cancelled when a sheet opens.
 */
export function useHomeWidgetPlan(): void {
  const { ready, savedPlaces } = useSettings();
  const { network } = useTransitNetwork();
  const { presented } = usePlanner();
  const home = savedPlaces.find((p) => p.kind === 'home') ?? null;
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [tick, setTick] = useState(0);
  const last = useRef<LastHomePlan | null>(null);
  const homeRef = useRef(home);
  homeRef.current = home;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [active]);

  const homeLat = home?.lat ?? null;
  const homeLng = home?.lng ?? null;
  useEffect(() => {
    if (!ready) return;
    if (homeLat == null || homeLng == null) {
      last.current = null;
      setHomeWidgetLine(null);
      return;
    }
    // Backgrounded, no network yet, or a planner sheet owns the engine: keep the line.
    if (!active || !network || presented) return;

    let live = true;
    let release: (() => void) | null = null;
    let cancelRun: (() => void) | null = null;
    void (async () => {
      const here = await currentFix();
      const saved = homeRef.current;
      if (!live || !saved) return;
      const now = devNow();
      const decision = shouldReplanHome(last.current, now, here, saved);
      if (decision === 'clear') {
        last.current = null;
        setHomeWidgetLine(null);
        return;
      }
      if (decision === 'keep' || !here) return;
      // The day has turned over before the new network loaded, or a plan is
      // mid-run on it: try again on the next check.
      if (networkFor(now, network.meta.serviceDate, now) !== 'loaded' || workspaceBusy(network)) return;

      const q: PlanQuery = {
        from: { kind: 'here', name: 'My location', lat: here.lat, lng: here.lng },
        to: placeToPlannerPlace(saved),
        departAt: now,
        walkMetersPerMin: WALKING_METERS_PER_MINUTE,
      };
      const handle = runPlan(plan(network, q));
      cancelRun = handle.cancel;
      release = holdWorkspace(network);
      let result: Awaited<typeof handle.promise>;
      try {
        result = await handle.promise;
      } finally {
        release();
        release = null;
        cancelRun = null;
      }
      if (!result || !live) return;
      const best = result.itineraries[0];
      last.current = { plannedAt: now, from: here, home: { lat: saved.lat, lng: saved.lng }, leaveMs: best?.departAt ?? 0 };
      // Widget times are wall-clock; the itinerary's are on the dev clock.
      setHomeWidgetLine(homeLineOf(best, 'Home', devClockOffsetMs()));
    })().catch((err: unknown) => {
      release?.();
      if (__DEV__) console.warn('[home-widget] plan failed', err);
    });
    return () => {
      live = false;
      // A planner sheet opening (or the app leaving) frees the workspace at once.
      cancelRun?.();
      release?.();
    };
  }, [ready, homeLat, homeLng, active, network, presented, tick]);
}
