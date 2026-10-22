/** The slice of React Navigation state the sheet stack checks. */
export type NavStateLike = { routes?: { name: string; state?: NavStateLike }[] } | undefined;

/**
 * Sheets the trip sheet waits behind. A cold `t816://station/…` builds
 * `[index, station]`; pushing `trip` then would cover the station, so it's
 * presented once these close. `network` is plan 13/06's diagram.
 */
const TRIP_WAITS_FOR = ['station', 'line', 'network'] as const;

/** True when `name` is anywhere in the navigation tree. */
export function containsRoute(state: NavStateLike, name: string): boolean {
  if (!state?.routes) return false;
  return state.routes.some((r) => r.name === name || containsRoute(r.state, name));
}

/** Present the persistent trip sheet: it's missing and no rail sheet is open. */
export function shouldPresentTrip(nav: NavStateLike): boolean {
  if (containsRoute(nav, 'trip')) return false;
  return !TRIP_WAITS_FOR.some((name) => containsRoute(nav, name));
}
