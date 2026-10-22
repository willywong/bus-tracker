import { haversineMeters } from '@bus-tracker/shared';
import type { SFSymbol } from 'expo-symbols';

import type { Completion, LatLng, MapsErrorCode, Region, ResolvedPlace } from '@/modules/transit-maps';

import { ADDRESS_SYMBOL, placeSymbol } from './categories';

/**
 * As-you-type Apple place search for the plan sheet (spec §5, §6.1). The
 * native calls and the timers are injected, so the debounce, supersede and
 * resolve-top-3 rules run under `tsx --test`; `hooks/usePlaceSearch.ts` is
 * the thin React wrapper.
 */

export type PlaceHit = Completion & {
  /** `mappin` until resolved, then the category glyph. */
  symbol: SFSymbol;
  /** From `near`, once resolved and when `near` is known. */
  meters: number | null;
  resolved?: ResolvedPlace;
};

export interface PlaceSearchState {
  places: PlaceHit[];
  /** The last call failed with `ERR_OFFLINE`; `places` is empty. */
  offline: boolean;
  /** A completion for the current query is pending. */
  loading: boolean;
}

export interface PlaceSearchDeps {
  complete(query: string, region: Region): Promise<{ results: Completion[]; superseded: boolean }>;
  resolve(id: string): Promise<ResolvedPlace>;
  /** Runs `fn` after `ms`; returns a cancel. */
  schedule(fn: () => void, ms: number): () => void;
  errorCode(e: unknown): MapsErrorCode;
  /** Used when `near` is unknown (the Klang Valley box). */
  fallbackRegion: Region;
}

/** Keystrokes closer together than this make one query. */
export const COMPLETE_DEBOUNCE_MS = 120;
/** Typing idle this long resolves the top hits. */
export const RESOLVE_IDLE_MS = 400;
export const RESOLVE_TOP = 3;
export const MIN_QUERY = 2;
/** Width and height of the completer's region around `near`. */
export const NEAR_BOX_METERS = 20_000;

export const EMPTY_PLACES: PlaceSearchState = { places: [], offline: false, loading: false };

const METERS_PER_DEG_LAT = 111_320;

/** A box `NEAR_BOX_METERS` across centred on `p`. */
export function regionAround(p: LatLng, meters = NEAR_BOX_METERS): Region {
  const latDelta = meters / METERS_PER_DEG_LAT;
  const lngDelta = meters / (METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat, lng: p.lng, latDelta, lngDelta };
}

export interface PlaceSearch {
  /** The query (trimmed here) and the point distances are measured from. */
  setQuery(query: string, near: LatLng | null): void;
  /** A pick's own `resolve()` hit `ERR_OFFLINE`: show the offline row. */
  reportOffline(): void;
  dispose(): void;
}

export function createPlaceSearch(
  deps: PlaceSearchDeps,
  onChange: (s: PlaceSearchState) => void,
): PlaceSearch {
  let state: PlaceSearchState = EMPTY_PLACES;
  /** Bumped by every query; async work for an older one is dropped. */
  let gen = 0;
  let near: LatLng | null = null;
  let cancelComplete: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  /** The current query's batch has arrived. */
  let batchIn = false;
  /** Typing has paused for `RESOLVE_IDLE_MS`. */
  let idle = false;
  let resolving = false;
  let disposed = false;

  const set = (next: Partial<PlaceSearchState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    onChange(state);
  };

  const cancelTimers = () => {
    cancelComplete?.();
    cancelIdle?.();
    cancelComplete = cancelIdle = null;
  };

  const goOffline = () => set({ places: [], offline: true, loading: false });

  async function resolveTop(my: number) {
    if (resolving || !batchIn || !idle) return;
    resolving = true;
    const top = state.places.slice(0, RESOLVE_TOP).filter((p) => !p.resolved);
    for (const hit of top) {
      let place: ResolvedPlace;
      try {
        place = await deps.resolve(hit.id);
      } catch (e) {
        if (my !== gen) return;
        if (deps.errorCode(e) === 'ERR_OFFLINE') {
          goOffline();
          return;
        }
        continue; // not found or throttled: this row keeps its pin
      }
      if (my !== gen) return;
      const meters = near ? haversineMeters(near, place) : null;
      set({
        places: state.places.map((p) =>
          p.id === hit.id ? { ...p, resolved: place, symbol: placeSymbol(place.category), meters } : p,
        ),
      });
    }
  }

  async function runComplete(my: number, query: string) {
    cancelComplete = null;
    let batch: { results: Completion[]; superseded: boolean };
    try {
      batch = await deps.complete(query, near ? regionAround(near) : deps.fallbackRegion);
    } catch (e) {
      if (my !== gen) return;
      if (deps.errorCode(e) === 'ERR_OFFLINE') goOffline();
      else set({ places: [], offline: false, loading: false });
      return;
    }
    if (my !== gen || batch.superseded) return;
    batchIn = true;
    set({
      places: batch.results.map((c) => ({ ...c, symbol: ADDRESS_SYMBOL, meters: null })),
      offline: false,
      loading: false,
    });
    void resolveTop(my);
  }

  return {
    setQuery(raw, at) {
      const query = raw.trim();
      const my = ++gen;
      near = at;
      cancelTimers();
      batchIn = false;
      idle = false;
      resolving = false;
      if (query.length < MIN_QUERY) {
        set(EMPTY_PLACES);
        return;
      }
      // Earlier rows stay until the new batch replaces them, so the section
      // doesn't blink on every keystroke.
      set({ loading: true });
      cancelComplete = deps.schedule(() => void runComplete(my, query), COMPLETE_DEBOUNCE_MS);
      cancelIdle = deps.schedule(() => {
        cancelIdle = null;
        idle = true;
        void resolveTop(my);
      }, RESOLVE_IDLE_MS);
    },
    reportOffline() {
      gen++;
      cancelTimers();
      goOffline();
    },
    dispose() {
      disposed = true;
      gen++;
      cancelTimers();
    },
  };
}
