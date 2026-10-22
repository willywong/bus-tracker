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

import { setClockUse24h } from '@/components/tracker/logic';

export type ClockFormat = '12h' | '24h';

export const CLOCK_FORMATS: readonly ClockFormat[] = ['24h', '12h'];

export type MapType = 'standard' | 'satellite';

/** A place you plan to often: Home, Work or a pin (plan 15/07 edits them). */
export type SavedPlace = {
  /** 'home' | 'work' | `pin-${createdAt}` */
  id: string;
  kind: 'home' | 'work' | 'pin';
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** When saved from a local result (a bus stop or rail station). */
  ref: { kind: 'stop' | 'station'; id: string } | null;
  createdAt: number;
};

export const MAP_TYPES: readonly MapType[] = ['standard', 'satellite'];

export const NOTIF_BUFFER_CHOICES_MIN: readonly number[] = [0, 1, 2, 3, 5];

export const MAX_FAVORITES = 10;

export type AddFavoriteResult =
  | { ok: true }
  | { ok: false; reason: 'already-favorited' | 'cap-reached' };

export interface Settings {
  walkMinutes: number;
  notifBufferMin: number;
  /** Ordered list of favorited route codes. Drives the switcher and the realtime poll. */
  favoritedRoutes: string[];
  /** Per-route boarding stop id. Keys are entries of `favoritedRoutes`. */
  preferredStopByRoute: Record<string, string>;
  /** Currently active route. Null when the favorites list is empty. */
  preferredRouteCode: string | null;
  /** Quiet hours start, minute-of-day (0–1439). */
  quietStartMin: number;
  /** Quiet hours end, minute-of-day (0–1439). */
  quietEndMin: number;
  /** 12-hour (AM/PM) vs 24-hour clock for ETA / arrival time displays. */
  clockFormat: ClockFormat;
  /** Apple Maps base layer for the Map screen. */
  mapType: MapType;
  /** Home, Work and pinned places for the journey planner. */
  savedPlaces: SavedPlace[];
}

export const DEFAULT_SETTINGS: Settings = {
  walkMinutes: 10,
  notifBufferMin: 1,
  favoritedRoutes: [],
  preferredStopByRoute: {},
  preferredRouteCode: null,
  quietStartMin: 22 * 60,
  quietEndMin: 6 * 60,
  clockFormat: '24h',
  mapType: 'standard',
  savedPlaces: [],
};

export interface SettingsApi extends Settings {
  ready: boolean;
  /**
   * Boarding stop for the *currently active* route, or '' when no favorites
   * are configured. Derived from `preferredStopByRoute[preferredRouteCode]`.
   */
  preferredStopId: string;
  setWalkMinutes: (v: number) => void;
  setNotifBufferMin: (v: number) => void;
  /** Sets the boarding stop for the currently active route. No-op when none is active. */
  setPreferredStopId: (v: string) => void;
  setPreferredStopForRoute: (routeCode: string, stopId: string) => void;
  setPreferredRouteCode: (v: string | null) => void;
  setQuietStartMin: (v: number) => void;
  setQuietEndMin: (v: number) => void;
  setClockFormat: (v: ClockFormat) => void;
  setMapType: (v: MapType) => void;
  setSavedPlaces: (next: SavedPlace[]) => void;
  /**
   * Adds `code` to the favorites list with a default stop. Returns
   * `{ ok: false }` with a reason when blocked (already favorited, or cap
   * reached) so callers can surface UI feedback.
   */
  addFavorite: (code: string, stopId: string) => AddFavoriteResult;
  /** Removes `code` from favorites and its stop mapping. Picks a new active route if the removed one was active. */
  removeFavorite: (code: string) => void;
  /** Reorders the favorites list. The new list must contain exactly the same codes. */
  reorderFavorites: (nextOrder: string[]) => void;
}

const STORAGE_KEYS = {
  walkMinutes: 'bt.walkMinutes',
  notifBufferMin: 'bt.notifBufferMin',
  favoritedRoutes: 'bt.favoritedRoutes',
  preferredStopByRoute: 'bt.preferredStopByRoute',
  preferredRouteCode: 'bt.preferredRouteCode',
  quietStartMin: 'bt.quietStartMin',
  quietEndMin: 'bt.quietEndMin',
  clockFormat: 'bt.clockFormat',
  mapType: 'bt.mapType',
  savedPlaces: 'bt.savedPlaces',
} as const;

const SettingsContext = createContext<SettingsApi | null>(null);

function parseIntOr(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseRouteOr(
  value: string | null,
  knownFavorites: readonly string[],
): string | null {
  if (!value) return null;
  return knownFavorites.includes(value) ? value : null;
}

function parseClockFormatOr(
  value: string | null,
  fallback: ClockFormat,
): ClockFormat {
  return value && CLOCK_FORMATS.includes(value as ClockFormat)
    ? (value as ClockFormat)
    : fallback;
}

function parseMapTypeOr(value: string | null, fallback: MapType): MapType {
  return value && MAP_TYPES.includes(value as MapType)
    ? (value as MapType)
    : fallback;
}

function parseFavoritedRoutes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== 'string' || v.length === 0) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

