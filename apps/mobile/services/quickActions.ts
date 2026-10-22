import type { SavedPlace } from '@/hooks/useSettings';

/** iOS shows up to four dynamic actions under the app icon. */
export const MAX_QUICK_ACTIONS = 4;

/** One home-screen quick action; the same shape as expo-quick-actions' `Action`. */
export interface QuickActionItem {
  id: string;
  title: string;
  subtitle: string | null;
  icon: string;
  params: { href: string; to?: SavedPlaceKind } | { code: string };
}

/** The saved places that get a quick action. */
export type SavedPlaceKind = 'home' | 'work';

/** Where the "Where to?" action lands. */
export const PLAN_HREF = '/plan';

/**
 * Long-press the app icon: "Where to?" first, then Home and Work when they
 * are set ("Directions home"), then "Track T816 · Hotel Lisa De Inn" for
 * favourites in the slots left.
 */
export function buildQuickActionItems({
  favorites,
  stopNames,
  saved,
}: {
  /** Favourite route codes, in the switcher's order. */
  favorites: readonly string[];
  /** Your boarding stop's name per route code, where known. */
  stopNames: Readonly<Record<string, string>>;
  saved: readonly SavedPlace[];
}): QuickActionItem[] {
  const whereTo: QuickActionItem = {
    id: 'where-to',
    title: 'Where to?',
    subtitle: null,
    icon: 'symbol:magnifyingglass',
    params: { href: PLAN_HREF },
  };
  const places: QuickActionItem[] = [];
  if (saved.some((p) => p.kind === 'home')) {
    places.push({
      id: 'plan-home',
      title: 'Home',
      subtitle: 'Directions home',
      icon: 'symbol:house.fill',
      params: { href: PLAN_HREF, to: 'home' },
    });
  }
  if (saved.some((p) => p.kind === 'work')) {
    places.push({
      id: 'plan-work',
      title: 'Work',
      subtitle: 'Directions to work',
      icon: 'symbol:briefcase.fill',
      params: { href: PLAN_HREF, to: 'work' },
    });
  }
  const tracks = favorites.slice(0, trackSlots(saved)).map(
    (code): QuickActionItem => ({
      id: `track-${code}`,
      title: `Track ${code}`,
      subtitle: stopNames[code] || null,
      icon: 'symbol:bus.fill',
      params: { code },
    }),
  );
  return [whereTo, ...places, ...tracks];
}

/** How many favourites get a slot, so the hook only looks up their stops' names. */
export function trackSlots(saved: readonly SavedPlace[]): number {
  const home = saved.some((p) => p.kind === 'home') ? 1 : 0;
  const work = saved.some((p) => p.kind === 'work') ? 1 : 0;
  return MAX_QUICK_ACTIONS - 1 - home - work;
}
