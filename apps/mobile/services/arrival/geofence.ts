/**
 * "You're at your stop": a geofence round each favourite's boarding stop.
 * Walking into one posts a notification with the next bus from the
 * timetable; tapping it opens the app and follows that bus (Live Activity).
 *
 * Needs Always location, so it's strictly opt-in from Settings and never
 * requested at launch.
 *
 * Go mode (15/06) reuses it while the alert is on: one 120 m region per
 * ride leg's alight stop posts that leg's change or get-off alert the moment
 * you walk in, ahead of its timed one. Go never asks for Always: without it
 * (or with the alert off) Go's alerts are timed only.
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
import { goRegionId, MAX_REGIONS, mergeRegions, parseRegionId } from '@/services/arrival/regions';
import { journeyAlertRequest } from '@/services/reminders/notifications';
import type { JourneyAlert } from '@/services/reminders/plan';

export const ARRIVAL_GEOFENCE_TASK = 'bt.arrival-geofence';
export const AT_STOP_NOTIFICATION_KIND = 'at-stop';

/** Big enough for GPS error on a street, small enough to mean "at the stop". */
const RADIUS_METERS = 80;
/** A Go alight stop: wider, as a bus or train is moving when it crosses in. */
const GO_RADIUS_METERS = 120;
/** Don't re-notify for the same stop within this window (e.g. pacing at the stop). */
const COOLDOWN_MS = 45 * 60_000;
const SEPARATOR = '|';

const KEYS = { enabled: 'bt.geofence.enabled', lastAt: 'bt.geofence.lastAt', go: 'bt.go.active' } as const;
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

/**
 * What the task needs of a journey in Go, kept in SecureStore so it works
 * when iOS relaunches the app for a region event: per ride leg, where it
 * gets off and the alert to post (alight names and next lines are in it).
 */
export interface GoActive {
  legs: { legIndex: number; stopKey: string; lat: number; lng: number; alert: JourneyAlert }[];
}

TaskManager.defineTask<RegionEvent>(ARRIVAL_GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  if (data.eventType !== Location.LocationGeofencingEventType.Enter) return;
  const region = parseRegionId(data.region.identifier ?? '');
  try {
    if (region?.kind === 'go') await notifyGoLeg(region.legIndex);
    else if (region?.kind === 'favourite') await notifyAtStop(region.routeCode, region.stopId);
  } catch (err) {
    console.warn('[geofence] notify failed', err);
  }
});

/**
 * A Go leg's alert, now. Same id as its timed alert, so this replaces the
 * pending one rather than adding a second; the leg is then dropped from
 * the stored journey, so walking in again stays quiet.
 */
async function notifyGoLeg(legIndex: number): Promise<void> {
  const go = await readGoActive();
  const leg = go?.legs.find((l) => l.legIndex === legIndex);
  if (!go || !leg) return;
  await Notifications.scheduleNotificationAsync(journeyAlertRequest(leg.alert, null));
  const rest: GoActive = { legs: go.legs.filter((l) => l.legIndex !== legIndex) };
  await SecureStore.setItemAsync(KEYS.go, JSON.stringify(rest), STORE_OPTS).catch(() => {});
}

async function readGoActive(): Promise<GoActive | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.go, STORE_OPTS);
    const v = raw ? (JSON.parse(raw) as GoActive) : null;
    return v && Array.isArray(v.legs) ? v : null;
  } catch {
    return null;
  }
}

/** The favourites last synced, so starting or ending Go can re-sync with them. */
let lastTargets: readonly GeofenceTarget[] = [];
/** Go's start and end run one after another, so a quick restart can't interleave them. */
let goChain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = goChain.then(run, run);
  goChain = next.catch(() => {});
  return next;
}

/**
 * Go started (or re-planned): its alight stops join the watched regions,
 * ahead of the favourites. Only when the arrival alert is on, and never
 * prompts. Resolves whether the regions were set.
 */
export function startGoGeofences(go: GoActive): Promise<boolean> {
  return serial(async () => {
    if (!(await isArrivalAlertEnabled())) return false;
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (!bg?.granted) return false;
    await SecureStore.setItemAsync(KEYS.go, JSON.stringify(go), STORE_OPTS);
    await syncArrivalGeofences(lastTargets);
    return true;
  });
}

/** Go ended: forget the journey and watch the favourites only. */
export function clearGoGeofences(): Promise<void> {
  return serial(async () => {
    const had = (await SecureStore.getItemAsync(KEYS.go, STORE_OPTS).catch(() => null)) != null;
    await SecureStore.deleteItemAsync(KEYS.go, STORE_OPTS).catch(() => {});
    if (had) await syncArrivalGeofences(lastTargets);
  });
}

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
 * Re-registers the regions for the current favourites, after a followed
 * journey's alight stops (Go). No-op when the alert is off or Always
 * permission was revoked in Settings (then it switches off).
 */
export async function syncArrivalGeofences(targets: readonly GeofenceTarget[]): Promise<void> {
  lastTargets = targets;
  if (!(await isArrivalAlertEnabled())) return;
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) {
    await disableArrivalAlert();
    return;
  }
  const favourites: Location.LocationRegion[] = targets.map((t) => ({
    identifier: `${t.routeCode}${SEPARATOR}${t.stopId}`,
    latitude: t.lat,
    longitude: t.lng,
    radius: RADIUS_METERS,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  const go: Location.LocationRegion[] = ((await readGoActive())?.legs ?? []).map((l) => ({
    identifier: goRegionId(l.legIndex, l.stopKey),
    latitude: l.lat,
    longitude: l.lng,
    radius: GO_RADIUS_METERS,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  const regions = mergeRegions(go, favourites, MAX_REGIONS);
  if (regions.length === 0) {
    await Location.stopGeofencingAsync(ARRIVAL_GEOFENCE_TASK).catch(() => {});
    return;
  }
  await Location.startGeofencingAsync(ARRIVAL_GEOFENCE_TASK, regions);
}
