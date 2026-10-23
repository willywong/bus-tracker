import { useCallback, useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { devNow } from '@/utils/devClock';

/** How often the shared clock ticks. */
export const TICK_MS = 15_000;

/*
 * One clock for every countdown, stale check and timetable window in the
 * app: a single timer on wall-clock 15 s boundaries, so everything that
 * reads the time re-renders in the same tick instead of each on its own
 * interval. It also ticks when the app comes back to the foreground, so
 * nothing shows an hour-old time after the phone slept. It runs only while
 * something listens.
 */
let now = devNow();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let foreground: NativeEventSubscription | null = null;

function tick() {
  now = devNow();
  for (const listener of listeners) listener();
}

function schedule() {
  timer = setTimeout(
    () => {
      tick();
      schedule();
    },
    TICK_MS - (devNow() % TICK_MS),
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = devNow();
    schedule();
    foreground = AppState.addEventListener('change', (status) => {
      if (status === 'active') tick();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
    foreground?.remove();
    foreground = null;
  };
}

/**
 * The time (`devNow()`), moving on every 15 s and on returning to the
 * foreground. With `every`, it moves only when it crosses a multiple of
 * that (e.g. 30 s for a timetable query), reading the start of the window.
 */
export function useNow(every: number = TICK_MS): number {
  const snapshot = useCallback(() => (every > TICK_MS ? now - (now % every) : now), [every]);
  return useSyncExternalStore(subscribe, snapshot);
}
