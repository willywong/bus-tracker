import { UPDATED_MIN_SHIFT_MS, type BusCategory, type Itinerary, type Place, type PlannerFeedRoutes } from '@bus-tracker/shared';

import { serviceDatesFor } from '@/services/transitNetwork';

/**
 * The pure rules behind `usePlannerEngine` (15/04): when a query is the
 * same one, which network it plans on, which rows flash "Updated", and
 * whether live times are paused for budget. Kept out of the hook so they
 * run under `tsx --test`.
 */

export type When = { kind: 'now' } | { kind: 'depart'; at: number };

/** A "Leave now" result older than this is planned again when the sheet reopens. */
export const NOW_RESULTS_MAX_AGE_MS = 2 * 60_000;
/** While the sheet is up, "Leave now" plans again once its first row left this long ago… */
export const NOW_REPLAN_PAST_MS = 30_000;
/** …and at most this often (counted from the last plan). */
export const NOW_REPLAN_MIN_GAP_MS = 60_000;
/** How long a re-timed row says "Updated · was 9:12". */
export const UPDATED_FLASH_MS = 4_000;
/** The loader shows only when `plan()` runs longer than this (spec §7.7). */
export const LOADER_DELAY_MS = 150;

/** A journey end as a key: its stop or station id, else its coordinates to ~1 m. */
export function placeKey(p: Place): string {
  if (p.kind === 'here') return 'here';
  if (p.ref != null && (p.kind === 'stop' || p.kind === 'station')) return `${p.kind}:${p.ref}`;
  return `${p.kind}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** `from|to|when`: "now" for Leave now, else the departure minute. A new key cancels the old run. */
export function queryKey(from: Place, to: Place, when: When): string {
  const w = when.kind === 'now' ? 'now' : String(Math.floor(when.at / 60_000));
  return `${placeKey(from)}|${placeKey(to)}|${w}`;
}

export function departAtOf(when: When, now: number): number {
  return when.kind === 'now' ? now : when.at;
}

/**
 * Which network a departure plans on (the engine needs the network of its
 * service day; the day turns over at 04:00 MYT):
 * - `loaded`: the network in memory (`useTransitNetwork`) is that day's;
 * - `{ date }`: tomorrow's, which is stored but must be loaded;
 * - `null`: outside today and tomorrow, so nothing to plan on.
 */
export function networkFor(departAt: number, loadedDate: string | null, now: number): 'loaded' | { date: string } | null {
  const [want] = serviceDatesFor(departAt);
  if (want === loadedDate) return 'loaded';
  const [today, tomorrow] = serviceDatesFor(now);
  if (want === today || want === tomorrow) return { date: want };
  return null;
}

/**
 * Ids of rows that should flash "Updated · was 9:12": re-timed
 * (`previousArriveAt` set) and arriving at least a minute away from what
 * the row showed before. Rows keep their order across retimes, so they're
 * matched by position (a tail re-plan can change an id).
 */
export function updatedIds(shown: readonly Itinerary[], next: readonly Itinerary[]): string[] {
  const out: string[] = [];
  next.forEach((it, i) => {
    if (it.previousArriveAt == null) return;
    const before = shown[i]?.arriveAt ?? it.previousArriveAt;
    if (Math.abs(it.arriveAt - before) >= UPDATED_MIN_SHIFT_MS) out.push(it.id);
  });
  return out;
}

/** True when a live feed the itineraries need is skipped for budget: their rows stay "Scheduled". */
export function isLiveSkipped(needed: readonly Pick<PlannerFeedRoutes, 'category'>[], skipped: readonly BusCategory[]): boolean {
  return needed.some((f) => skipped.includes(f.category));
}

/** A "Leave now" result is stale on reopen once it's this old. */
export function isStale(when: When, plannedAt: number | null, now: number): boolean {
  return when.kind === 'now' && plannedAt != null && now - plannedAt > NOW_RESULTS_MAX_AGE_MS;
}

/**
 * True when "Leave now" results should be planned again while the sheet is
 * up: the earliest row's leave time is more than {@link NOW_REPLAN_PAST_MS}
 * past, and the last plan is at least {@link NOW_REPLAN_MIN_GAP_MS} old.
 * Walk-only rows leave whenever, so they don't count. The engine asks on
 * its own clock tick, never from a retime.
 */
export function replanDue(
  when: When,
  shown: readonly Pick<Itinerary, 'departAt' | 'rides'>[],
  plannedAt: number | null,
  now: number,
): boolean {
  if (when.kind !== 'now' || plannedAt == null || now - plannedAt < NOW_REPLAN_MIN_GAP_MS) return false;
  let earliest = Number.POSITIVE_INFINITY;
  for (const it of shown) if (it.rides > 0 && it.departAt < earliest) earliest = it.departAt;
  return now - earliest > NOW_REPLAN_PAST_MS;
}
