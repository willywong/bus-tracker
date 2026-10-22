/**
 * On-device reminder notifications. No server: every alert is a local
 * notification scheduled from the timetable or a live estimate.
 *
 * Principles:
 * - Nothing here prompts for permission except `ensureNotificationPermission`,
 *   which callers invoke in context (e.g. when the user turns a reminder on).
 * - One stable identifier per kind of alert, so scheduling again replaces the
 *   previous one instead of stacking ("one notification per moment").
 * - Copy says whether a time is "scheduled" or a "live estimate".
 */
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { getClockUse24h } from '@/components/tracker/logic';

import {
  COMMUTE_MAX_PENDING,
  GO_ALERT_IDS,
  IOS_MAX_PENDING_NOTIFICATIONS,
  RESERVED_NOTIFICATION_SLOTS,
  formatMalaysiaClock,
  isCommuteReminderId,
  isSameMoment,
  lastBusLeaveBy,
  type JourneyAlert,
  type PlannedReminder,
} from './plan';
import { mins } from '@/components/trip/model';

export const LEAVE_NOW_ID = 'bt.leave-now';
export const LAST_BUS_ID = 'bt.last-bus';
export const GET_OFF_ID = 'bt.get-off';
export const DEPARTURE_ID = 'bt.departure';
/** Android channel for reminders (iOS ignores channels). */
export const REMINDER_CHANNEL_ID = 'reminders';

export type ReminderKind = 'leave-now' | 'last-bus' | 'get-off' | 'commute' | 'departure' | 'go';

const MINUTE_MS = 60_000;

function clock(epochMs: number): string {
  return formatMalaysiaClock(epochMs, getClockUse24h());
}

function dateTrigger(atMs: number): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: atMs,
    ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : null),
  };
}

// ---------------------------------------------------------------------------
// Setup + permission
// ---------------------------------------------------------------------------

let configured = false;

/**
 * Call once at startup (module scope or root layout). Shows our alerts as
 * banners while the app is in the foreground, and creates the Android
 * channel. Does NOT ask for permission.
 */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const level =
        'interruptionLevel' in notification.request.content
          ? notification.request.content.interruptionLevel
          : undefined;
      const urgent = level === 'timeSensitive' || level === 'critical';
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: urgent,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Bus reminders',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch((err) => {
      console.warn('[reminders] android channel setup failed', err);
    });
  }
}

function isGranted(p: Notifications.NotificationPermissionsStatus): boolean {
  if (p.granted) return true;
  const ios = p.ios?.status;
  return (
    ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

/** Never prompts. True when local notifications can currently be delivered. */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return isGranted(await Notifications.getPermissionsAsync());
  } catch {
    return false;
  }
}

/**
 * Asks for notification permission only if it hasn't been decided yet. Call
 * in context (the user just turned a reminder on), never at launch. Returns
 * whether notifications are allowed. When the user previously declined,
 * returns false without prompting: the caller should offer a link to Settings.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (isGranted(current)) return true;
    if (current.status !== 'undetermined' && !current.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return isGranted(next);
  } catch (err) {
    console.warn('[reminders] permission request failed', err);
    return false;
  }
}

async function cancelById(id: string): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    Notifications.dismissNotificationAsync(id).catch(() => {}),
  ]);
}

// ---------------------------------------------------------------------------
// Leave now
// ---------------------------------------------------------------------------

export interface LeaveNowParams {
  routeCode: string;
  stopName: string;
  /** When the user should start walking. */
  leaveAtMs: number;
  /** When the bus is expected at the stop. */
  busAtMs: number;
  /** True when `busAtMs` comes from live vehicle positions, false for the timetable. */
  live: boolean;
}

/**
 * Schedules the single "Leave now" alert, replacing any previous one. Returns
 * the identifier, or null when `leaveAtMs` has already passed (the previous
 * alert is still cancelled: it was for an older plan). A commute reminder for
 * the same moment is cancelled so the user gets one alert, not two.
 */
