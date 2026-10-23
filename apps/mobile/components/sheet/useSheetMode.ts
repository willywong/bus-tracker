import { sheetMode, type SheetMode } from '@/components/sheet/mode';
import { currentSection, type SheetSection } from '@/components/sheet/sections';
import { useSettings } from '@/hooks/useSettings';
import { useNearby } from '@/state/NearbyContext';
import type { NearbyView } from '@/state/nearbyStack';
import { useRide } from '@/state/RideContext';
import { useTrip } from '@/state/TripContext';

/**
 * What the trip sheet shows (`sheetMode`), read by the sheet and by the map,
 * which puts the sheet up or down for it.
 */
export function useSheetMode(): { mode: SheetMode; section: SheetSection; nearbyView: NearbyView | null } {
  const settings = useSettings();
  const nearby = useNearby();
  const ride = useRide();
  const trip = useTrip();
  const section = currentSection(settings.sheetSection, settings.preferredRouteCode != null);
  // Nearby's own views (17/02) only count while Nearby is the section.
  const nearbyView = section === 'nearby' ? nearby.top : null;
  const mode = sheetMode({
    go: ride.itinerary != null && ride.journey != null && ride.journeyNetwork != null,
    riding: ride.active,
    detail: trip.selection != null,
    nearby: nearbyView?.kind ?? 'list',
  });
  return { mode, section, nearbyView };
}
