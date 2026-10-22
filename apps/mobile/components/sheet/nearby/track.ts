/**
 * What "Track this route" does from a route preview (plan 17/04), decided
 * before touching settings: `addFavorite` reports its result from inside a
 * state updater, so the sheet can't rely on it to pick the next call.
 */
export type TrackPlan =
  /** Already a favourite: switch its stop to this one and make it your route. */
  | { kind: 'already'; code: string; stopId: string }
  /** Add it at this stop, then make it your route. */
  | { kind: 'add'; code: string; stopId: string }
  /** `max` favourites already: say so and offer Settings. */
  | { kind: 'full' };

/**
 * The plan for tracking route `label` from the network stop `networkStopId`.
 * Tracking stores a bus stop by the static database's id, which is the
 * network's own ('kl:1005840', feeder '12000759'), so `stopId` is it as is.
 */
export function trackPlan(
  label: string,
  networkStopId: string,
  favorites: readonly string[],
  max: number,
): TrackPlan {
  const stopId = networkStopId;
  if (favorites.includes(label)) return { kind: 'already', code: label, stopId };
  if (favorites.length >= max) return { kind: 'full' };
  return { kind: 'add', code: label, stopId };
}
