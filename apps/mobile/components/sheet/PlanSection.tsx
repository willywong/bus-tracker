import { EmptyState } from '@/components/sheet/NearbySection';

/** The Plan section (plan 16/03 fills it in). */
export function PlanSection({ scheme }: { peek: boolean; scheme: 'light' | 'dark' }) {
  return (
    <EmptyState
      icon="magnifyingglass"
      title="Plan"
      message="Home, Work and your recent trips show up here."
      scheme={scheme}
      compact
    />
  );
}
