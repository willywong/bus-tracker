import { ev } from "./compile.js";
import type { TransitNetwork } from "./network.js";

/** "Not reached". Safe to add seconds to, and fits an Int32Array. */
export const INF = 0x3fffffff;
/** Spec §4.1: a ride → ride change at the same stop. */
export const CHANGE_SEC = 60;

/** An access or egress label: a stop and the walk to or from it. */
export interface StopTime { stop: number; seconds: number; meters: number }

export interface RaptorProtoOptions {
  /** Range width after `t0` (default 2400 s, the 40-min window). */
  windowSec?: number;
  /** Gap between range departures (default 120 s). */
  stepSec?: number;
  /** Rounds, one per ride (default 4). */
  maxRides?: number;
}

export interface RaptorProtoResult {
  /** Best egress arrival over the range, seconds after service-day midnight; `INF` if none. */
  arrive: number;
  /** Rounds scanned, summed over every range departure. */
  rounds: number;
  /** Range departures run. */
  runs: number;
}

/** Labels and queues, allocated once per call and kept between range departures (rRAPTOR). */
interface State {
  net: TransitNetwork;
  n: number;
  /** `tau[k * n + s]`: best arrival at `s` with exactly `k` rides. */
  tau: Int32Array;
  /** `rode[k * n + s]`: 1 if `tau[k][s]` came off a ride (boarding again costs {@link CHANGE_SEC}). */
  rode: Uint8Array;
  /**
   * Best arrival at a stop over this departure's rounds so far (local
   * pruning). Reset per departure: a label from a later departure may hold
   * more rides, so it cannot prune an earlier round (rRAPTOR keeps `tau` only).
   */
  tauStar: Int32Array;
  marked: Uint8Array;
  markedList: Int32Array;
  markedCount: number;
  /**
   * `rideTau[k * n + s]`: ride arrival at `s` in round `k`, the source of that
   * round's footpaths. Kept apart from `tau` because transfers are not
   * transitively closed: a walk label can beat a ride label in time and still
   * not let you walk on, so a later ride arrival must still seed footpaths.
   */
  rideTau: Int32Array;
  /** Best ride arrival over this departure's rounds so far; reset like `tauStar`. */
  rideStar: Int32Array;
  /** Stops with a new ride arrival this round, whose footpaths are still to relax. */
  footMarked: Uint8Array;
  footList: Int32Array;
  footCount: number;
  /** Earliest queued position per pattern, or -1. */
  queuePos: Int32Array;
  queueList: Int32Array;
  /** Best egress arrival so far (target pruning). */
  best: number;
  rounds: number;
}

/**
 * Prototype earliest-arrival range RAPTOR (plan 14/00), as a generator that
 * yields after each round (drive it with `runSteps`). Departs at `t0 +
 * windowSec`, then every `stepSec` earlier down to `t0`, keeping labels between
 * departures. No journey pointers: it returns only the best egress arrival.
 * Times are seconds after the network's service-day midnight.
 */
export function* raptorProtoSteps(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts: RaptorProtoOptions = {},
): Generator<void, RaptorProtoResult, void> {
  const windowSec = opts.windowSec ?? 2400;
  const stepSec = Math.max(1, opts.stepSec ?? 120);
  const maxRides = opts.maxRides ?? 4;
  const n = net.stops.count;
  const st: State = {
    net,
    n,
    tau: new Int32Array((maxRides + 1) * n).fill(INF),
    rode: new Uint8Array((maxRides + 1) * n),
    tauStar: new Int32Array(n).fill(INF),
    marked: new Uint8Array(n),
    markedList: new Int32Array(n),
    markedCount: 0,
    rideTau: new Int32Array((maxRides + 1) * n).fill(INF),
    rideStar: new Int32Array(n).fill(INF),
    footMarked: new Uint8Array(n),
    footList: new Int32Array(n),
    footCount: 0,
    queuePos: new Int32Array(net.patterns.count).fill(-1),
    queueList: new Int32Array(net.patterns.count),
    best: INF,
    rounds: 0,
  };
  let runs = 0;
  for (let dep = t0 + windowSec; dep >= t0; dep -= stepSec) {
    runs++;
    startRun(st, access, dep);
    for (let k = 1; k <= maxRides; k++) {
      if (!scanRound(st, k)) break;
      relaxFootpaths(st, k);
      settleEgress(st, k, egress);
      yield;
    }
  }
  return { arrive: st.best, rounds: st.rounds, runs };
}

