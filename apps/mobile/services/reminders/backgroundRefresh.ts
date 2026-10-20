/**
 * Background re-plan of commute reminders (expo-background-task / iOS
 * BGTaskScheduler). iOS decides when this runs (often overnight while
 * charging); without it, reminders would run out ~7 days after the app was
 * last opened.
 *
 * IMPORTANT: this module must be imported at the app's top level (e.g. in
 * app/_layout.tsx) so `TaskManager.defineTask` runs on headless launches.
 */
import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { openDb } from '@/db/database';
import { getStopById } from '@/db/queries';

import {
  loadCommuteSettings,
  loadLastCommuteTarget,
  syncCommuteReminders,
  type CommuteSyncResult,
  type CommuteTarget,
} from './commuteSettings';

export const COMMUTE_REFRESH_TASK = 'bt.commute-refresh';
/** Minutes. iOS treats it as a floor and typically runs the task overnight. */
export const COMMUTE_REFRESH_INTERVAL_MIN = 8 * 60;

// Keys owned by hooks/useSettings.ts (read directly; the hook needs React).
const SETTINGS_KEYS = {
  preferredRouteCode: 'bt.preferredRouteCode',
  preferredStopByRoute: 'bt.preferredStopByRoute',
  favoritedRoutes: 'bt.favoritedRoutes',
  walkMinutes: 'bt.walkMinutes',
  clockFormat: 'bt.clockFormat',
} as const;
const DEFAULT_WALK_MINUTES = 10;

interface FavouriteSettings {
  target: Omit<CommuteTarget, 'stopName'> | null;
  use24h: boolean;
}

/**
 * Reads the current favourite from the main settings. These are stored with
 * the default WHEN_UNLOCKED accessibility, so this throws while the phone is
 * locked — the caller falls back to the snapshot from the last foreground sync.
 */
async function readFavouriteSettings(): Promise<FavouriteSettings> {
  const [route, stopsRaw, favsRaw, walkRaw, clockRaw] = await Promise.all([
    SecureStore.getItemAsync(SETTINGS_KEYS.preferredRouteCode),
    SecureStore.getItemAsync(SETTINGS_KEYS.preferredStopByRoute),
    SecureStore.getItemAsync(SETTINGS_KEYS.favoritedRoutes),
    SecureStore.getItemAsync(SETTINGS_KEYS.walkMinutes),
    SecureStore.getItemAsync(SETTINGS_KEYS.clockFormat),
  ]);
  const use24h = clockRaw !== '12h';
  const walk = walkRaw != null ? Number.parseInt(walkRaw, 10) : NaN;
  const walkMinutes = Number.isFinite(walk) ? walk : DEFAULT_WALK_MINUTES;

  let favourites: unknown = [];
  let stops: unknown = {};
  try {
    favourites = favsRaw ? JSON.parse(favsRaw) : [];
    stops = stopsRaw ? JSON.parse(stopsRaw) : {};
  } catch {
    return { target: null, use24h };
  }
  // Mirrors useSettings: the active route must still be a favourite.
  if (!route || !Array.isArray(favourites) || !favourites.includes(route)) {
    return { target: null, use24h };
  }
  const stopId =
    stops && typeof stops === 'object'
      ? (stops as Record<string, unknown>)[route]
      : undefined;
  if (typeof stopId !== 'string' || !stopId) return { target: null, use24h };
  return { target: { routeCode: route, stopId, walkMinutes }, use24h };
}

/** One background pass. Exported for manual testing from a dev menu. */
export async function runCommuteRefresh(): Promise<CommuteSyncResult | null> {
  let settings;
  try {
    settings = await loadCommuteSettings();
  } catch {
    return null; // keychain locked/unreadable: change nothing
  }
  if (!settings.enabled) return null; // nothing to keep alive

  let target: CommuteTarget | null = null;
  let use24h = true;
  try {
    const fav = await readFavouriteSettings();
    use24h = fav.use24h;
    if (fav.target) {
      let stopName = '';
      try {
        const db = await openDb();
        stopName = (await getStopById(db, fav.target.stopId))?.stop_name ?? '';
      } catch {
        // DB unavailable: copy just omits the stop name.
      }
      target = { ...fav.target, stopName };
    }
  } catch {
    const last = await loadLastCommuteTarget();
    if (last) {
      const { use24h: lastUse24h, ...rest } = last;
      target = rest;
      use24h = lastUse24h;
    }
  }
  if (!target) return null;

  return syncCommuteReminders({ ...target, use24h });
}

TaskManager.defineTask(COMMUTE_REFRESH_TASK, async () => {
  try {
    await runCommuteRefresh();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.warn('[commute] background refresh failed', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Registers the periodic re-plan. Idempotent; resolves false when background
 * tasks are restricted (e.g. iOS Simulator, Low Power Mode, Background App
 * Refresh off) or registration fails.
 */
export async function registerBackgroundRefresh(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    await BackgroundTask.registerTaskAsync(COMMUTE_REFRESH_TASK, {
      minimumInterval: COMMUTE_REFRESH_INTERVAL_MIN,
    });
    return true;
  } catch (err) {
    console.warn('[commute] background registration failed', err);
    return false;
  }
}

export async function unregisterBackgroundRefresh(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(COMMUTE_REFRESH_TASK);
  } catch (err) {
    console.warn('[commute] background unregistration failed', err);
  }
}
