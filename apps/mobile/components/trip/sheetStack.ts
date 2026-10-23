/** The slice of React Navigation state the sheet stack checks. */
export type NavStateLike = { routes?: { name: string; state?: NavStateLike }[] } | undefined;

/** True when `name` is anywhere in the navigation tree. */
export function containsRoute(state: NavStateLike, name: string): boolean {
  if (!state?.routes) return false;
  return state.routes.some((r) => r.name === name || containsRoute(r.state, name));
}

/** The route on top: the last one, followed into nested stacks. */
export function topRoute(state: NavStateLike): string | null {
  const last = state?.routes?.[state.routes.length - 1];
  if (!last) return null;
  return topRoute(last.state) ?? last.name;
}

/**
 * Present the trip sheet: it's wanted, missing, and the map is on top. A
 * sheet already up (a cold `t816://station/…`, plan, settings) goes first,
 * so the trip never covers it; it comes up once they close.
 */
export function shouldPresentTrip(nav: NavStateLike, wanted = true): boolean {
  if (!wanted || containsRoute(nav, 'trip')) return false;
  return topRoute(nav) === 'index';
}