/** {@link raptorProtoSteps} drained in one go: the JS time of one query. */
export function raptorProto(
  net: TransitNetwork,
  access: readonly StopTime[],
  egress: readonly StopTime[],
  t0: number,
  opts?: RaptorProtoOptions,
): RaptorProtoResult {
  const steps = raptorProtoSteps(net, access, egress, t0, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

function mark(st: State, stop: number): void {
  if (st.marked[stop]) return;
  st.marked[stop] = 1;
  st.markedList[st.markedCount++] = stop;
}

/** Round 0 of one range departure: walk to each access stop. */
function startRun(st: State, access: readonly StopTime[], dep: number): void {
  const { tau, rode, tauStar, marked, markedList } = st;
  tauStar.fill(INF);
  st.rideStar.fill(INF);
  // Marks left by the previous departure's last round.
  for (let i = 0; i < st.markedCount; i++) marked[markedList[i]] = 0;
  st.markedCount = 0;
  for (const a of access) {
    const t = dep + a.seconds;
    if (t < tauStar[a.stop]) tauStar[a.stop] = t;
    if (t < tau[a.stop]) {
      tau[a.stop] = t;
      rode[a.stop] = 0;
      mark(st, a.stop);
    }
  }
}

/**
 * Round `k`: queues every pattern through a stop marked in round `k − 1` (from
 * its earliest such position), then scans each. False when nothing is marked.
 */
function scanRound(st: State, k: number): boolean {
  const { net, n, tau, rode, tauStar, rideTau, rideStar, footMarked, footList, marked, markedList, queuePos, queueList } = st;
  const { start: srStart, len: srLen, pattern: srPattern, pos: srPos } = net.stopRoutes;
  let queued = 0;
  for (let i = 0; i < st.markedCount; i++) {
    const stop = markedList[i];
    marked[stop] = 0;
    for (let j = srStart[stop], end = j + srLen[stop]; j < end; j++) {
      const p = srPattern[j];
      const pos = srPos[j];
      if (queuePos[p] < 0) {
        queuePos[p] = pos;
        queueList[queued++] = p;
      } else if (pos < queuePos[p]) {
        queuePos[p] = pos;
      }
    }
  }
  st.markedCount = 0;
  if (queued === 0) return false;
  st.rounds++;

  const P = net.patterns;
  const { stops, stopStart, stopLen, tripLen, arr, dep, freqStart, freqLen, fStart, fEnd, fHeadway, runOffset } = P;
  const prev = (k - 1) * n;
  const cur = k * n;
  for (let q = 0; q < queued; q++) {
    const p = queueList[q];
    const s0 = queuePos[p];
    queuePos[p] = -1;
    const slot = stopStart[p];
    const len = stopLen[p];
    const trips = tripLen[p];
    const w0 = freqStart[p];
    const w1 = w0 + freqLen[p];
    let trip = -1; // timetabled trip being ridden, or -1
    let fStartAt = INF; // frequency run's start at the first stop, or INF
    for (let s = s0; s < len; s++) {
      const stop = stops[slot + s];
      // Alight: the earlier of the trip and the frequency run.
      let a = INF;
      if (trip >= 0) a = arr[ev(net, p, trip, s)];
      if (fStartAt < INF) {
        const f = fStartAt + runOffset[slot + s];
        if (f < a) a = f;
      }
      if (a < rideStar[stop] && a < rideTau[cur + stop] && a < st.best) {
        rideStar[stop] = a;
        rideTau[cur + stop] = a;
        if (!footMarked[stop]) {
          footMarked[stop] = 1;
          footList[st.footCount++] = stop;
        }
        if (a < tauStar[stop] && a < tau[cur + stop]) {
          tau[cur + stop] = a;
          rode[cur + stop] = 1;
          tauStar[stop] = a;
          mark(st, stop);
        }
      }
      // Board: can the previous round's label here catch something earlier?
      if (s === len - 1) continue;
      let ready = tau[prev + stop];
      if (ready >= INF) continue;
      if (rode[prev + stop]) ready += CHANGE_SEC;
      if (trips > 0 && (trip < 0 || dep[ev(net, p, trip, s)] >= ready)) {
        // First trip in [0, hi) departing at or after `ready`; FIFO patterns keep `dep` sorted per stop.
        let lo = 0;
        let hi = trip < 0 ? trips : trip;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (dep[ev(net, p, mid, s)] >= ready) hi = mid;
          else lo = mid + 1;
        }
        if (lo < (trip < 0 ? trips : trip)) trip = lo;
      }
      if (w1 > w0) {
        const r = runOffset[slot + s];
        for (let w = w0; w < w1; w++) {
          const start = Math.max(ready - r, fStart[w]) + (fHeadway[w] >> 1);
          if (start <= fEnd[w] && start < fStartAt) fStartAt = start;
        }
      }
    }
  }
  return true;
}

/**
 * One footpath relaxation from every stop a ride reached in round `k`,
 * starting from the ride arrival, so walks never chain.
 */
function relaxFootpaths(st: State, k: number): void {
  const { net, n, tau, rode, tauStar, rideTau, footMarked, footList } = st;
  const { start, len, to, seconds } = net.transfers;
  const cur = k * n;
  for (let i = 0; i < st.footCount; i++) {
    const from = footList[i];
    footMarked[from] = 0;
    const base = rideTau[cur + from];
    for (let j = start[from], end = j + len[from]; j < end; j++) {
      const t = base + seconds[j];
      const stop = to[j];
      if (t < tauStar[stop] && t < tau[cur + stop] && t < st.best) {
        tau[cur + stop] = t;
        rode[cur + stop] = 0;
        tauStar[stop] = t;
        mark(st, stop);
      }
    }
  }
  st.footCount = 0;
}

function settleEgress(st: State, k: number, egress: readonly StopTime[]): void {
  const cur = k * st.n;
  for (const e of egress) {
    const t = st.tau[cur + e.stop];
    if (t < INF && t + e.seconds < st.best) st.best = t + e.seconds;
  }
}
