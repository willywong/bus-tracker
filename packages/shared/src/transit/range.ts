import type { TransitNetwork } from "./network.js";
import { backtrack, INF, MAX_RIDES, runRounds, startDeparture, type RawLeg, type RoundInput, type StopTime } from "./raptor.js";
import { resetWorkspace, workspaceFor } from "./workspace.js";

/** Spec §4.1: the range runs `t0 … t0 + 40 min` (plan 14/00's decision kept the full window). */
export const RANGE_WINDOW_SEC = 2400;
/** Spec §4.1: one departure every 2 min. */
export const RANGE_STEP_SEC = 120;

/** One non-dominated journey of the range, backtracked in the run that found it. */
export interface RawJourney {
  /** Access first, then rides and transfer walks; egress is {@link RawJourney.egress}. */
  legs: RawLeg[];
  /** Ride legs in `legs`. */
  rides: number;
  /** The range departure (service-day seconds) whose run found it. */
  run: number;
  /** Arrival at the destination, egress walk included (service-day seconds). */
  arrive: number;
  egress: StopTime;
}

export interface RangeInput {
  access: readonly StopTime[];
  egress: readonly StopTime[];
  /** First departure, service-day seconds. */
  t0: number;
  /** Range width after `t0` (default {@link RANGE_WINDOW_SEC}; 0 = one run at `t0`). */
  windowSec?: number;
  /** Gap between departures (default {@link RANGE_STEP_SEC}). */
  stepSec?: number;
  /** Default and cap {@link MAX_RIDES}. */
  maxRides?: number;
  /** Per pattern: 1 if it may be ridden. */
  allowed: Uint8Array;
  walkMetersPerMin: number;
}

/**
 * rRAPTOR (spec §4.1): RAPTOR at `t0 + windowSec`, then every `stepSec`
 * earlier down to `t0`, keeping labels between runs. Yields after every round
 * and after every run.
 *
 * After each run, a journey with k rides is recorded when its arrival beats
 * every later run's best with ≤ k rides, so the result is the Pareto set over
 * (depart later, arrive earlier, fewer rides). It is backtracked at once: the
 * next, earlier run overwrites the pointers.
 *
 * A strict improvement always belongs to this run. Had its chain boarded its
 * first ride off a label kept from a later run, the same journey would have
 * been feasible from that run, and that run's best with ≤ k rides would
 * already be at least as early.
 */
export function* rangeRaptor(net: TransitNetwork, inp: RangeInput): Generator<void, RawJourney[]> {
  const ws = workspaceFor(net);
  const windowSec = Math.max(0, inp.windowSec ?? RANGE_WINDOW_SEC);
  const stepSec = Math.max(1, inp.stepSec ?? RANGE_STEP_SEC);
  const maxRides = Math.max(0, Math.min(inp.maxRides ?? MAX_RIDES, ws.K));
  const rounds: RoundInput = { egress: inp.egress, maxRides, allowed: inp.allowed, walkMetersPerMin: inp.walkMetersPerMin };
  resetWorkspace(ws);
  // Best arrival with ≤ k rides over the runs so far.
  const bestUpTo = new Int32Array(maxRides + 1).fill(INF);
  const out: RawJourney[] = [];
  for (let d = inp.t0 + windowSec; d >= inp.t0; d -= stepSec) {
    startDeparture(ws, inp.access, d);
    yield* runRounds(net, ws, rounds);
    for (let k = 1; k <= maxRides; k++) {
      const row = k * ws.n;
      let arrive = INF;
      let egress: StopTime | null = null;
      for (const e of inp.egress) {
        const t = ws.tau[row + e.stop] + e.seconds;
        if (t < arrive) {
          arrive = t;
          egress = e;
        }
      }
      if (egress === null || arrive >= bestUpTo[k]) continue;
      const legs = backtrack(net, ws, k, egress.stop);
      let rides = 0;
      for (const l of legs) if (l.kind === "ride") rides++;
      out.push({ legs, rides, run: d, arrive, egress });
      for (let j = k; j <= maxRides; j++) if (arrive < bestUpTo[j]) bestUpTo[j] = arrive;
    }
    yield;
  }
  return out;
}
