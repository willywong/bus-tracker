import * as QuickActions from 'expo-quick-actions';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getStopsByIds } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';
import { buildQuickActionItems, MAX_QUICK_ACTIONS, PLAN_HREF } from '@/services/quickActions';
import { usePlanner } from '@/state/PlannerContext';

/**
 * Long-press the app icon → "Where to?", then "Track T816 · Hotel Lisa De
 * Inn" for each favourite. Picking a favourite switches the trip sheet to
 * that route; "Where to?" opens the planner over the trip sheet. Both work
 * on a cold launch.
 */
export function useQuickActions(): void {
  const settings = useSettings();
  const { ready, favoritedRoutes, preferredStopByRoute, savedPlaces, setPreferredRouteCode } =
    settings;
  const { requestOpen } = usePlanner();
  const select = useRef(setPreferredRouteCode);
  select.current = setPreferredRouteCode;
  const open = useRef(requestOpen);
  open.current = requestOpen;

  // Wait for stored settings before applying the launch action, or loading
  // them would overwrite the choice.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready) return;
    const handle = (action: QuickActions.Action) => {
      // The trip sheet opens `plan` once it's on the stack (see trip.tsx).
      if (action.params?.href === PLAN_HREF) {
        open.current();
        return;
      }
      const code = action.params?.code;
      if (typeof code === 'string' && code) select.current(code);
    };
    if (QuickActions.initial) handle(QuickActions.initial);
    const sub = QuickActions.addListener(handle);
    return () => sub.remove();
  }, [ready]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    (async () => {
      // Only the favourites that get a slot need their stop's name.
      const shown = favoritedRoutes.slice(0, MAX_QUICK_ACTIONS - 1);
      const stopNames: Record<string, string> = {};
      try {
        const db = await openDb();
        const ids = shown.flatMap((code) => preferredStopByRoute[code] ?? []);
        const names = new Map<string, string>();
        for (const s of await getStopsByIds(db, ids)) names.set(s.stop_id, formatStopName(s.stop_name));
        for (const code of shown) {
          const name = names.get(preferredStopByRoute[code] ?? '');
          if (name) stopNames[code] = name;
        }
      } catch {
        // Stop names are a nicety; the route code alone still works.
      }
      if (cancelled) return;
      const items = buildQuickActionItems({ favorites: favoritedRoutes, stopNames, saved: savedPlaces });
      await QuickActions.setItems(items).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [favoritedRoutes, preferredStopByRoute, savedPlaces]);
}
