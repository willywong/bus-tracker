import type { RouteId } from '@bus-tracker/shared';
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

/** Routes exposed in the in-app switcher. Order = user-facing order. */
export const AVAILABLE_ROUTE_CODES: readonly RouteId[] = ['T816', 'T815'];

/**
 * Default boarding stop per route. Routes in AVAILABLE_ROUTE_CODES should have
 * an entry — these IDs are real stop_ids the GTFS bundle ships with, so a
 * fresh install resolves to a working stop on first launch without the user
 * having to open Settings. Partial because RouteId includes routes
 * (T786/PJ01/PJ02) that aren't yet exposed in the in-app switcher.
 */
const STOP_DEFAULTS_BY_ROUTE: Partial<Record<RouteId, string>> = {
  T816: '12000759', // HOTEL LISA DE INN
  T815: '12000750', // MRT PHILEO DAMANSARA PINTU A
};

const DEFAULT_PREFERRED_ROUTE_CODE: RouteId = 'T816';

export interface Settings {
  walkMinutes: number;
  notifBufferMin: number;
  preferredStopByRoute: Partial<Record<RouteId, string>>;
  preferredRouteCode: RouteId;
  trafficProvider: TrafficProvider;
  /** Quiet hours start, minute-of-day (0–1439). */
  quietStartMin: number;
  /** Quiet hours end, minute-of-day (0–1439). */
  quietEndMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  walkMinutes: 10,
  notifBufferMin: 1,
  preferredStopByRoute: { ...STOP_DEFAULTS_BY_ROUTE },
  preferredRouteCode: DEFAULT_PREFERRED_ROUTE_CODE,
  trafficProvider: 'here',
  quietStartMin: 22 * 60,
  quietEndMin: 6 * 60,
};

export interface SettingsApi extends Settings {
  ready: boolean;
  /**
   * Boarding stop for the *currently active* route. Derived from
   * `preferredStopByRoute[preferredRouteCode]` — kept on the API so existing
   * consumers (`useEta`, push registration) don't need to know about the map.
   */
  preferredStopId: string;
  setWalkMinutes: (v: number) => void;
  setNotifBufferMin: (v: number) => void;
  /** Sets the boarding stop for the currently active route. */
  setPreferredStopId: (v: string) => void;
  setPreferredStopForRoute: (routeCode: RouteId, stopId: string) => void;
  setPreferredRouteCode: (v: RouteId) => void;
  setTrafficProvider: (v: TrafficProvider) => void;
  setQuietStartMin: (v: number) => void;
  setQuietEndMin: (v: number) => void;
}

const STORAGE_KEYS = {
  walkMinutes: 'bt.walkMinutes',
  notifBufferMin: 'bt.notifBufferMin',
  /** @deprecated Migrated into preferredStopByRoute on first load post-upgrade. */
  preferredStopId: 'bt.preferredStopId',
  preferredStopByRoute: 'bt.preferredStopByRoute',
  preferredRouteCode: 'bt.preferredRouteCode',
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

function parseRouteOr(value: string | null, fallback: RouteId): RouteId {
  return value && AVAILABLE_ROUTE_CODES.includes(value as RouteId)
    ? (value as RouteId)
    : fallback;
}

function parseStopByRoute(
  raw: string | null,
): Partial<Record<RouteId, string>> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Partial<Record<RouteId, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (AVAILABLE_ROUTE_CODES.includes(k as RouteId) && typeof v === 'string') {
        out[k as RouteId] = v;
      }
    }
    return out;
  } catch {
    return null;
  }
}

