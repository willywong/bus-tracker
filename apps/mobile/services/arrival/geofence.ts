/**
 * "You're at your stop": a geofence round each favourite's boarding stop.
 * Walking into one posts a notification with the next bus from the
 * timetable; tapping it opens the app and follows that bus (Live Activity).
 *
 * Needs Always location, so it's strictly opt-in from Settings and never
 * requested at launch.
 *
 * IMPORTANT: import this module at the app's top level (app/_layout.tsx) so
 * `TaskManager.defineTask` runs when iOS relaunches the app for a region event.
 */
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { formatStopName } from '@/components/map/format';
import { formatClockHHMM } from '@/components/tracker/logic';
import { openDb } from '@/db/database';
import { getNextScheduledDepartures, getStopById } from '@/db/queries';

export const ARRIVAL_GEOFENCE_TASK = 'bt.arrival-geofence';
export const AT_STOP_NOTIFICATION_KIND = 'at-stop';

/** Big enough for GPS error on a street, small enough to mean "at the stop". */
const RADIUS_METERS = 80;
/** iOS monitors at most 20 regions per app. */
const MAX_REGIONS = 20;
/** Don't re-notify for the same stop within this window (e.g. pacing at the stop). */
const COOLDOWN_MS = 45 * 60_000;
const SEPARATOR = '|';

const KEYS = { enabled: 'bt.geofence.enabled', lastAt: 'bt.geofence.lastAt' } as const;
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export interface GeofenceTarget {
  routeCode: string;
  stopId: string;
  lat: number;
  lng: number;
}

type RegionEvent = { eventType: Location.LocationGeofencingEventType; region: Location.LocationRegion };

TaskManager.defineTask<RegionEvent>(ARRIVAL_GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  if (data.eventType !== Location.LocationGeofencingEventType.Enter) return;
  const id = data.region.identifier ?? '';
  const [routeCode, stopId] = id.split(SEPARATOR);
  if (!routeCode || !stopId) return;
  try {
    await notifyAtStop(routeCode, stopId);
  } catch (err) {
    console.warn('[geofence] notify failed', err);
  }
});

async function notifyAtStop(routeCode: string, stopId: string, now = Date.now()): Promise<void> {
  const key = `${routeCode}${SEPARATOR}${stopId}`;
  const last = await readCooldowns();
  if (last[key] != null && now - last[key] < COOLDOWN_MS) return;

  const db = await openDb();
  const [stop, departures] = await Promise.all([
    getStopById(db, stopId),
    getNextScheduledDepartures(db, routeCode, stopId, new Date(now), 2),
  ]);
  const stopName = stop ? formatStopName(stop.stop_name) : 'your stop';
  const next = departures.find((d) => d.departureEpochMs >= now - 30_000);
  const body = next
    ? `Next ${routeCode} at ${formatClockHHMM(next.departureEpochMs)} (scheduled). Tap for the live countdown.`
    : `No more ${routeCode} buses scheduled today.`;

  await Notifications.scheduleNotificationAsync({
    identifier: `bt.at-stop.${key}`,
    content: {
      title: `You’re at ${stopName}`,
      body,
      interruptionLevel: 'timeSensitive',
      threadIdentifier: `bt.route.${routeCode}`,
      data: { kind: AT_STOP_NOTIFICATION_KIND, routeCode, stopId },
    },
    trigger: null,
  });
  last[key] = now;
  await SecureStore.setItemAsync(KEYS.lastAt, JSON.stringify(last), STORE_OPTS).catch(() => {});
}

async function readCooldowns(): Promise<Record<string, number>> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.lastAt, STORE_OPTS);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function isArrivalAlertEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEYS.enabled, STORE_OPTS)) === '1';
  } catch {
    return false;
  }
}

/**
 * Turns the arrival alert on: asks for When In Use then Always location
 * (iOS shows the upgrade prompt), then starts monitoring. Returns false,
 * changing nothing, if Always isn't granted.
 */
export async function enableArrivalAlert(targets: readonly GeofenceTarget[]): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return false;
  await SecureStore.setItemAsync(KEYS.enabled, '1', STORE_OPTS);
  await syncArrivalGeofences(targets);
  return true;
}

export async function disableArrivalAlert(): Promise<void> {
  await SecureStore.setItemAsync(KEYS.enabled, '0', STORE_OPTS).catch(() => {});
  if (await TaskManager.isTaskRegisteredAsync(ARRIVAL_GEOFENCE_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(ARRIVAL_GEOFENCE_TASK).catch(() => {});
  }
}

/**
 * Re-registers the regions for the current favourites. No-op when the alert
 * is off or Always permission was revoked in Settings (then it switches off).
 */
export async function syncArrivalGeofences(targets: readonly GeofenceTarget[]): Promise<void> {
  if (!(await isArrivalAlertEnabled())) return;
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) {
    await disableArrivalAlert();
    return;
  }
  const regions: Location.LocationRegion[] = targets.slice(0, MAX_REGIONS).map((t) => ({
    identifier: `${t.routeCode}${SEPARATOR}${t.stopId}`,
    latitude: t.lat,
    longitude: t.lng,
    radius: RADIUS_METERS,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  if (regions.length === 0) {
    await Location.stopGeofencingAsync(ARRIVAL_GEOFENCE_TASK).catch(() => {});
    return;
  }
  await Location.startGeofencingAsync(ARRIVAL_GEOFENCE_TASK, regions);
}
