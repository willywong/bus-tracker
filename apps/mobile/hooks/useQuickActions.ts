import * as QuickActions from 'expo-quick-actions';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { formatStopName } from '@/components/map/format';
import { openDb } from '@/db/database';
import { getStops } from '@/db/queries';
import { useSettings } from '@/hooks/useSettings';

type TrackAction = QuickActions.Action & { params: { code: string } };

/** iOS shows up to four dynamic actions under the app icon. */
const MAX_ACTIONS = 4;

/**
 * Long-press the app icon → "Track T816 · Hotel Lisa De Inn" for each
 * favourite. Picking one switches the trip sheet to that route, including
 * on a cold launch.
 */
export function useQuickActions(): void {
  const settings = useSettings();
  const { ready, favoritedRoutes, preferredStopByRoute, setPreferredRouteCode } = settings;
  const select = useRef(setPreferredRouteCode);
  select.current = setPreferredRouteCode;

  // Wait for stored settings before applying the launch action, or loading
  // them would overwrite the choice.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready) return;
    const handle = (action: QuickActions.Action) => {
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
      const names = new Map<string, string>();
      try {
        const db = await openDb();
        for (const s of await getStops(db)) names.set(s.stop_id, formatStopName(s.stop_name));
      } catch {
        // Stop names are a nicety; the route code alone still works.
      }
      if (cancelled) return;
      const items: TrackAction[] = favoritedRoutes.slice(0, MAX_ACTIONS).map((code) => {
        const stopId = preferredStopByRoute[code];
        return {
          id: `track-${code}`,
          title: `Track ${code}`,
          subtitle: (stopId && names.get(stopId)) || null,
          icon: 'symbol:bus.fill',
          params: { code },
        };
      });
      await QuickActions.setItems(items).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [favoritedRoutes, preferredStopByRoute]);
}
