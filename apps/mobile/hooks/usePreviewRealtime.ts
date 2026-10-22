import {
  FEED_IDS,
  FEED_INFO,
  rawGtfsId,
  type PlannerFeedRoutes,
  type TransitNetwork,
  type VehiclePosition,
} from '@bus-tracker/shared';
import { useEffect, useMemo } from 'react';

import { plannerStore } from '@/hooks/usePlannerEngine';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useNearby } from '@/state/NearbyContext';

/**
 * Live buses for the route Nearby is previewing (plan 17/05). While a route
 * preview is on top, its route is polled under its own name (`'preview'`),
 * so the planner or Go clearing theirs never drops it, and its vehicles go
 * to `setPreviewPositions` for the map. Any other view releases the route
 * and empties the positions. Mount once, in `app/index.tsx`.
 *
 * Times in the sheet stay scheduled: this only moves buses on the map.
 */
export function usePreviewRealtime(): void {
  const { top, setPreviewPositions } = useNearby();
  const { network } = useTransitNetwork();
  const route = top.kind === 'route' ? top.route : null;
  const feed = useMemo(
    () => (route != null && network ? previewFeedRoutes(network, route) : null),
    [network, route],
  );

  useEffect(() => {
    if (!feed) return;
    const label = feed.routes[0];
    let last: VehiclePosition[] = [];
    plannerStore.start();
    plannerStore.setExtraRoutes('preview', [feed]);
    if (__DEV__) console.log(`[preview] polling ${label} (${feed.category})`);
    // The store notifies on every flag change (refreshing, next refresh);
    // the map only hears about a new set of fixes.
    const read = () => {
      const c = plannerStore.getSnapshot().byCategory[feed.category];
      const next = c ? c.positions.filter((p) => p.routeId === label) : [];
      if (sameFixes(last, next)) return;
      last = next;
      setPreviewPositions(next);
    };
    read();
    const unsubscribe = plannerStore.subscribe(read);
    return () => {
      unsubscribe();
      plannerStore.setExtraRoutes('preview', []);
      plannerStore.stop();
      setPreviewPositions([]);
      if (__DEV__) console.log(`[preview] dropped ${label}`);
    };
  }, [feed, setPreviewPositions]);
}

/**
 * Route `r` as the poller's extra-route entry: its feed's live bus
 * category, with the raw GTFS route id and the label both naming it. Null
 * for a route whose feed has no live bus category (rail, KTM).
 */
function previewFeedRoutes(net: TransitNetwork, r: number): PlannerFeedRoutes | null {
  const category = FEED_INFO[FEED_IDS[net.routes.feed[r]]]?.category;
  if (category !== 'rapid-bus-mrtfeeder' && category !== 'rapid-bus-kl') return null;
  const label = net.routes.label[r];
  return {
    category,
    aliases: new Map([
      [rawGtfsId(net.routes.id[r]), label],
      [label, label],
    ]),
    routes: [label],
  };
}

function sameFixes(a: readonly VehiclePosition[], b: readonly VehiclePosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.vehicleId !== y.vehicleId || x.lat !== y.lat || x.lng !== y.lng || x.bearing !== y.bearing) return false;
  }
  return true;
}
