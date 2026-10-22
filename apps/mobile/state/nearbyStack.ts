/**
 * Where you are inside Nearby (plan 17/02): the list of places around you,
 * your bus's full trip view, a bus stop's routes, or a route's preview.
 * A stack, so back returns to where you came from. Never persisted: a
 * relaunch starts at the list.
 */
export type NearbyView =
  | { kind: 'list' }
  | { kind: 'trip' }
  | { kind: 'stop'; key: string }
  | { kind: 'route'; route: number; pattern: number; fromStopIndex: number };

export type NearbyAction = { type: 'push'; view: NearbyView } | { type: 'pop' } | { type: 'reset' };

export const NEARBY_ROOT: readonly NearbyView[] = [{ kind: 'list' }];

/** A stable key per view, for crossfades and scroll resets. */
export function viewKey(v: NearbyView): string {
  switch (v.kind) {
    case 'list':
    case 'trip':
      return v.kind;
    case 'stop':
      return `stop:${v.key}`;
    case 'route':
      return `route:${v.route}:${v.pattern}:${v.fromStopIndex}`;
  }
}

/**
 * The stack's only rules: it is never empty, pop at the root does nothing,
 * and pushing the view already on top does nothing (a double tap opens one
 * view, not two).
 */
export function nearbyStack(stack: readonly NearbyView[], action: NearbyAction): readonly NearbyView[] {
  switch (action.type) {
    case 'push':
      return viewKey(stack[stack.length - 1]) === viewKey(action.view) ? stack : [...stack, action.view];
    case 'pop':
      return stack.length > 1 ? stack.slice(0, -1) : stack;
    case 'reset':
      return stack.length === 1 && stack[0].kind === 'list' ? stack : NEARBY_ROOT;
  }
}
