import { useEffect, useRef, useState } from 'react';

interface UseRouteTransitionArgs {
  /** Current user-selected route. Null when no bus is favorited. */
  preferredRouteCode: string | null;
  /** Current user-selected boarding stop. Empty string when unset. */
  preferredStopId: string;
  /** Timestamp (epoch ms) of the most recent ETA composition, or null before the first one lands. Used to detect when new data has arrived post-switch. */
  lastComputedAt: number | null;
}

/** Hard ceiling so a slow/failed fetch never leaves the UI stuck shimmering. */
const SAFETY_TIMEOUT_MS = 2000;

/**
 * Returns `true` from the moment the user switches bus/stop until the first
 * ETA composition for the new selection lands (or a 2 s safety timeout fires).
 *
 * Screens use this to render shimmer skeletons across the gap where the old
 * route's data has been invalidated but the new route's data hasn't resolved
 * yet — avoids the jarring "—" / "Waiting" flash.
 */
export function useRouteTransition({
  preferredRouteCode,
  preferredStopId,
  lastComputedAt,
}: UseRouteTransitionArgs): boolean {
  const [transitioning, setTransitioning] = useState(false);
  const sig = `${preferredRouteCode ?? ''}|${preferredStopId}`;
  const prevSigRef = useRef<string | null>(null);
  const switchedAtRef = useRef<number | null>(null);

  useEffect(() => {
    // First render establishes the baseline — no switch has happened yet.
    if (prevSigRef.current === null) {
      prevSigRef.current = sig;
      return;
    }
    if (prevSigRef.current === sig) return;
    prevSigRef.current = sig;
    switchedAtRef.current = Date.now();
    setTransitioning(true);
  }, [sig]);

  // Clear the flag as soon as a fresh composition lands for the new selection.
  useEffect(() => {
    if (!transitioning) return;
    const switchedAt = switchedAtRef.current;
    if (switchedAt == null) return;
    if (lastComputedAt != null && lastComputedAt >= switchedAt) {
      setTransitioning(false);
    }
  }, [transitioning, lastComputedAt]);

  // Safety — never let the shimmer outlive a realistic fetch window.
  useEffect(() => {
    if (!transitioning) return;
    const t = setTimeout(() => setTransitioning(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [transitioning]);

  return transitioning;
}
