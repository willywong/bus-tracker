import type { Itinerary, LatLng, Place } from '@bus-tracker/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { resolveOpen, type OpenRef } from '@/components/itinerary/model';
import { usePlannerEngine, type PlannerRun } from '@/hooks/usePlannerEngine';
import type { SavedPlace } from '@/hooks/useSettings';
import { placeToPlannerPlace } from '@/services/places/saved';

/** A journey end (spec §4.4), the engine's own type. */
export type { Place };

export type When = { kind: 'now' } | { kind: 'depart'; at: number };
export type { PlannerRun };

export interface PlannerContextValue {
  from: Place;
  to: Place | null;
  when: When;
  setFrom(p: Place): void;
  setTo(p: Place | null): void;
  setWhen(w: When): void;
  /** Swaps from and to; a no-op while `to` is null. */
  swap(): void;
  /** True while `plan` or `itinerary` is on the stack; the trip sheet pins to peek. */
  presented: boolean;
  setPresented(on: boolean): void;
  /** Opens `plan` once the trip sheet exists (quick actions on cold launch). */
  pendingOpen: { to: Place | null } | null;
  requestOpen(to?: Place | null): void;
  clearPending(): void;
  /** The results (15/04): itineraries for this query, re-timed live. */
  run: PlannerRun;
  /**
   * The itinerary opened from the results (`Itinerary.id`), for the
   * `itinerary` sheet (15/05). Kept in step with `run`: when a retime
   * renames it, this moves to its successor (see `resolveOpen`).
   */
  openId: string | null;
  setOpenId(id: string | null): void;
  /** What the sheet shows for `openId`; read it with `useOpenItinerary()`. */
  openItinerary: Itinerary | null;
  /** The `itinerary` sheet's detent: 0 peek, 1 half, 2 large. The map frames the legs above it. */
  itineraryDetent: 0 | 1 | 2;
  setItineraryDetent(d: 0 | 1 | 2): void;
  /** A leg tapped in the timeline; the nonce makes a repeated tap re-fit the map. */
  focusLeg: { index: number; nonce: number } | null;
  focus(index: number): void;
  /** Apple walking paths of opened itineraries, by itinerary id, then leg index. */
  walkPaths: Readonly<Record<string, Readonly<Record<number, LatLng[]>>>>;
  setWalkPath(id: string, legIndex: number, coords: LatLng[]): void;
}

/** Where you are, resolved from GPS when a plan runs. */
export const HERE: Place = { kind: 'here', name: 'My location', lat: Number.NaN, lng: Number.NaN };

/** A saved place as a journey end: a stop or station keeps its id. */
export const toPlace: (p: SavedPlace) => Place = placeToPlannerPlace;

const PlannerContext = createContext<PlannerContextValue | null>(null);

/** Journey planner query and sheet state, shared by the trip, plan and itinerary sheets. */
export function PlannerProvider({ children }: { children: ReactNode }) {
  const [from, setFrom] = useState<Place>(HERE);
  const [to, setTo] = useState<Place | null>(null);
  const [when, setWhen] = useState<When>({ kind: 'now' });
  // A count, not a flag: `itinerary` can sit over `plan`, and the one
  // underneath must keep the trip pinned when the other closes.
  const [presentedCount, setPresentedCount] = useState(0);
  const [pendingOpen, setPendingOpen] = useState<{ to: Place | null } | null>(null);
  const presented = presentedCount > 0;
  const run = usePlannerEngine({ presented, from, to, when });

  // --- The open itinerary (15/05) ---------------------------------------
  const [open, setOpen] = useState<OpenRef | null>(null);
  const [itineraryDetent, setItineraryDetent] = useState<0 | 1 | 2>(1);
  const [focusLeg, setFocusLeg] = useState<{ index: number; nonce: number } | null>(null);
  const [walkPaths, setWalkPaths] = useState<Record<string, Record<number, LatLng[]>>>({});
  const itineraries = useRef(run.itineraries);
  itineraries.current = run.itineraries;

  const setOpenId = useCallback((id: string | null) => {
    setFocusLeg(null);
    if (id == null) {
      setOpen(null);
      return;
    }
    // Its position too: the fallback if a retime renames it beyond recognition.
    setOpen({ id, index: Math.max(0, itineraries.current.findIndex((it) => it.id === id)) });
    // The sheet opens at its half detent.
    setItineraryDetent(1);
  }, []);

  // The last itinerary shown, so a renamed one can be followed to its successor.
  const [shown, setShown] = useState<Itinerary | null>(null);
  const openItinerary = useMemo(() => resolveOpen(open, shown, run.itineraries), [open, shown, run.itineraries]);
  useEffect(() => {
    if (openItinerary === shown) return;
    setShown(openItinerary);
    if (openItinerary && open && openItinerary.id !== open.id) {
      const index = run.itineraries.indexOf(openItinerary);
      setOpen({ id: openItinerary.id, index: index >= 0 ? index : open.index });
    }
  }, [openItinerary, shown, open, run.itineraries]);

  const focus = useCallback((index: number) => {
    setFocusLeg((f) => ({ index, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);

  const setWalkPath = useCallback((id: string, legIndex: number, coords: LatLng[]) => {
    setWalkPaths((all) => ({ ...all, [id]: { ...all[id], [legIndex]: coords } }));
  }, []);
  // Paths belong to one query's itineraries: a new query starts afresh.
  useEffect(() => {
    setWalkPaths((all) => (Object.keys(all).length === 0 ? all : {}));
  }, [run.key]);

  const swap = useCallback(() => {
    if (!to) return;
    setFrom(to);
    setTo(from);
  }, [from, to]);

  const setPresented = useCallback((on: boolean) => {
    setPresentedCount((n) => Math.max(0, n + (on ? 1 : -1)));
  }, []);

  const requestOpen = useCallback((next?: Place | null) => {
    // A plain open searches afresh; a stale destination would skip the search.
    setTo(next ?? null);
    setPendingOpen({ to: next ?? null });
  }, []);

  const clearPending = useCallback(() => setPendingOpen(null), []);

  const value = useMemo<PlannerContextValue>(
    () => ({
      from,
      to,
      when,
      setFrom,
      setTo,
      setWhen,
      swap,
      presented,
      setPresented,
      pendingOpen,
      requestOpen,
      clearPending,
      run,
      openId: open?.id ?? null,
      setOpenId,
      openItinerary,
      itineraryDetent,
      setItineraryDetent,
      focusLeg,
      focus,
      walkPaths,
      setWalkPath,
    }),
    [
      from,
      to,
      when,
      swap,
      presented,
      setPresented,
      pendingOpen,
      requestOpen,
      clearPending,
      run,
      open,
      setOpenId,
      openItinerary,
      itineraryDetent,
      focusLeg,
      focus,
      walkPaths,
      setWalkPath,
    ],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be used inside <PlannerProvider>');
  return ctx;
}

/**
 * The itinerary open in the `itinerary` sheet, or null. Never empty while
 * the results have one: a retime that renames it follows it to its
 * successor, else to the same position (`resolveOpen`).
 */
export function useOpenItinerary(): Itinerary | null {
  return usePlanner().openItinerary;
}
