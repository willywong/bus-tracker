import type { LatLng } from '@bus-tracker/shared';

/**
 * What the map focuses while a rail sheet (`station`, `line`, later
 * `itinerary`) is open: these lines at 100% and the rest at 15%, this
 * station drawn selected, and the camera framing `point` when set.
 */
export interface RailFocus {
  stationId: string | null;
  /** Network route ids (`rail:KJ`, `ktm:KC05_KB18`). */
  routeIds: string[];
  point: LatLng | null;
}

/**
 * Focus claims, oldest first; the last one wins. Each open screen claims
 * under its own owner id and releases only its own claim, so a screen
 * gaining focus and another losing it can run in either order: a station
 * opened over a line takes over, and closing it hands focus back to the
 * line, whichever of the two effects React runs first.
 */
export type RailFocusClaims = readonly { owner: string; focus: RailFocus }[];

export const NO_RAIL_CLAIMS: RailFocusClaims = [];

/** Stable identity of a focus: equal keys frame and draw the same. */
export function railFocusKey(f: RailFocus | null): string | null {
  if (!f) return null;
  const p = f.point ? `${f.point.lat},${f.point.lng}` : '';
  return `${f.stationId ?? ''}|${f.routeIds.join(',')}|${p}`;
}

/** `owner`'s focus moves to the top. Same claims back when nothing changes. */
export function claimRailFocus(
  claims: RailFocusClaims,
  owner: string,
  focus: RailFocus,
): RailFocusClaims {
  const top = claims[claims.length - 1];
  if (top && top.owner === owner && railFocusKey(top.focus) === railFocusKey(focus)) return claims;
  return [...claims.filter((c) => c.owner !== owner), { owner, focus }];
}

/** Drops `owner`'s claim. Same claims back when it had none. */
export function releaseRailFocus(claims: RailFocusClaims, owner: string): RailFocusClaims {
  return claims.some((c) => c.owner === owner) ? claims.filter((c) => c.owner !== owner) : claims;
}

/** The focus in effect: the newest claim. */
export function currentRailFocus(claims: RailFocusClaims): RailFocus | null {
  return claims[claims.length - 1]?.focus ?? null;
}

/**
 * The `RailLayer` focus for what's drawn: the focused ids that are on the
 * map, or null (no dimming) when none are. Without a rail network the
 * bundled lines are keyed by code, so a station's network ids match nothing
 * and every line would otherwise drop to 15%.
 */
export function mapRailFocus(
  focus: RailFocus | null,
  drawnRouteIds: readonly string[],
): readonly string[] | null {
  if (!focus || focus.routeIds.length === 0) return null;
  const drawn = new Set(drawnRouteIds);
  const ids = focus.routeIds.filter((id) => drawn.has(id));
  return ids.length > 0 ? ids : null;
}
