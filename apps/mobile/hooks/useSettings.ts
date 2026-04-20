import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type TrafficProvider = 'here' | 'tomtom';

export const TRAFFIC_PROVIDERS: readonly TrafficProvider[] = [
  'here',
  'tomtom',
];

export const NOTIF_BUFFER_CHOICES_MIN: readonly number[] = [0, 1, 2, 3, 5];

const DEFAULT_PREFERRED_STOP_ID = 'HOTEL_LISA_DE_INN';

export interface Settings {
  walkMinutes: number;
  notifBufferMin: number;
  preferredStopId: string;
  trafficProvider: TrafficProvider;
  /** Quiet hours start, minute-of-day (0–1439). */
  quietStartMin: number;
  /** Quiet hours end, minute-of-day (0–1439). */
  quietEndMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  walkMinutes: 10,
  notifBufferMin: 1,
  preferredStopId: DEFAULT_PREFERRED_STOP_ID,
  trafficProvider: 'here',
  quietStartMin: 22 * 60,
  quietEndMin: 6 * 60,
};

export interface SettingsApi extends Settings {
  ready: boolean;
  setWalkMinutes: (v: number) => void;
  setNotifBufferMin: (v: number) => void;
  setPreferredStopId: (v: string) => void;
  setTrafficProvider: (v: TrafficProvider) => void;
  setQuietStartMin: (v: number) => void;
  setQuietEndMin: (v: number) => void;
}

const STORAGE_KEYS = {
  walkMinutes: 'bt.walkMinutes',
  notifBufferMin: 'bt.notifBufferMin',
  preferredStopId: 'bt.preferredStopId',
  trafficProvider: 'bt.trafficProvider',
  quietStartMin: 'bt.quietStartMin',
  quietEndMin: 'bt.quietEndMin',
} as const;

const SettingsContext = createContext<SettingsApi | null>(null);

function parseIntOr(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseProviderOr(
  value: string | null,
  fallback: TrafficProvider,
): TrafficProvider {
  return value && TRAFFIC_PROVIDERS.includes(value as TrafficProvider)
    ? (value as TrafficProvider)
    : fallback;
}

async function loadFromStore(): Promise<Settings> {
  const [
    walk,
    buffer,
    stop,
    provider,
    quietStart,
    quietEnd,
  ] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.walkMinutes),
    SecureStore.getItemAsync(STORAGE_KEYS.notifBufferMin),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredStopId),
    SecureStore.getItemAsync(STORAGE_KEYS.trafficProvider),
    SecureStore.getItemAsync(STORAGE_KEYS.quietStartMin),
    SecureStore.getItemAsync(STORAGE_KEYS.quietEndMin),
  ]);
  return {
    walkMinutes: parseIntOr(walk, DEFAULT_SETTINGS.walkMinutes),
    notifBufferMin: parseIntOr(buffer, DEFAULT_SETTINGS.notifBufferMin),
    preferredStopId: stop ?? DEFAULT_SETTINGS.preferredStopId,
    trafficProvider: parseProviderOr(
      provider,
      DEFAULT_SETTINGS.trafficProvider,
    ),
    quietStartMin: parseIntOr(quietStart, DEFAULT_SETTINGS.quietStartMin),
    quietEndMin: parseIntOr(quietEnd, DEFAULT_SETTINGS.quietEndMin),
  };
}

function writeValue(key: string, value: string): void {
  SecureStore.setItemAsync(key, value).catch((err) => {
    console.warn(`[settings] failed to persist ${key}`, err);
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  // Track whether initial load has finished so we don't overwrite the stored
  // value with the default on mount.
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadFromStore();
        if (!cancelled) {
          setState(loaded);
          loadedRef.current = true;
          setReady(true);
        }
      } catch (err) {
        console.warn('[settings] load failed', err);
        if (!cancelled) {
          loadedRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setWalkMinutes = useCallback((v: number) => {
    setState((prev) => {
      if (prev.walkMinutes === v) return prev;
      writeValue(STORAGE_KEYS.walkMinutes, String(v));
      return { ...prev, walkMinutes: v };
    });
  }, []);

  const setNotifBufferMin = useCallback((v: number) => {
    setState((prev) => {
      if (prev.notifBufferMin === v) return prev;
      writeValue(STORAGE_KEYS.notifBufferMin, String(v));
      return { ...prev, notifBufferMin: v };
    });
  }, []);

  const setPreferredStopId = useCallback((v: string) => {
    setState((prev) => {
      if (prev.preferredStopId === v) return prev;
      writeValue(STORAGE_KEYS.preferredStopId, v);
      return { ...prev, preferredStopId: v };
    });
  }, []);

  const setTrafficProvider = useCallback((v: TrafficProvider) => {
    setState((prev) => {
      if (prev.trafficProvider === v) return prev;
      writeValue(STORAGE_KEYS.trafficProvider, v);
      return { ...prev, trafficProvider: v };
    });
  }, []);

  const setQuietStartMin = useCallback((v: number) => {
    setState((prev) => {
      if (prev.quietStartMin === v) return prev;
      writeValue(STORAGE_KEYS.quietStartMin, String(v));
      return { ...prev, quietStartMin: v };
    });
  }, []);

  const setQuietEndMin = useCallback((v: number) => {
    setState((prev) => {
      if (prev.quietEndMin === v) return prev;
      writeValue(STORAGE_KEYS.quietEndMin, String(v));
      return { ...prev, quietEndMin: v };
    });
  }, []);

  const api: SettingsApi = {
    ...state,
    ready,
    setWalkMinutes,
    setNotifBufferMin,
    setPreferredStopId,
    setTrafficProvider,
    setQuietStartMin,
    setQuietEndMin,
  };

  return createElement(SettingsContext.Provider, { value: api }, children);
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within <SettingsProvider>');
  }
  return ctx;
}