function parseStopByRoute(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && k.length > 0 && typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const SAVED_PLACE_KINDS: readonly SavedPlace['kind'][] = ['home', 'work', 'pin'];

function parseSavedPlace(v: unknown): SavedPlace | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (!SAVED_PLACE_KINDS.includes(o.kind as SavedPlace['kind'])) return null;
  if (typeof o.name !== 'string') return null;
  if (typeof o.lat !== 'number' || !Number.isFinite(o.lat)) return null;
  if (typeof o.lng !== 'number' || !Number.isFinite(o.lng)) return null;
  const r = o.ref as Record<string, unknown> | null | undefined;
  const ref: SavedPlace['ref'] =
    r && (r.kind === 'stop' || r.kind === 'station') && typeof r.id === 'string'
      ? { kind: r.kind, id: r.id }
      : null;
  return {
    id: o.id,
    kind: o.kind as SavedPlace['kind'],
    name: o.name,
    address: typeof o.address === 'string' ? o.address : null,
    lat: o.lat,
    lng: o.lng,
    ref,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
  };
}

/** Malformed entries and repeated ids are dropped. */
function parseSavedPlaces(raw: string | null): SavedPlace[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SavedPlace[] = [];
    const seen = new Set<string>();
    for (const v of parsed) {
      const place = parseSavedPlace(v);
      if (!place || seen.has(place.id)) continue;
      seen.add(place.id);
      out.push(place);
    }
    return out;
  } catch {
    return [];
  }
}

async function loadFromStore(): Promise<Settings> {
  const [
    walk,
    buffer,
    favoritesRaw,
    stopByRouteRaw,
    route,
    quietStart,
    quietEnd,
    clockFormat,
    mapType,
    savedPlacesRaw,
  ] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEYS.walkMinutes),
    SecureStore.getItemAsync(STORAGE_KEYS.notifBufferMin),
    SecureStore.getItemAsync(STORAGE_KEYS.favoritedRoutes),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredStopByRoute),
    SecureStore.getItemAsync(STORAGE_KEYS.preferredRouteCode),
    SecureStore.getItemAsync(STORAGE_KEYS.quietStartMin),
    SecureStore.getItemAsync(STORAGE_KEYS.quietEndMin),
    SecureStore.getItemAsync(STORAGE_KEYS.clockFormat),
    SecureStore.getItemAsync(STORAGE_KEYS.mapType),
    SecureStore.getItemAsync(STORAGE_KEYS.savedPlaces),
  ]);

  const favoritedRoutes = parseFavoritedRoutes(favoritesRaw);
  const preferredStopByRoute = parseStopByRoute(stopByRouteRaw);
  const preferredRouteCode = parseRouteOr(route, favoritedRoutes);

  return {
    walkMinutes: parseIntOr(walk, DEFAULT_SETTINGS.walkMinutes),
    notifBufferMin: parseIntOr(buffer, DEFAULT_SETTINGS.notifBufferMin),
    favoritedRoutes,
    preferredStopByRoute,
    preferredRouteCode,
    quietStartMin: parseIntOr(quietStart, DEFAULT_SETTINGS.quietStartMin),
    quietEndMin: parseIntOr(quietEnd, DEFAULT_SETTINGS.quietEndMin),
    clockFormat: parseClockFormatOr(clockFormat, DEFAULT_SETTINGS.clockFormat),
    mapType: parseMapTypeOr(mapType, DEFAULT_SETTINGS.mapType),
    savedPlaces: parseSavedPlaces(savedPlacesRaw),
  };
}

function writeValue(key: string, value: string): void {
  SecureStore.setItemAsync(key, value).catch((err) => {
    console.warn(`[settings] failed to persist ${key}`, err);
  });
}

