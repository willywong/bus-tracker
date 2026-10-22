import type { Place } from '@bus-tracker/shared';

import { mins } from '@/components/trip/model';
import type { SavedPlace } from '@/hooks/useSettings';
import type { RecentPlace } from '@/services/places/recents';
import { draftFromPlannerPlace, findSaved } from '@/services/places/saved';
import type { NextBusHomePlan } from '@/widgets/nextBusTimeline';

/**
 * The Plan section's rows (plan 16/03): Home, then Work, then recent
 * destinations you haven't saved. Pure, so the order and the leave-time rule
 * are tested without the sheet.
 */

export type PlanRow =
  | { kind: 'saved'; id: string; place: SavedPlace; title: string; detail: string | null }
  | { kind: 'recent'; id: string; recent: RecentPlace; title: string; detail: string | null }
  | { kind: 'set'; id: 'set-home' | 'set-work'; title: string };

/** Recents under Home and Work. */
export const MAX_PLAN_RECENTS = 5;

/** The widget's home line carries this label when it is for Home. */
const HOME_LABEL = 'Home';

/** "08:40" in Kuala Lumpur, 24-hour; the sheet passes the app's own clock format. */
function clock24(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * "Leave 08:40 · 24 mins" while the last-planned home line is for Home and
 * its leave time is still ahead; otherwise null (the row shows the address).
 */
function leaveDetail(home: NextBusHomePlan | null, now: number, formatClock: (ms: number) => string): string | null {
  if (!home || home.label !== HOME_LABEL) return null;
  if (!Number.isFinite(home.leaveMs) || !Number.isFinite(home.arriveMs)) return null;
  if (home.leaveMs <= now || home.arriveMs < home.leaveMs) return null;
  const ride = Math.round((home.arriveMs - home.leaveMs) / 60_000);
  return `Leave ${formatClock(home.leaveMs)} · ${mins(ride)}`;
}

/** As the planner's saved rows: the address, else the place's own name. */
function savedDetail(p: SavedPlace): string | null {
  return p.address ?? p.name;
}

function recentDetail(r: RecentPlace): string | null {
  if (r.address) return r.address;
  return r.kind === 'stop' ? 'Bus stop' : r.kind === 'station' ? 'Station' : null;
}

/**
 * Home (or "Add Home"), Work (or "Add Work"), then up to five recents. A
 * recent you've already saved (same stop or station, or within 30 m: the
 * Save menu's duplicate rule) is left out.
 */
export function planRows(
  saved: readonly SavedPlace[],
  recents: readonly RecentPlace[],
  home: NextBusHomePlan | null,
  now: number,
  formatClock: (ms: number) => string = clock24,
): PlanRow[] {
  const rows: PlanRow[] = [];
  const homePlace = saved.find((p) => p.kind === 'home') ?? null;
  const workPlace = saved.find((p) => p.kind === 'work') ?? null;

  rows.push(
    homePlace
      ? {
          kind: 'saved',
          id: homePlace.id,
          place: homePlace,
          title: 'Home',
          detail: leaveDetail(home, now, formatClock) ?? savedDetail(homePlace),
        }
      : { kind: 'set', id: 'set-home', title: 'Add Home' },
  );
  rows.push(
    workPlace
      ? { kind: 'saved', id: workPlace.id, place: workPlace, title: 'Work', detail: savedDetail(workPlace) }
      : { kind: 'set', id: 'set-work', title: 'Add Work' },
  );

  let shown = 0;
  for (const r of recents) {
    if (shown >= MAX_PLAN_RECENTS) break;
    if (findSaved(saved, draftFromPlannerPlace(r, r.address ?? null))) continue;
    rows.push({
      kind: 'recent',
      id: `recent:${r.kind}:${r.ref ?? `${r.lat},${r.lng}`}`,
      recent: r,
      title: r.name,
      detail: recentDetail(r),
    });
    shown++;
  }
  return rows;
}

/** A recent as a journey end, without the stored extras. */
export function recentToPlace(r: RecentPlace): Place {
  return r.ref != null
    ? { kind: r.kind, name: r.name, lat: r.lat, lng: r.lng, ref: r.ref }
    : { kind: r.kind, name: r.name, lat: r.lat, lng: r.lng };
}
