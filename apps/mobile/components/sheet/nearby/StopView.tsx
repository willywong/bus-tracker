import { DetailHeader } from '@/components/trip/SheetHeader';
import { useNearby, type NearbyView } from '@/state/NearbyContext';

/**
 * A bus stop around you, in the sheet: its routes and their next times.
 * Stub until 17/03 fills it.
 */
export function StopView({
  view,
  peek,
}: {
  view: Extract<NearbyView, { kind: 'stop' }>;
  peek: boolean;
  scheme: 'light' | 'dark';
}) {
  const nearby = useNearby();
  const place = nearby.places?.find((p) => p.key === view.key);
  return (
    <DetailHeader
      title={place?.name ?? 'Bus stop'}
      subtitle={null}
      peek={peek}
      onBack={nearby.pop}
      backLabel="Back to around you"
    />
  );
}
