import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { registerPushToken } from '@/services/pushRegistration';
import { useSettings, type SettingsApi } from '@/hooks/useSettings';

export type PushPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'unavailable';

export interface PushRegistrationState {
  permission: PushPermissionStatus;
  token: string | null;
  registeredAt: number | null;
  lastError: Error | null;
}

const DEVICE_ID_KEY = 'bt.deviceId';

function generateDeviceId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function loadOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing && existing.length > 0) return existing;
  } catch (err) {
    console.warn('[push] failed to read deviceId', err);
  }
  const next = generateDeviceId();
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, next);
  } catch (err) {
    console.warn('[push] failed to persist deviceId', err);
  }
  return next;
}

function getProjectId(): string | undefined {
  const extra =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ??
    (Constants.easConfig as Record<string, unknown> | undefined);
  const eas = extra?.eas as { projectId?: string } | undefined;
  return eas?.projectId ?? Constants.easConfig?.projectId;
}

function settingsToPayload(s: SettingsApi) {
  return {
    walkMinutes: s.walkMinutes,
    notifBufferMin: s.notifBufferMin,
    preferredStopId: s.preferredStopId,
    quietStartMin: s.quietStartMin,
    quietEndMin: s.quietEndMin,
  };
}

/**
 * Requests notification permission on first launch, fetches an Expo push
 * token, and POSTs token + current settings to the backend. Re-POSTs whenever
 * settings change so the cron always has the latest user config.
 *
 * Returns permission status so UI (e.g. Tracker) can surface a denied banner.
 */
export function usePushRegistration(): PushRegistrationState {
  const settings = useSettings();
  const [state, setState] = useState<PushRegistrationState>({
    permission: 'unknown',
    token: null,
    registeredAt: null,
    lastError: null,
  });

  const deviceIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Step 1: ask permission + get token once (only after settings load).
  useEffect(() => {
    if (!settings.ready) return;
    let cancelled = false;

    (async () => {
      if (!Device.isDevice) {
        if (!cancelled) {
          setState((s) => ({ ...s, permission: 'unavailable' }));
        }
        return;
      }

      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        } catch (err) {
          console.warn('[push] android channel setup failed', err);
        }
      }

      try {
        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status === 'undetermined') {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') {
          if (!cancelled) {
            setState((s) => ({ ...s, permission: 'denied' }));
          }
          return;
        }

        const projectId = getProjectId();
        const { data: token } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );

        if (cancelled) return;

        tokenRef.current = token;
        const deviceId =
          deviceIdRef.current ?? (await loadOrCreateDeviceId());
        deviceIdRef.current = deviceId;

        setState((s) => ({
          ...s,
          permission: 'granted',
          token,
          lastError: null,
        }));
      } catch (err) {
        console.warn('[push] permission or token fetch failed', err);
        if (!cancelled) {
          setState((s) => ({
            ...s,
            lastError: err instanceof Error ? err : new Error(String(err)),
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.ready]);

  // Step 2: send latest token+settings to backend whenever either changes.
  useEffect(() => {
    const token = tokenRef.current;
    const deviceId = deviceIdRef.current;
    if (!token || !deviceId || !settings.ready) return;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await registerPushToken({
          deviceId,
          token,
          settings: settingsToPayload(settings),
          signal: controller.signal,
        });
        setState((s) => ({
          ...s,
          registeredAt: res.registeredAt,
          lastError: null,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn('[push] register failed', err);
        setState((s) => ({
          ...s,
          lastError: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    state.token,
    settings.ready,
    settings.walkMinutes,
    settings.notifBufferMin,
    settings.preferredStopId,
    settings.quietStartMin,
    settings.quietEndMin,
  ]);

  return state;
}
