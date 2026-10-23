import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useSettings } from '@/hooks/useSettings';
import { useNearby, type NearbyView } from '@/state/NearbyContext';
import { useTrip } from '@/state/TripContext';
import { haptics } from '@/utils/haptics';

/**
 * Opens a route's preview in Nearby from a sheet over the map (the search,
 * a station): every sheet above the trip sheet closes, any map selection
 * clears, and back from the preview returns to the Nearby list.
 */
export function useOpenRoutePreview(): (route: Omit<Extract<NearbyView, { kind: 'route' }>, 'kind'>) => void {
  const router = useRouter();
  const { setSheetSection } = useSettings();
  const { reset, push } = useNearby();
  const { select } = useTrip();
  return useCallback(
    (route) => {
      haptics.selection();
      select(null);
      setSheetSection('nearby');
      reset();
      push({ kind: 'route', ...route });
      if (router.canDismiss()) router.dismissAll();
    },
    [router, setSheetSection, reset, push, select],
  );
}
