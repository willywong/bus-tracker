import { haversineMeters } from "../utils/outlier.js";
import { WALKING_METERS_PER_MINUTE } from "../utils/rail.js";
import type { LatLng } from "../utils/route.js";
import type { Place } from "./plan.js";
import type { StopTime } from "./raptor.js";
import type { Candidate } from "./rank.js";
import { DETOUR_FACTOR } from "./transfers.js";

/** Spec §4.1: streets are longer than the straight line. */
export const DETOUR = DETOUR_FACTOR;
/** Spec §4.1: the walk-only option is offered under this many walked metres. */
export const WALK_ONLY_MAX_METERS = 2000;
/** Ends closer than this (straight line) are the same spot: walk-only. */
export const SAME_SPOT_METERS = 50;

/** The walked estimate between two points: the straight line × {@link DETOUR}. */
export function walkedMeters(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b) * DETOUR;
}

/**
 * Seconds to walk `walkedM` (already × {@link DETOUR}) at `metersPerMin`,
 * rounded up. Unlike transfers' `walkSeconds` there is no find-the-stop
 * minute. A pace that is not a finite number > 0 falls back to 80 m/min.
 */
export function accessWalkSeconds(walkedM: number, metersPerMin: number): number {
  const pace = Number.isFinite(metersPerMin) && metersPerMin > 0 ? metersPerMin : WALKING_METERS_PER_MINUTE;
  return Math.ceil(walkedM / (pace / 60));
}

/** Walking the whole way, leaving at `t0`; `null` from {@link WALK_ONLY_MAX_METERS} walked metres up. */
export function walkOnlyCandidate(from: Place, to: Place, t0: number, metersPerMin: number): Candidate | null {
  const meters = Math.round(walkedMeters(from, to));
  if (meters >= WALK_ONLY_MAX_METERS) return null;
  const walkSec = accessWalkSeconds(meters, metersPerMin);
  return { raw: null, leave: t0, arrive: t0 + walkSec, rides: 0, walkSec, walkMeters: meters, firstWaitSec: 0, signature: "walk" };
}

/**
 * True when both ends are one spot, so the walk-only option is the only
 * answer: a stop snapped at both ends (`meters` 0 in `access` and `egress`),
 * or ends under {@link SAME_SPOT_METERS} apart.
 */
export function sameSpot(access: readonly StopTime[], egress: readonly StopTime[], ends: { from: Place; to: Place }): boolean {
  if (haversineMeters(ends.from, ends.to) < SAME_SPOT_METERS) return true;
  for (const a of access) {
    if (a.meters !== 0) continue;
    for (const e of egress) if (e.meters === 0 && e.stop === a.stop) return true;
  }
  return false;
}