function deleteValue(key: string): void {
  SecureStore.deleteItemAsync(key).catch((err) => {
    console.warn(`[settings] failed to delete ${key}`, err);
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
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
    (routeCode: string, stopId: string) => {
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

  // Legacy alias: writes to the currently active route's slot. No-op when
  // no route is active (empty favorites list).
  const setPreferredStopId = useCallback((v: string) => {
    setState((prev) => {
      const route = prev.preferredRouteCode;
      if (!route) return prev;
      if (prev.preferredStopByRoute[route] === v) return prev;
      const next = { ...prev.preferredStopByRoute, [route]: v };
      writeValue(STORAGE_KEYS.preferredStopByRoute, JSON.stringify(next));
      return { ...prev, preferredStopByRoute: next };
    });
  }, []);

  const setPreferredRouteCode = useCallback((v: string | null) => {
    setState((prev) => {
      const next = v && prev.favoritedRoutes.includes(v) ? v : null;
      if (prev.preferredRouteCode === next) return prev;
      if (next == null) deleteValue(STORAGE_KEYS.preferredRouteCode);
      else writeValue(STORAGE_KEYS.preferredRouteCode, next);
      return { ...prev, preferredRouteCode: next };
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

  const setClockFormat = useCallback((v: ClockFormat) => {
    setState((prev) => {
      if (prev.clockFormat === v) return prev;
      writeValue(STORAGE_KEYS.clockFormat, v);
      return { ...prev, clockFormat: v };
    });
  }, []);

  const setMapType = useCallback((v: MapType) => {
    setState((prev) => {
      if (prev.mapType === v) return prev;
      writeValue(STORAGE_KEYS.mapType, v);
      return { ...prev, mapType: v };
    });
  }, []);

  const setSavedPlaces = useCallback((next: SavedPlace[]) => {
    setState((prev) => {
      if (prev.savedPlaces === next) return prev;
      writeValue(STORAGE_KEYS.savedPlaces, JSON.stringify(next));
      return { ...prev, savedPlaces: next };
    });
  }, []);

  const addFavorite = useCallback(
    (code: string, stopId: string): AddFavoriteResult => {
      let result: AddFavoriteResult = { ok: true };
      setState((prev) => {
        if (prev.favoritedRoutes.includes(code)) {
          result = { ok: false, reason: 'already-favorited' };
          return prev;
        }
        if (prev.favoritedRoutes.length >= MAX_FAVORITES) {
          result = { ok: false, reason: 'cap-reached' };
          return prev;
        }
        const nextFavorites = [...prev.favoritedRoutes, code];
        const nextStops = { ...prev.preferredStopByRoute, [code]: stopId };
        const nextActive = prev.preferredRouteCode ?? code;
        writeValue(STORAGE_KEYS.favoritedRoutes, JSON.stringify(nextFavorites));
        writeValue(
          STORAGE_KEYS.preferredStopByRoute,
          JSON.stringify(nextStops),
        );
        if (nextActive !== prev.preferredRouteCode) {
          writeValue(STORAGE_KEYS.preferredRouteCode, nextActive);
        }
        return {
          ...prev,
          favoritedRoutes: nextFavorites,
          preferredStopByRoute: nextStops,
          preferredRouteCode: nextActive,
        };
      });
      return result;
    },
    [],
  );

  const removeFavorite = useCallback((code: string) => {
    setState((prev) => {
      if (!prev.favoritedRoutes.includes(code)) return prev;
      const nextFavorites = prev.favoritedRoutes.filter((c) => c !== code);
      const nextStops = { ...prev.preferredStopByRoute };
      delete nextStops[code];
      const nextActive =
        prev.preferredRouteCode === code
          ? nextFavorites[0] ?? null
          : prev.preferredRouteCode;
      writeValue(STORAGE_KEYS.favoritedRoutes, JSON.stringify(nextFavorites));
      writeValue(
        STORAGE_KEYS.preferredStopByRoute,
        JSON.stringify(nextStops),
      );
      if (nextActive !== prev.preferredRouteCode) {
        if (nextActive == null) deleteValue(STORAGE_KEYS.preferredRouteCode);
        else writeValue(STORAGE_KEYS.preferredRouteCode, nextActive);
      }
      return {
        ...prev,
        favoritedRoutes: nextFavorites,
        preferredStopByRoute: nextStops,
        preferredRouteCode: nextActive,
      };
    });
  }, []);

  const reorderFavorites = useCallback((nextOrder: string[]) => {
    setState((prev) => {
      if (nextOrder.length !== prev.favoritedRoutes.length) return prev;
      const current = new Set(prev.favoritedRoutes);
      for (const c of nextOrder) if (!current.has(c)) return prev;
      if (nextOrder.every((c, i) => c === prev.favoritedRoutes[i])) return prev;
      writeValue(STORAGE_KEYS.favoritedRoutes, JSON.stringify(nextOrder));
      return { ...prev, favoritedRoutes: nextOrder };
    });
  }, []);

  // Sync the module-level clock preference used by pure formatters
  // (`formatClockHHMM`). Done during render (idempotent) rather than in an
  // effect so providers and screens rendered below in the same pass already
  // format with the new setting.
  setClockUse24h(state.clockFormat === '24h');

  const api: SettingsApi = {
    ...state,
    ready,
    preferredStopId:
      state.preferredRouteCode != null
        ? state.preferredStopByRoute[state.preferredRouteCode] ?? ''
        : '',
    setWalkMinutes,
    setNotifBufferMin,
    setPreferredStopId,
    setPreferredStopForRoute,
    setPreferredRouteCode,
    setQuietStartMin,
    setQuietEndMin,
    setClockFormat,
    setMapType,
    setSavedPlaces,
    addFavorite,
    removeFavorite,
    reorderFavorites,
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
