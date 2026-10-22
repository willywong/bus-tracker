import { EmptyState } from '@/components/sheet/NearbySection';

/** The Saved section (plan 16/04 fills it in). */
export function SavedSection({ scheme }: { peek: boolean; scheme: 'light' | 'dark' }) {
  return (
    <EmptyState
      icon="bookmark"
      title="Saved"
      message="Your places and routes show up here."
      scheme={scheme}
      compact
    />
  );
}