export async function scheduleLeaveNow(
  p: LeaveNowParams,
  now: number = Date.now(),
): Promise<string | null> {
  await cancelLeaveNow();
  if (!(p.leaveAtMs > now)) return null;

  await cancelCommuteRemindersNear(p.leaveAtMs);

  const minutes = Math.max(1, Math.round((p.busAtMs - p.leaveAtMs) / MINUTE_MS));
  const source = p.live ? 'live estimate' : 'scheduled';
  return Notifications.scheduleNotificationAsync({
    identifier: LEAVE_NOW_ID,
    content: {
      title: `Leave now for ${p.routeCode}`,
      body: `Bus at ${p.stopName} in ~${mins(minutes)} (${source})`,
      interruptionLevel: 'timeSensitive',
      threadIdentifier: `bt.route.${p.routeCode}`,
      sound: 'default',
      data: {
        kind: 'leave-now' satisfies ReminderKind,
        routeCode: p.routeCode,
        fireAtMs: p.leaveAtMs,
        busAtMs: p.busAtMs,
        live: p.live,
      },
    },
    trigger: dateTrigger(p.leaveAtMs),
  });
}

export function cancelLeaveNow(): Promise<void> {
  return cancelById(LEAVE_NOW_ID);
}

// ---------------------------------------------------------------------------
// Departure: one bus picked from the Today grid
// ---------------------------------------------------------------------------

export interface DepartureReminderParams {
  tripId: string;
  routeCode: string;
  stopName: string;
  /** When the user should start walking. */
  leaveAtMs: number;
  /** When the bus is scheduled at the stop. */
  busAtMs: number;
}

/** The pending departure reminder: which bus, and when it fires. */
export interface DepartureReminder {
  tripId: string;
  leaveAtMs: number;
}

/**
 * Schedules "leave now" for one timetabled bus the user picked, replacing
 * any previous pick. Its own slot, so following the hero bus (which owns
 * {@link LEAVE_NOW_ID}) never overwrites it. Returns false when the time to
 * leave has already passed.
 */
export async function scheduleDepartureReminder(
  p: DepartureReminderParams,
  now: number = Date.now(),
): Promise<boolean> {
  await cancelById(DEPARTURE_ID);
  if (!(p.leaveAtMs > now)) return false;
  const minutes = Math.max(1, Math.round((p.busAtMs - p.leaveAtMs) / MINUTE_MS));
  await Notifications.scheduleNotificationAsync({
    identifier: DEPARTURE_ID,
    content: {
      title: `Leave now for the ${clock(p.busAtMs)} ${p.routeCode}`,
      body: `Bus at ${p.stopName} in ~${mins(minutes)} (scheduled)`,
      interruptionLevel: 'timeSensitive',
      threadIdentifier: `bt.route.${p.routeCode}`,
      sound: 'default',
      data: {
        kind: 'departure' satisfies ReminderKind,
        tripId: p.tripId,
        routeCode: p.routeCode,
        fireAtMs: p.leaveAtMs,
        busAtMs: p.busAtMs,
      },
    },
    trigger: dateTrigger(p.leaveAtMs),
  });
  return true;
}

export function cancelDepartureReminder(): Promise<void> {
  return cancelById(DEPARTURE_ID);
}

export async function getDepartureReminder(): Promise<DepartureReminder | null> {
  const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const data = pending.find((n) => n.identifier === DEPARTURE_ID)?.content.data as
    | { tripId?: unknown; fireAtMs?: unknown }
    | undefined;
  return typeof data?.tripId === 'string' && typeof data.fireAtMs === 'number'
    ? { tripId: data.tripId, leaveAtMs: data.fireAtMs }
    : null;
}

/** Cancels pending commute reminders that would fire within the same-moment window. */
async function cancelCommuteRemindersNear(atMs: number): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((r) => isCommuteReminderId(r.identifier))
        .filter((r) => {
          const fireAt = r.content.data?.fireAtMs;
          return typeof fireAt === 'number' && isSameMoment(fireAt, atMs);
        })
        .map((r) => cancelById(r.identifier)),
    );
  } catch (err) {
    console.warn('[reminders] commute dedupe failed', err);
  }
}

// ---------------------------------------------------------------------------
// Commute (planned by plan.ts, scheduled here)
// ---------------------------------------------------------------------------

export interface CommuteSlots {
  /** How many commute reminders may be scheduled without crowding out others. */
  maxReminders: number;
  /** Fire times of pending non-commute alerts we own (leave-now etc.), for dedupe. */
  otherFireTimesMs: number[];
}

