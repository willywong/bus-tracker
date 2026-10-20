/**
 * Persisted commute-reminder settings + the sync that turns them into
 * scheduled local notifications.
 *
 * Settings live in SecureStore under `bt.commute.*`, written with
 * AFTER_FIRST_UNLOCK so the background refresh can read them while the phone
 * is locked (the default WHEN_UNLOCKED would make keychain reads fail there).
 * A tiny module-level store backs `useCommuteSettings()`, so every caller sees
 * the same state without a provider.
 */
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { getClockUse24h } from '@/components/tracker/logic';
import { openDb } from '@/db/database';
import { getDeparturesForDate } from '@/db/queries';

import {
  cancelAllCommuteReminders,
  getCommuteSlots,
  hasNotificationPermission,
  replaceCommuteReminders,
} from './notifications';
import {
  formatMalaysiaClock,
  isSameMoment,
  planCommuteReminders,
  upcomingServiceDates,
} from './plan';

export interface CommuteSettings {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Minute of day (0–1439) of the bus the user wants: first departure at or after this. */
  targetMinuteOfDay: number;
  /** Extra minutes on top of the walk. */
  bufferMinutes: number;
}

export const DEFAULT_COMMUTE_SETTINGS: CommuteSettings = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  targetMinuteOfDay: 8 * 60,
  bufferMinutes: 2,
};

/** Days of timetable planned ahead on each sync. */
export const COMMUTE_PLAN_DAYS = 7;

const KEYS = {
  enabled: 'bt.commute.enabled',
  weekdays: 'bt.commute.weekdays',
  targetMinuteOfDay: 'bt.commute.targetMinuteOfDay',
  bufferMinutes: 'bt.commute.bufferMinutes',
  lastTarget: 'bt.commute.lastTarget',
} as const;

