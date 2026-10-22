import { useFocusEffect } from 'expo-router';
import { useCallback, useId, useRef } from 'react';

import { railFocusKey, type RailFocus } from '@/components/rail/railFocus';
import { useTrip } from '@/state/TripContext';

/**
 * Focuses the map on `focus` while the calling screen is focused, and hands
 * it back when the screen blurs or closes (plan 13/05). Each screen claims
 * under its own id, so a station opened over a line takes over and closing
 * it restores the line, whatever order the focus and blur effects run in.
 * Null releases this screen's claim. Re-claims only when the focus's key
 * changes, not on every new object.
 */
export function useRailFocus(focus: RailFocus | null): void {
  const { setRailFocus } = useTrip();
  const owner = useId();
  const key = railFocusKey(focus);
  const latest = useRef(focus);
  latest.current = focus;
  useFocusEffect(
    useCallback(() => {
      setRailFocus(owner, latest.current);
      return () => setRailFocus(owner, null);
      // `key` stands for `focus`; the ref carries the matching object.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owner, key, setRailFocus]),
  );
}
