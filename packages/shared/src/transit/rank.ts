import { haversineMeters } from "../utils/outlier.js";
import type { TransitNetwork } from "./network.js";
import type { RawLeg } from "./raptor.js";
import type { RawJourney } from "./range.js";
import { DETOUR_FACTOR } from "./transfers.js";

/** Spec §4.2 step 2: options arriving later than this after the fastest are dropped. */
export const SLOWER_CUTOFF_SEC = 1800;
/** "Less walking" must save at least this much over the fastest, so noise earns no tag. */
export const LESS_WALK_MIN_METERS = 100;
/** Latest leave for a timetabled first ride: at the stop at most this long before it departs. */
const AT_STOP_SEC = 60;

type Ride = Extract<RawLeg, { kind: "ride" }>;

/** One option to rank: a raw journey from {@link rangeRaptor}, or the walk-only option (14/03). */
export interface Candidate {
  /** `null` = walk-only. */
  raw: RawJourney | null;
  /** Latest leave from the origin and arrival at the destination, service-day seconds. */
  leave: number;
  arrive: number;
  rides: number;
  /** Access, transfer and egress walks. */
  walkSec: number;
  walkMeters: number;
  /** Wait at the first boarding stop when setting off at `t0`. */
  firstWaitSec: number;
  /** Leg-sequence key, see {@link journeySignature}. */
  signature: string;
}

export interface Ranked {
  cand: Candidate;
  score: number;
  tags: ("fastest" | "fewer-changes" | "less-walking")[];
}

function firstRide(legs: readonly RawLeg[]): Ride | null {
  for (const l of legs) if (l.kind === "ride") return l;
  return null;
}

function accessSeconds(legs: readonly RawLeg[]): number {
  return legs[0]?.kind === "access" ? legs[0].seconds : 0;
}

/**
 * When to leave the origin. A timetabled first ride: as late as still reaches
 * the stop a minute before it departs, but not before the run
 * (`max(run, board − access − 60)`). A headway first ride, or none: the run,
 * since the expected wait of half a headway is part of the model. 14/04 times
 * legs forward from here.
 */
export function latestLeave(_net: TransitNetwork, raw: RawJourney): number {
  const ride = firstRide(raw.legs);
  if (ride === null || ride.trip < 0) return raw.run;
  return Math.max(raw.run, ride.boardTime - accessSeconds(raw.legs) - AT_STOP_SEC);
}

/**
 * The ride legs as `${route label}:${board stop id}>${alight stop id}` joined
 * by `|`, or `walk` with none. Walks are left out, so a re-timed walk keeps
 * the key; 14/04's `signatureFromLegs` must give the same string.
 */
export function journeySignature(net: TransitNetwork, raw: RawJourney | null): string {
  if (raw === null) return "walk";
  const P = net.patterns;
  const parts: string[] = [];
  for (const l of raw.legs) {
    if (l.kind !== "ride") continue;
    const slot = P.stopStart[l.pattern];
    parts.push(`${net.routes.label[P.route[l.pattern]]}:${net.stops.id[P.stops[slot + l.boardPos]]}>${net.stops.id[P.stops[slot + l.alightPos]]}`);
  }
  return parts.length === 0 ? "walk" : parts.join("|");
}

/**
 * A raw journey as a {@link Candidate}. Transfer walks store seconds only, so
 * their metres are the straight line × 1.25.
 */
export function summarize(net: TransitNetwork, raw: RawJourney, t0: number): Candidate {
  let walkSec = raw.egress.seconds;
  let walkMeters = raw.egress.meters;
  let rides = 0;
  for (const l of raw.legs) {
    if (l.kind === "ride") {
      rides++;
    } else {
      walkSec += l.seconds;
      if (l.kind === "access") walkMeters += l.meters;
      else walkMeters += Math.round(transferMeters(net, l.from, l.to));
    }
  }
  const first = firstRide(raw.legs);
  return {
    raw,
    leave: latestLeave(net, raw),
    arrive: raw.arrive,
    rides,
    walkSec,
    walkMeters: Math.round(walkMeters),
    firstWaitSec: first === null ? 0 : Math.max(0, first.boardTime - (t0 + accessSeconds(raw.legs))),
    signature: journeySignature(net, raw),
  };
}

function transferMeters(net: TransitNetwork, a: number, b: number): number {
  const { lat, lon } = net.stops;
  return haversineMeters({ lat: lat[a], lng: lon[a] }, { lat: lat[b], lng: lon[b] }) * DETOUR_FACTOR;
}

/**
 * Keeps each candidate that no other matches or beats on all of (leave later,
 * arrive earlier, fewer rides) while beating it on one. Order is kept.
 */