/** Reads the pending queue to size the commute budget under iOS's ~64 limit. */
export async function getCommuteSlots(): Promise<CommuteSlots> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const others = pending.filter((r) => !isCommuteReminderId(r.identifier));
  const otherFireTimesMs: number[] = [];
  for (const r of others) {
    const fireAt = r.content.data?.fireAtMs;
    if (typeof fireAt === 'number') otherFireTimesMs.push(fireAt);
  }
  return {
    maxReminders: Math.max(
      0,
      Math.min(
        COMMUTE_MAX_PENDING,
        IOS_MAX_PENDING_NOTIFICATIONS - Math.max(others.length, RESERVED_NOTIFICATION_SLOTS),
      ),
    ),
    otherFireTimesMs,
  };
}

/** Cancels (and clears delivered) every `commute-*` notification. */
export async function cancelAllCommuteReminders(): Promise<void> {
  const [pending, presented] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    Notifications.getPresentedNotificationsAsync().catch(() => []),
  ]);
  await Promise.all([
    ...pending
      .filter((r) => isCommuteReminderId(r.identifier))
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})),
    ...presented
      .filter((n) => isCommuteReminderId(n.request.identifier))
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})),
  ]);
}

/**
 * Replaces all pending commute reminders with `planned`. Does not check
 * permission (callers do, without prompting). Returns how many were scheduled.
 */
