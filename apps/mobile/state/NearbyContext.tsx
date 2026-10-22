import type { LatLng, VehiclePosition } from '@bus-tracker/shared';
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';

import { aroundYou, type NearbyPlace } from '@/components/sheet/nearby/model';
import { currentSection } from '@/components/sheet/sections';
import { formatClockHHMM } from '@/components/tracker/logic';
import { useNearbyPosition, type LocationState } from '@/hooks/useNearbyPosition';
import { useSettings } from '@/hooks/useSettings';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { NEARBY_ROOT, nearbyStack, type NearbyView } from '@/state/nearbyStack';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';
import { devNow } from '@/utils/devClock';

export type { NearbyView } from '@/state/nearbyStack';

/** "Next" times in the list are refreshed this often while it's on screen. */
const REFRESH_MS = 60_000;

interface NearbyState {
  /** Never empty; `[{ kind: 'list' }]` at rest. `push`, `pop` and `reset` are its only writers. */
  stack: readonly NearbyView[];
  top: NearbyView;
  push(v: NearbyView): void;
  pop(): void;
  reset(): void;
  /** The last `aroundYou` result; null without location or before the network loads. */
  places: NearbyPlace[] | null;
  here: LatLng | null;
  locationState: LocationState;
  requestLocation(): void;
  /** False until the compiled network is on the phone. */
  networkReady: boolean;
  /** Live buses of the previewed route. The map's preview hook (17/05) is the only writer. */
  previewPositions: VehiclePosition[];
  setPreviewPositions(p: VehiclePosition[]): void;
}

const NearbyContext = createContext<NearbyState | null>(null);

/**
 * Nearby's state (plan 17/02): which view you're on (list, your trip, a
 * stop, a route preview) and the places around you. The stack resets to the
 * list when you leave the Nearby section and when Go or a ride starts.
 */
export function NearbyProvider({ children }: { children: ReactNode }) {
  const [stack, dispatch] = useReducer(nearbyStack, NEARBY_ROOT);
  const top = stack[stack.length - 1];
  const settings = useSettings();
  const trip = useTrip();
  const ride = useRide();
  const { network } = useTransitNetwork();

  const section = currentSection(settings.sheetSection, settings.preferredRouteCode != null);
  const onNearby = section === 'nearby';
  const goOrRide = ride.active || (ride.itinerary != null && ride.journey != null);

  useEffect(() => {
    if (!onNearby || goOrRide) dispatch({ type: 'reset' });
  }, [onNearby, goOrRide]);

  const listShown = onNearby && top.kind === 'list' && trip.selection == null && !goOrRide;
  const { here, locationState, requestLocation } = useNearbyPosition(listShown);

  const [now, setNow] = useState(devNow);
  useEffect(() => {
    if (!listShown) return;
    setNow(devNow());
    const t = setInterval(() => setNow(devNow()), REFRESH_MS);
    return () => clearInterval(t);
  }, [listShown]);

  const tracked = settings.preferredRouteCode != null;
  const yourStopId = tracked ? trip.stopId : null;
  const live = trip.model.source !== 'scheduled';
  const yourLiveNext = tracked && live ? trip.model.compact : null;
  const places = useMemo(
    () =>
      onNearby && locationState === 'granted' && here && network
        ? aroundYou(network, here, now, {
            clock: formatClockHHMM,
            yourStopId,
            yourRouteCode: tracked ? trip.routeCode : null,
            yourLiveNext,
          })
        : null,
    [onNearby, locationState, here, network, now, yourStopId, tracked, trip.routeCode, yourLiveNext],
  );

  const [previewPositions, setPreviewPositions] = useState<VehiclePosition[]>([]);

  const value = useMemo<NearbyState>(
    () => ({
      stack,
      top,
      push: (view) => dispatch({ type: 'push', view }),
      pop: () => dispatch({ type: 'pop' }),
      reset: () => dispatch({ type: 'reset' }),
      places,
      here,
      locationState,
      requestLocation,
      networkReady: network != null,
      previewPositions,
      setPreviewPositions,
    }),
    [stack, top, places, here, locationState, requestLocation, network, previewPositions],
  );

  return <NearbyContext.Provider value={value}>{children}</NearbyContext.Provider>;
}

export function useNearby(): NearbyState {
  const ctx = useContext(NearbyContext);
  if (!ctx) throw new Error('useNearby must be used inside <NearbyProvider>');
  return ctx;
}