export function paretoFilter(cands: readonly Candidate[]): Candidate[] {
  return cands.filter(
    (c) =>
      !cands.some(
        (o) =>
          o !== c &&
          o.leave >= c.leave &&
          o.arrive <= c.arrive &&
          o.rides <= c.rides &&
          (o.leave > c.leave || o.arrive < c.arrive || o.rides < c.rides),
      ),
  );
}

/**
 * Spec §4.2, in minutes after `t0`: arrival, 3 per transfer, 1.5 per walk
 * minute beyond 5, and 2 when the first wait is over 15 min.
 */
export function scoreOf(c: Candidate, t0: number): number {
  return (
    (c.arrive - t0) / 60 +
    3 * Math.max(0, c.rides - 1) +
    1.5 * Math.max(0, c.walkSec / 60 - 5) +
    (c.firstWaitSec > 900 ? 2 : 0)
  );
}

type Scored = { cand: Candidate; score: number };

/** Score, then earlier arrival, fewer rides, later leave. */
function byScore(a: Scored, b: Scored): number {
  return a.score - b.score || a.cand.arrive - b.cand.arrive || a.cand.rides - b.cand.rides || b.cand.leave - a.cand.leave;
}

/**
 * Spec §4.2: at most `limit` candidates, the fastest first and the rest by
 * score.
 * 1. Pareto filter; drop arrivals over 30 min after the fastest.
 * 2. One per signature: the fastest, else the lower score, else the later leave.
 * 3. The top `limit` by score, the fastest moved (or added) to the front.
 * 4. The fewest-rides option (never walk-only) and the least-walking option
 *    are guaranteed a slot, and tagged, when they beat the fastest (by
 *    ≥ {@link LESS_WALK_MIN_METERS} for walking). Each replaces the last
 *    pick that is neither the fastest nor already guaranteed.
 */
export function rankCandidates(cands: readonly Candidate[], t0: number, limit = 5): Ranked[] {
  const scored: Scored[] = paretoFilter(cands).map((cand) => ({ cand, score: scoreOf(cand, t0) }));
  if (scored.length === 0 || limit <= 0) return [];

  let fastest = scored[0];
  for (const x of scored) {
    const d = x.cand.arrive - fastest.cand.arrive || x.score - fastest.score || fastest.cand.leave - x.cand.leave;
    if (d < 0) fastest = x;
  }

  const bySignature = new Map<string, Scored>();
  for (const x of scored) {
    if (x.cand.arrive > fastest.cand.arrive + SLOWER_CUTOFF_SEC) continue;
    const y = bySignature.get(x.cand.signature);
    const better = !y || x === fastest || (y !== fastest && (x.score < y.score || (x.score === y.score && x.cand.leave > y.cand.leave)));
    if (better) bySignature.set(x.cand.signature, x);
  }
  const pool = [...bySignature.values()].sort(byScore);

  const picked = pool.slice(0, limit).filter((x) => x !== fastest);
  picked.unshift(fastest);
  if (picked.length > limit) picked.pop();
  const guaranteed = new Set<Scored>([fastest]);
  const guarantee = (x: Scored): boolean => {
    if (!picked.includes(x)) {
      let i = picked.length - 1;
      while (i > 0 && guaranteed.has(picked[i])) i--;
      if (i === 0) return false;
      picked[i] = x;
    }
    guaranteed.add(x);
    return true;
  };

  let fewer: Scored | null = null;
  for (const x of pool) {
    if (x.cand.rides < 1) continue;
    if (!fewer || x.cand.rides < fewer.cand.rides || (x.cand.rides === fewer.cand.rides && x.score < fewer.score)) fewer = x;
  }
  const fewerTag = fewer !== null && fewer.cand.rides < fastest.cand.rides && guarantee(fewer);

  let lessWalk = pool[0];
  for (const x of pool) {
    if (x.cand.walkMeters < lessWalk.cand.walkMeters || (x.cand.walkMeters === lessWalk.cand.walkMeters && x.score < lessWalk.score)) lessWalk = x;
  }
  const walkTag = lessWalk.cand.walkMeters <= fastest.cand.walkMeters - LESS_WALK_MIN_METERS && guarantee(lessWalk);

  const ordered = [fastest, ...picked.slice(1).sort(byScore)];
  return ordered.map((x): Ranked => {
    const tags: Ranked["tags"] = [];
    if (x === fastest) tags.push("fastest");
    if (fewerTag && x === fewer) tags.push("fewer-changes");
    if (walkTag && x === lessWalk) tags.push("less-walking");
    return { cand: x.cand, score: x.score, tags };
  });
}