export async function replaceCommuteReminders(
  planned: readonly PlannedReminder[],
  meta: { routeCode: string; stopId: string },
): Promise<number> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((r) => isCommuteReminderId(r.identifier))
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})),
  );
  let count = 0;
  for (const r of planned) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: {
          title: r.title,
          body: r.body,
          interruptionLevel: 'timeSensitive',
          threadIdentifier: 'bt.commute',
          sound: 'default',
          data: {
            kind: 'commute' satisfies ReminderKind,
            routeCode: meta.routeCode,
            stopId: meta.stopId,
            fireAtMs: r.fireAtMs,
            departureMs: r.departureMs,
          },
        },
        trigger: dateTrigger(r.fireAtMs),
      });
      count++;
    } catch (err) {
      console.warn(`[reminders] failed to schedule ${r.id}`, err);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Last bus
// ---------------------------------------------------------------------------

export interface LastBusParams {
  routeCode: string;
  stopName: string;
  /** Scheduled departure of the last bus at the stop. */
  lastBusMs: number;
  walkMinutes: number;
  /** How long before leave-by to notify. */
  leadMinutes: number;
}

/**
 * "Last T816 tonight at 23:30 — leave by 23:20". Timetable-based (live data
 * often goes dark overnight), so the copy says "scheduled". Replaces any
 * previous last-bus alert; returns null when the notify time has passed.
 */
export async function scheduleLastBusReminder(
  p: LastBusParams,
  now: number = Date.now(),
): Promise<string | null> {
  await cancelLastBusReminder();
  const { leaveByMs, notifyAtMs } = lastBusLeaveBy(p.lastBusMs, p.walkMinutes, p.leadMinutes);
  if (!(notifyAtMs > now)) return null;

  return Notifications.scheduleNotificationAsync({
    identifier: LAST_BUS_ID,
    content: {
      title: `Last ${p.routeCode} tonight at ${clock(p.lastBusMs)} — leave by ${clock(leaveByMs)}`,
      body: `From ${p.stopName}. Scheduled time; live tracking may be unavailable late at night.`,
      interruptionLevel: 'timeSensitive',
      threadIdentifier: `bt.route.${p.routeCode}`,
      sound: 'default',
      data: {
        kind: 'last-bus' satisfies ReminderKind,
        routeCode: p.routeCode,
        fireAtMs: notifyAtMs,
        lastBusMs: p.lastBusMs,
      },
    },
    trigger: dateTrigger(notifyAtMs),
  });
}

export function cancelLastBusReminder(): Promise<void> {
  return cancelById(LAST_BUS_ID);
}

// ---------------------------------------------------------------------------
// Get off
// ---------------------------------------------------------------------------

export interface GetOffParams {
  stopName: string;
  /** When to alert (typically ~1 stop before the destination). Past/now = immediately. */
  atMs: number;
}

/** "Your stop is next: <name>". Replaces any previous get-off alert. */
export async function scheduleGetOffAlert(
  p: GetOffParams,
  now: number = Date.now(),
): Promise<string> {
  await cancelGetOffAlert();
  return Notifications.scheduleNotificationAsync({
    identifier: GET_OFF_ID,
    content: {
      title: `Your stop is next: ${p.stopName}`,
      body: 'Get ready to get off.',
      interruptionLevel: 'timeSensitive',
      threadIdentifier: 'bt.ride',
      sound: 'default',
      data: { kind: 'get-off' satisfies ReminderKind, fireAtMs: p.atMs },
    },
    // A moment that has already arrived is delivered right away.
    trigger:
      p.atMs > now + 1000
        ? dateTrigger(p.atMs)
        : Platform.OS === 'android'
          ? { channelId: REMINDER_CHANNEL_ID }
          : null,
  });
}

export function cancelGetOffAlert(): Promise<void> {
  return cancelById(GET_OFF_ID);
}

// ---------------------------------------------------------------------------
// Go mode (15/06): leave, change and get-off for one itinerary
// ---------------------------------------------------------------------------

/** The notification request for one Go alert; `trigger: null` delivers it now. */
export function journeyAlertRequest(
  a: JourneyAlert,
  trigger: Notifications.NotificationTriggerInput,
): Notifications.NotificationRequestInput {
  return {
    identifier: a.id,
    content: {
      title: a.title,
      body: a.body,
      interruptionLevel: 'timeSensitive',
      threadIdentifier: 'bt.go',
      sound: 'default',
      data: { kind: 'go' satisfies ReminderKind, fireAtMs: a.atMs, legIndex: a.legIndex },
    },
    trigger,
  };
}

/**
 * Replaces Go's pending alerts with `alerts` (`planJourneyAlerts`, times
 * already on the device clock). Each has its own id, so they never replace
 * each other or the single-route get-off alert. Without permission they
 * are scheduled and never shown; a failure is logged, never thrown.
 */
export async function scheduleJourneyAlerts(
  alerts: readonly JourneyAlert[],
  now: number = Date.now(),
): Promise<number> {
  await Promise.all(
    GO_ALERT_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );
  let count = 0;
  for (const a of alerts) {
    if (!(a.atMs > now)) continue;
    try {
      await Notifications.scheduleNotificationAsync(journeyAlertRequest(a, dateTrigger(a.atMs)));
      count++;
    } catch (err) {
      console.warn(`[reminders] failed to schedule ${a.id}`, err);
    }
  }
  return count;
}

/** Cancels one Go alert (it was announced in the app). */
export function cancelJourneyAlert(id: string): Promise<void> {
  return cancelById(id);
}

/** Cancels (and clears delivered) every Go alert. */
export async function cancelJourneyAlerts(): Promise<void> {
  await Promise.all(GO_ALERT_IDS.map((id) => cancelById(id)));
}

const GET_OFF_PHRASES: Record<string, (stop: string) => string> = {
  en: (s) => `Your stop is next: ${s}. Get ready to get off.`,
  ms: (s) => `Hentian anda seterusnya: ${s}. Sila bersedia untuk turun.`,
  zh: (s) => `下一站是您的站：${s}。请准备下车。`,
  ta: (s) => `அடுத்தது உங்கள் நிறுத்தம்: ${s}. இறங்கத் தயாராகுங்கள்.`,
};

/**
 * Speaks the get-off prompt aloud. `language` is a BCP 47 tag ("en",
 * "en-MY", "ms-MY", "zh-CN", "ta-IN"); the phrase is chosen by its primary
 * subtag (falls back to English), and the tag is passed to the speech engine
 * to pick a voice. Uses a separate audio session so music ducks instead of
 * stopping.
 */
export function speakGetOff(stopName: string, language = 'en'): void {
  const primary = language.toLowerCase().split(/[-_]/)[0] ?? 'en';
  const phrase = (GET_OFF_PHRASES[primary] ?? GET_OFF_PHRASES.en)(stopName);
  Speech.stop()
    .catch(() => {})
    .finally(() => {
      Speech.speak(phrase, {
        language,
        useApplicationAudioSession: false,
      });
    });
}