const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseIntIn(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function normaliseWeekdays(days: readonly number[]): number[] {
  return Array.from(
    new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ).sort((a, b) => a - b);
}

function parseWeekdays(raw: string | null, fallback: number[]): number[] {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    return normaliseWeekdays(parsed.filter((d): d is number => typeof d === 'number'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Module store
// ---------------------------------------------------------------------------

interface Snapshot {
  settings: CommuteSettings;
  ready: boolean;
}

let snapshot: Snapshot = { settings: DEFAULT_COMMUTE_SETTINGS, ready: false };
let loadPromise: Promise<CommuteSettings> | null = null;
/** Keys changed by a setter before the initial load finished: the load must not clobber them. */
const dirtyBeforeLoad = new Set<keyof CommuteSettings>();
const listeners = new Set<() => void>();

function emit(next: Snapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

class CommuteSettingsLoadError extends Error {}

/**
 * Loads settings once per JS runtime (cached). Rejects with
 * `CommuteSettingsLoadError` if the keychain couldn't be read, so callers
 * never mistake "unreadable" for "disabled"; a later call retries.
 */
export function loadCommuteSettings(): Promise<CommuteSettings> {
  if (loadPromise) return loadPromise;
  const p = (async () => {
    let raw: (string | null)[];
    try {
      raw = await Promise.all([
        SecureStore.getItemAsync(KEYS.enabled, STORE_OPTS),
        SecureStore.getItemAsync(KEYS.weekdays, STORE_OPTS),
        SecureStore.getItemAsync(KEYS.targetMinuteOfDay, STORE_OPTS),
        SecureStore.getItemAsync(KEYS.bufferMinutes, STORE_OPTS),
      ]);
    } catch (err) {
      throw new CommuteSettingsLoadError(String(err));
    }
    const d = DEFAULT_COMMUTE_SETTINGS;
    const loaded: CommuteSettings = {
      enabled: parseBool(raw[0], d.enabled),
      weekdays: parseWeekdays(raw[1], d.weekdays),
      targetMinuteOfDay: parseIntIn(raw[2], 0, 1439, d.targetMinuteOfDay),
      bufferMinutes: parseIntIn(raw[3], 0, 60, d.bufferMinutes),
    };
    // Setters that ran during the load win over what was on disk.
    const current = snapshot.settings;
    const merged: CommuteSettings = { ...loaded };
    for (const k of dirtyBeforeLoad) {
      (merged as unknown as Record<string, unknown>)[k] = current[k];
    }
    dirtyBeforeLoad.clear();
    emit({ settings: merged, ready: true });
    return merged;
  })();
  loadPromise = p;
  p.catch((err) => {
    loadPromise = null;
    console.warn('[commute] settings load failed', err);
  });
  return p;
}

function persist<K extends keyof CommuteSettings>(
  key: K,
  value: CommuteSettings[K],
): void {
  const raw = Array.isArray(value) ? JSON.stringify(value) : String(value);
  SecureStore.setItemAsync(KEYS[key], raw, STORE_OPTS).catch((err) => {
    console.warn(`[commute] failed to persist ${KEYS[key]}`, err);
  });
}

function update<K extends keyof CommuteSettings>(
  key: K,
  value: CommuteSettings[K],
): void {
  const prev = snapshot.settings[key];
  const same = Array.isArray(prev)
    ? JSON.stringify(prev) === JSON.stringify(value)
    : prev === value;
  if (same) return;
  if (!snapshot.ready) dirtyBeforeLoad.add(key);
  emit({ ...snapshot, settings: { ...snapshot.settings, [key]: value } });
  persist(key, value);
}

export function setCommuteEnabled(v: boolean): void {
  update('enabled', v);
}
export function setCommuteWeekdays(v: readonly number[]): void {
  update('weekdays', normaliseWeekdays(v));
}
export function setCommuteTargetMinuteOfDay(v: number): void {
  update('targetMinuteOfDay', Math.min(1439, Math.max(0, Math.round(v))));
}
export function setCommuteBufferMinutes(v: number): void {
  update('bufferMinutes', Math.min(60, Math.max(0, Math.round(v))));
}

export interface CommuteSettingsApi extends CommuteSettings {
  ready: boolean;
  setEnabled: (v: boolean) => void;
  setWeekdays: (v: readonly number[]) => void;
  setTargetMinuteOfDay: (v: number) => void;
  setBufferMinutes: (v: number) => void;
}

/**
 * Commute settings shared across the app. Setters persist immediately; they
 * do not reschedule — call `syncCommuteReminders` afterwards (and
 * `ensureNotificationPermission` first when turning reminders on).
 */
export function useCommuteSettings(): CommuteSettingsApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    loadCommuteSettings().catch(() => {});
  }, []);
  return useMemo(
    () => ({
      ...snap.settings,
      ready: snap.ready,
      setEnabled: setCommuteEnabled,
      setWeekdays: setCommuteWeekdays,
      setTargetMinuteOfDay: setCommuteTargetMinuteOfDay,
      setBufferMinutes: setCommuteBufferMinutes,
    }),
    [snap],
  );
}

// ---------------------------------------------------------------------------
// Target snapshot (for the background task)
// ---------------------------------------------------------------------------

export interface CommuteTarget {
  routeCode: string;
  stopId: string;
  stopName: string;
  walkMinutes: number;
}

/**
 * The last target synced in the foreground. The background task falls back
 * to it when the main `bt.*` settings (stored WHEN_UNLOCKED) can't be read.
 */
export async function loadLastCommuteTarget(): Promise<
  (CommuteTarget & { use24h: boolean }) | null
> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.lastTarget, STORE_OPTS);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CommuteTarget>;
    if (
      typeof v.routeCode !== 'string' ||
      typeof v.stopId !== 'string' ||
      !v.routeCode ||
      !v.stopId
    ) {
      return null;
    }
    return {
      routeCode: v.routeCode,
      stopId: v.stopId,
      stopName: typeof v.stopName === 'string' ? v.stopName : '',
      walkMinutes: typeof v.walkMinutes === 'number' ? v.walkMinutes : 0,
      use24h: (v as { use24h?: unknown }).use24h !== false,
    };
  } catch {
    return null;
  }
}

