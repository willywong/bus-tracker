import type { SavedPlace } from '@/hooks/useSettings';

/** iOS shows up to four dynamic actions under the app icon. */
export const MAX_QUICK_ACTIONS = 4;

/** One home-screen quick action; the same shape as expo-quick-actions' `Action`. */
export interface QuickActionItem {
  id: string;
  title: string;
  subtitle: string | null;
  icon: string;
  params: { href: string } | { code: string };
}

/** Where the "Where to?" action lands. */
export const PLAN_HREF = '/plan';

/**
 * Long-press the app icon: "Where to?" first, then "Track T816 · Hotel Lisa
 * De Inn" for favourites in the slots left. Plan 15/07 adds Home and Work
 * from `saved`.
 */
export function buildQuickActionItems({
  favorites,
  stopNames,
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
  const tracks = favorites.slice(0, MAX_QUICK_ACTIONS - 1).map(
    (code): QuickActionItem => ({
      id: `track-${code}`,
      title: `Track ${code}`,
      subtitle: stopNames[code] || null,
      icon: 'symbol:bus.fill',
      params: { code },
    }),
  );
  return [whereTo, ...tracks];
}
