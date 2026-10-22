import { haversineMeters, type Itinerary } from '@bus-tracker/shared';

/**
 * The widget's "Home by 18:14 · leave in 6:00" line (plan 15/07). A widget
 * can't run `plan()` (the network blob and RAPTOR live in the app), so the
 * app plans home while it is open and writes the result ahead as timeline
 * entries. These are the rules for when that plan is redone. Pure: no React
 * Native or Expo imports, so it runs under `tsx --test`.
 */

type Point = { lat: number; lng: number };

/** The plan the widget line came from. */
export interface LastHomePlan {
  /** When it was planned (epoch ms, the app's clock). */
  plannedAt: number;
  /** Where you were. */
  from: Point;
  /** Where Home was, so moving Home plans again. */
  home: Point;
  /** When it says to leave; 0 when it found no way home. */
  leaveMs: number;
}

/** A plan older than this is redone: buses move, and "now" has moved on. */
export const HOME_PLAN_MAX_AGE_MS = 15 * 60_000;
/** Moving this far from where the plan started makes it someone else's walk. */
export const HOME_PLAN_MOVED_M = 500;
/** Closer than this to Home there is nothing to plan. */
export const HOME_NEAR_M = 500;
/** Home moving less than this is the same Home (a re-save of the same spot). */
const HOME_SAME_M = 30;

/**
 * - `plan`: plan home again now.
 * - `keep`: the last plan still stands.
 * - `clear`: no line (no Home, no fix, or you're nearly home).
 */
export type HomePlanDecision = 'plan' | 'keep' | 'clear';

export function shouldReplanHome(
  last: LastHomePlan | null,
  now: number,
  here: Point | null,
  home: Point | null,
): HomePlanDecision {
  if (!home || !here || !finite(home) || !finite(here)) return 'clear';
  if (haversineMeters(here, home) < HOME_NEAR_M) return 'clear';
  if (!last) return 'plan';
  if (haversineMeters(last.home, home) > HOME_SAME_M) return 'plan';
  if (now - last.plannedAt > HOME_PLAN_MAX_AGE_MS) return 'plan';
  // A plan that found no way home waits out its age instead.
  if (last.leaveMs > 0 && last.leaveMs <= now) return 'plan';
  if (haversineMeters(last.from, here) > HOME_PLAN_MOVED_M) return 'plan';
  return 'keep';
}

/**
 * The line for the best itinerary, or null when there is none. Times move
 * from the app's clock to the wall clock the widget reads (`clockOffsetMs`
 * is the dev clock's, 0 in production).
 */
export function homeLineOf(
  it: Itinerary | undefined,
  label: string,
  clockOffsetMs = 0,
): { label: string; leaveMs: number; arriveMs: number } | null {
  if (!it || !Number.isFinite(it.departAt) || !Number.isFinite(it.arriveAt)) return null;
  return { label, leaveMs: it.departAt - clockOffsetMs, arriveMs: it.arriveAt - clockOffsetMs };
}

function finite(p: Point): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}
