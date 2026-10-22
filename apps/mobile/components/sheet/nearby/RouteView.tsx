import { DetailHeader } from '@/components/trip/SheetHeader';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { useNearby, type NearbyView } from '@/state/NearbyContext';

/**
 * One route from a stop around you, previewed: its countdown, Track this
 * route, Walk there, and its stops onward. Stub until 17/04 fills it.
 */
export function RouteView({
  view,
  peek,
}: {
  view: Extract<NearbyView, { kind: 'route' }>;
  peek: boolean;
  scheme: 'light' | 'dark';
}) {
  const nearby = useNearby();
  const { network } = useTransitNetwork();
  const label = network?.routes.label[view.route];
  return (
    <DetailHeader
      title={label ? `Route ${label}` : 'Route'}
      subtitle={null}
      peek={peek}
      onBack={nearby.pop}
      backLabel="Back to the stop"
    />
  );
}
