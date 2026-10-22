import type { Place } from '@bus-tracker/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { usePlannerEngine, type PlannerRun } from '@/hooks/usePlannerEngine';
import type { SavedPlace } from '@/hooks/useSettings';

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
  /** The itinerary opened from the results (`Itinerary.id`), for the `itinerary` sheet (15/05). */
  openId: string | null;
  setOpenId(id: string | null): void;
}

/** Where you are, resolved from GPS when a plan runs. */
export const HERE: Place = { kind: 'here', name: 'My location', lat: Number.NaN, lng: Number.NaN };

/** A saved place as a journey end: a stop or station keeps its id. */
export function toPlace(p: SavedPlace): Place {
  return p.ref
    ? { kind: p.ref.kind, name: p.name, lat: p.lat, lng: p.lng, ref: p.ref.id }
    : { kind: 'place', name: p.name, lat: p.lat, lng: p.lng };
}

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
  const [openId, setOpenId] = useState<string | null>(null);
  const presented = presentedCount > 0;
  const run = usePlannerEngine({ presented, from, to, when });

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
      openId,
      setOpenId,
    }),
    [from, to, when, swap, presented, setPresented, pendingOpen, requestOpen, clearPending, run, openId],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be used inside <PlannerProvider>');
  return ctx;
}