async function saveLastCommuteTarget(
  t: CommuteTarget,
  use24h: boolean,
): Promise<void> {
  const value = {
    routeCode: t.routeCode,
    stopId: t.stopId,
    stopName: t.stopName,
    walkMinutes: t.walkMinutes,
    use24h,
  };
  try {
    await SecureStore.setItemAsync(KEYS.lastTarget, JSON.stringify(value), STORE_OPTS);
  } catch (err) {
    console.warn('[commute] failed to save target', err);
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type CommuteSyncStatus =
  | 'scheduled'
  /** Reminders are off; any pending commute reminders were cancelled. */
  | 'disabled'
  /** Permission not granted; nothing changed (we never prompt here). */
  | 'no-permission'
  /** No timetable for this route/stop in the next days; existing reminders kept. */
  | 'no-data'
  /** Settings or DB unreadable; nothing changed. */
  | 'error';

export interface CommuteSyncResult {
  status: CommuteSyncStatus;
  scheduled: number;
  nextFireAtMs: number | null;
}

export interface SyncCommuteParams extends CommuteTarget {
  /** Override the clock (tests / dev). */
  now?: number;
  /** 24-hour copy; defaults to the app's current clock preference. */
  use24h?: boolean;
}

let syncChain: Promise<unknown> = Promise.resolve();

/**
 * Re-plans commute reminders for the next 7 days: loads settings + timetable,
 * plans, replaces every pending `commute-*` notification. Never prompts for
 * permission. Calls are serialised. Safe with an empty database.
 */
export function syncCommuteReminders(
  params: SyncCommuteParams,
): Promise<CommuteSyncResult> {
  const run = syncChain.then(
    () => doSync(params),
    () => doSync(params),
  );
  syncChain = run.catch(() => {});
  return run;
}

async function doSync(p: SyncCommuteParams): Promise<CommuteSyncResult> {
  const none = (status: CommuteSyncStatus): CommuteSyncResult => ({
    status,
    scheduled: 0,
    nextFireAtMs: null,
  });

  let settings: CommuteSettings;
  try {
    settings = await loadCommuteSettings();
  } catch {
    return none('error');
  }

  const use24h = p.use24h ?? getClockUse24h();
  if (p.routeCode && p.stopId) await saveLastCommuteTarget(p, use24h);

  if (!settings.enabled) {
    await cancelAllCommuteReminders().catch(() => {});
    return none('disabled');
  }
  if (!(await hasNotificationPermission())) return none('no-permission');
  if (!p.routeCode || !p.stopId) return none('no-data');

  const now = p.now ?? Date.now();
  const departuresByDay: Record<string, number[]> = {};
  let total = 0;
  try {
    const db = await openDb();
    for (const day of upcomingServiceDates(now, COMMUTE_PLAN_DAYS)) {
      const deps = await getDeparturesForDate(db, {
        routeCode: p.routeCode,
        stopId: p.stopId,
        // Noon keeps us unambiguously inside the Malaysia service date.
        serviceDate: new Date(day.midnightMs + 12 * 3_600_000),
      });
      departuresByDay[day.date] = deps.map((d) => d.departureEpochMs);
      total += deps.length;
    }
  } catch (err) {
    console.warn('[commute] timetable read failed', err);
    return none('error');
  }
  // An empty/uninitialised DB must not wipe reminders planned earlier.
  if (total === 0) return none('no-data');

  try {
    const slots = await getCommuteSlots();
    const planned = planCommuteReminders({
      rules: settings,
      departuresByDay,
      walkMinutes: p.walkMinutes,
      bufferMinutes: settings.bufferMinutes,
      now,
      days: COMMUTE_PLAN_DAYS,
      routeCode: p.routeCode,
      stopName: p.stopName || undefined,
      maxReminders: slots.maxReminders,
      formatClock: (ms) => formatMalaysiaClock(ms, use24h),
    }).filter(
      // One notification per moment: a pending live "leave now" wins.
      (r) => !slots.otherFireTimesMs.some((t) => isSameMoment(t, r.fireAtMs)),
    );
    const scheduled = await replaceCommuteReminders(planned, {
      routeCode: p.routeCode,
      stopId: p.stopId,
    });
    return {
      status: 'scheduled',
      scheduled,
      nextFireAtMs: planned[0]?.fireAtMs ?? null,
    };
  } catch (err) {
    console.warn('[commute] scheduling failed', err);
    return none('error');
  }
}