function resolveStopByRoute(
  stored: Partial<Record<RouteId, string>> | null,
  legacyStop: string | null,
  legacyRoute: RouteId,
): { value: Partial<Record<RouteId, string>>; migrated: boolean } {
  if (stored) {
    return {
      value: { ...STOP_DEFAULTS_BY_ROUTE, ...stored },
      migrated: false,
    };
  }
  // No new-shape value yet. Seed defaults, then overlay the legacy single
  // `bt.preferredStopId` onto the route it was set under (if any). Persisting
  // is done by the caller so we can do it once on the load path.
  const seeded = { ...STOP_DEFAULTS_BY_ROUTE };
  if (legacyStop) seeded[legacyRoute] = legacyStop;
  return { value: seeded, migrated: legacyStop !== null };
}

async function loadFromStore(): Promise<Settings> {
  const [
    walk,
    buffer,
    legacyStop,
    stopByRouteRaw,
    route,
    provider,
    quietStart,
    quietEnd,
  ] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.walkMinutes),
    SecureStore.getItemAsync(STORAGE_KEYS.notifBufferMin),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredStopId),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredStopByRoute),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredRouteCode),
    SecureStore.getItemAsync(STORAGE_KEYS.trafficProvider),
    SecureStore.getItemAsync(STORAGE_KEYS.quietStartMin),
    SecureStore.getItemAsync(STORAGE_KEYS.quietEndMin),
  ]);

  const preferredRouteCode = parseRouteOr(
    route,
    DEFAULT_SETTINGS.preferredRouteCode,
  );
  const { value: preferredStopByRoute, migrated } = resolveStopByRoute(
    parseStopByRoute(stopByRouteRaw),
    legacyStop,
    preferredRouteCode,
  );
  if (migrated) {
    writeValue(
      STORAGE_KEYS.preferredStopByRoute,
      JSON.stringify(preferredStopByRoute),
    );
  }

  return {
    walkMinutes: parseIntOr(walk, DEFAULT_SETTINGS.walkMinutes),
    notifBufferMin: parseIntOr(buffer, DEFAULT_SETTINGS.notifBufferMin),
    preferredStopByRoute,
    preferredRouteCode,
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

  const setPreferredStopForRoute = useCallback(
    (routeCode: RouteId, stopId: string) => {
      setState((prev) => {
        if (prev.preferredStopByRoute[routeCode] === stopId) return prev;
        const next = { ...prev.preferredStopByRoute, [routeCode]: stopId };
        writeValue(
          STORAGE_KEYS.preferredStopByRoute,
          JSON.stringify(next),
        );
        return { ...prev, preferredStopByRoute: next };
      });
    },
    [],
  );

  // Legacy alias: writes to the currently active route's slot. Kept so any
  // straggler caller from the single-stop era still works.
  const setPreferredStopId = useCallback(
    (v: string) => {
      setState((prev) => {
        const route = prev.preferredRouteCode;
        if (prev.preferredStopByRoute[route] === v) return prev;
        const next = { ...prev.preferredStopByRoute, [route]: v };
        writeValue(
          STORAGE_KEYS.preferredStopByRoute,
          JSON.stringify(next),
        );
        return { ...prev, preferredStopByRoute: next };
      });
    },
    [],
  );

  const setPreferredRouteCode = useCallback((v: RouteId) => {
    setState((prev) => {
      if (prev.preferredRouteCode === v) return prev;
      writeValue(STORAGE_KEYS.preferredRouteCode, v);
      return { ...prev, preferredRouteCode: v };
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
    // `parseRouteOr` guarantees preferredRouteCode ∈ AVAILABLE_ROUTE_CODES,
    // and STOP_DEFAULTS_BY_ROUTE covers every code in that list — so the
    // empty-string fallback is unreachable in practice. We keep it to satisfy
    // the type narrowing through `Partial<Record<RouteId, string>>`.
    preferredStopId:
      state.preferredStopByRoute[state.preferredRouteCode] ??
      STOP_DEFAULTS_BY_ROUTE[state.preferredRouteCode] ??
      '',
    setWalkMinutes,
    setNotifBufferMin,
    setPreferredStopId,
    setPreferredStopForRoute,
    setPreferredRouteCode,
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
