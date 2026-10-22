import { WALKING_METERS_PER_MINUTE } from "../utils/rail.js";
import { earliestBoardInto } from "./boarding.js";
import { ev } from "./compile.js";
import { TRANSFER_KIND, type TransitNetwork } from "./network.js";
import { FIND_STOP_SECONDS } from "./transfers.js";
import type { Workspace } from "./workspace.js";

/** "Not reached". Safe to add seconds to, and fits an Int32Array. */
export const INF = 0x3fffffff;
/** Rounds, one per ride (3 transfers). */
export const MAX_RIDES = 4;
/** Spec §4.1: a ride → ride change at the same stop. */
export const CHANGE_SEC = 60;
/** What a label came off. Not a const enum: tsx/esbuild transpile per file. */
export const Lbl = { None: 0, Access: 1, Ride: 2, Walk: 3 } as const;

/** An access or egress label: a stop and the walk to or from it. */
export interface StopTime { stop: number; seconds: number; meters: number }

/** Spec §4.1's `earliestBoard` answer. */
export type Boarding = { kind: "trip"; trip: number } | { kind: "freq"; window: number; board: number };

/** One leg of a journey as the pointers hold it; 14/04 recomputes its times forward. */
export type RawLeg =
  | { kind: "access"; stop: number; seconds: number; meters: number }
  | { kind: "ride"; pattern: number; boardPos: number; alightPos: number; trip: number /* -1 = freq */; window: number /* -1 = trip */; boardTime: number }
  | { kind: "walk"; from: number; to: number; seconds: number; transferKind: number };

export interface RoundInput {
  egress: readonly StopTime[];
  /** Rounds to run, at most the workspace's `K` ({@link MAX_RIDES}). */
  maxRides: number;
  /** Per pattern: 1 if it may be ridden (mode filters, excluded feeds). */
  allowed: Uint8Array;
  walkMetersPerMin: number;
}

/** `Workspace.marked` flags. */
const MARK_BOARD = 1;
const MARK_FOOT = 2;

function mark(ws: Workspace, stop: number, flags: number): void {
  if (ws.marked[stop] === 0) ws.markedList[ws.markedCount++] = stop;
  ws.marked[stop] |= flags;
}

/**
 * Transfer `j`'s time at the query's pace. A proximity walk was compiled at
 * 80 m/min plus {@link FIND_STOP_SECONDS} (12/04); its walking part is
 * rescaled. Station and interchange times are fixed.
 */
export function scaledTransferSeconds(net: TransitNetwork, j: number, walkMetersPerMin: number): number {
  const seconds = net.transfers.seconds[j];
  if (net.transfers.kind[j] !== TRANSFER_KIND.walk || walkMetersPerMin === WALKING_METERS_PER_MINUTE) return seconds;
  return Math.ceil(((seconds - FIND_STOP_SECONDS) * WALKING_METERS_PER_MINUTE) / walkMetersPerMin) + FIND_STOP_SECONDS;
}

/**
 * Round 0 of one departure at `dep`: the access labels, marked for round 1.
 * Clears this departure's pruning (`rideStar`, `readyStar`) and marks but
 * keeps every label (rRAPTOR), so range departures must run latest first.
 */
export function startDeparture(ws: Workspace, access: readonly StopTime[], dep: number): void {
  const { tau, arrWalk, lbl, readyStar, marked, markedList } = ws;
  ws.rideStar.fill(INF);
  readyStar.fill(INF);
  for (let i = 0; i < ws.markedCount; i++) marked[markedList[i]] = 0;
  ws.markedCount = 0;
  for (const a of access) {
    const s = a.stop;
    const t = dep + a.seconds;
    if (t < readyStar[s]) readyStar[s] = t;
    if (t < arrWalk[s]) {
      arrWalk[s] = t;
      tau[s] = t;
      lbl[s] = Lbl.Access;
      ws.accSeconds[s] = a.seconds;
      ws.accMeters[s] = Math.round(a.meters);
      mark(ws, s, MARK_BOARD);
    }
  }
}

/**
 * Earliest-arrival RAPTOR rounds `1..maxRides` from the labels
 * {@link startDeparture} set, yielding after each round. Stops early once a
 * round marks nothing to board from.
 *
 * Per round k:
 * 1. queue every allowed pattern through a stop marked to board from, at its
 *    earliest such position;
 * 2. ride each, boarding off round k − 1 (`CHANGE_SEC` after a ride) and
 *    switching to an earlier vehicle downstream when a label there catches one;
 * 3. walk one footpath from each stop a ride improved (never walk → walk);
 * 4. lower `destBest[k..K]` by the egress arrivals.
 *
 * A label must beat this departure's best (`rideStar` / `readyStar`), the
 * round's kept label (rRAPTOR) and `destBest[k]` (target pruning).
 */
export function* runRounds(net: TransitNetwork, ws: Workspace, inp: RoundInput): Generator<void, void> {
  const rounds = Math.min(inp.maxRides, ws.K);
  for (let k = 1; k <= rounds; k++) {
    if (!queueMarked(net, ws, inp.allowed)) return;
    scanPatterns(net, ws, k);
    relaxFootpaths(net, ws, k, inp.walkMetersPerMin);
    settleEgress(ws, k, inp.egress);
    yield;
  }
}

/** Step 1. False when nothing is queued. Clears the marks. */
function queueMarked(net: TransitNetwork, ws: Workspace, allowed: Uint8Array): boolean {
  const { marked, markedList, queuePos, queueList } = ws;
  const { start, len, pattern, pos: srPos } = net.stopRoutes;
  let queued = 0;
  for (let i = 0; i < ws.markedCount; i++) {
    const s = markedList[i];
    const flags = marked[s];
    marked[s] = 0;
    if ((flags & MARK_BOARD) === 0) continue;
    for (let j = start[s], end = j + len[s]; j < end; j++) {
      const p = pattern[j];
      if (!allowed[p]) continue;
      const pos = srPos[j];
      if (queuePos[p] < 0) {
        queuePos[p] = pos;
        queueList[queued++] = p;
      } else if (pos < queuePos[p]) {
        queuePos[p] = pos;
      }
    }
  }
  ws.markedCount = 0;
  ws.queueCount = queued;
  return queued > 0;
}

/** Step 2: traverse every queued pattern. Marks each stop whose ride arrival improved. */
function scanPatterns(net: TransitNetwork, ws: Workspace, k: number): void {
  const { n, tau, arrRide, arrWalk, lbl, rideStar, readyStar, queuePos, queueList, board } = ws;
  const { rPattern, rBoardPos, rAlightPos, rTrip, rWindow, rBoardTime, rFrom, rFromLbl } = ws;
  const { stops, stopStart, stopLen, arr, dep, runOffset, tripLen } = net.patterns;
  const cur = k * n;
  const prev = cur - n;
  const bound = ws.destBest[k];
  const walkLbl = k === 1 ? Lbl.Access : Lbl.Walk;
  for (let q = 0; q < ws.queueCount; q++) {
    const p = queueList[q];
    const pos0 = queuePos[p];
    queuePos[p] = -1;
    const slot = stopStart[p];
    const len = stopLen[p];
    // The vehicle being ridden (see RideState), where and when it was boarded.
    let riding = false;
    let cKind = 0;
    let cTrip = -1;
    let cWindow = -1;
    let cStart = 0;
    let cBoardPos = 0;
    let cBoardTime = 0;
    let cFrom = -1;
    let cFromLbl = 0;
    for (let pos = pos0; pos < len; pos++) {
      const s = stops[slot + pos];
      // Alight. Never back at the boarding stop (a loop such as T816's): it was reached earlier.
      if (riding && s !== cFrom) {
        const a = cKind === 0 ? arr[ev(net, p, cTrip, pos)] : cStart + runOffset[slot + pos];
        const i = cur + s;
        if (a < rideStar[s] && a < arrRide[i] && a < bound) {
          rideStar[s] = a;
          arrRide[i] = a;
          rPattern[i] = p;
          rBoardPos[i] = cBoardPos;
          rAlightPos[i] = pos;
          rTrip[i] = cTrip;
          rWindow[i] = cWindow;
          rBoardTime[i] = cBoardTime;
          rFrom[i] = cFrom;
          rFromLbl[i] = cFromLbl;
          if (a < tau[i]) {
            tau[i] = a;
            lbl[i] = Lbl.Ride;
          }
          let flags = MARK_FOOT;
          if (a + CHANGE_SEC < readyStar[s]) {
            readyStar[s] = a + CHANGE_SEC;
            flags |= MARK_BOARD;
          }
          mark(ws, s, flags);
        }
      }
      if (pos === len - 1) break;
      // Board: can round k − 1's label here catch this or an earlier vehicle?
      const j = prev + s;
      let ready = tau[j];
      if (ready >= INF) continue; // no label
      let fromLbl: number = walkLbl;
      if (lbl[j] === Lbl.Ride) {
        // The ride came first; a walk arriving within CHANGE_SEC after it is ready sooner.
        ready += CHANGE_SEC;
        fromLbl = Lbl.Ride;
        if (arrWalk[j] < ready) {
          ready = arrWalk[j];
          fromLbl = walkLbl;
        }
      }
      let curDep = INF;
      if (riding) {
        curDep = cKind === 0 ? dep[ev(net, p, cTrip, pos)] : cStart + runOffset[slot + pos];
        if (ready > curDep) continue;
      }
      if (!earliestBoardInto(net, p, pos, ready, board, riding && cKind === 0 ? cTrip : tripLen[p]) || board.dep >= curDep) continue;
      riding = true;
      cKind = board.kind;
      cTrip = board.trip;
      cWindow = board.window;
      cStart = board.start;
      cBoardPos = pos;
      cBoardTime = board.dep;
      cFrom = s;
      cFromLbl = fromLbl;
    }
  }
  ws.queueCount = 0;
}

/**
 * Step 3: one footpath from every stop whose ride arrival improved this round
 * (exactly the marks so far), starting from that ride arrival.
 */
function relaxFootpaths(net: TransitNetwork, ws: Workspace, k: number, walkMetersPerMin: number): void {
  const { n, tau, arrRide, arrWalk, lbl, readyStar, markedList, wFrom, wSeconds, wKind } = ws;
  const { start, len, to, seconds, kind } = net.transfers;
  const scaled = walkMetersPerMin !== WALKING_METERS_PER_MINUTE;
  const cur = k * n;
  const bound = ws.destBest[k];
  const rideMarked = ws.markedCount;
  for (let i = 0; i < rideMarked; i++) {
    const from = markedList[i];
    const base = arrRide[cur + from];
    for (let j = start[from], end = j + len[from]; j < end; j++) {
      const sec = scaled ? scaledTransferSeconds(net, j, walkMetersPerMin) : seconds[j];
      const t = base + sec;
      const s = to[j];
      const at = cur + s;
      if (t < readyStar[s] && t < arrWalk[at] && t < arrRide[at] + CHANGE_SEC && t < bound) {
        arrWalk[at] = t;
        readyStar[s] = t;
        wFrom[at] = from;
        wSeconds[at] = sec;
        wKind[at] = kind[j];
        if (t < tau[at]) {
          tau[at] = t;
          lbl[at] = Lbl.Walk;
        }
        mark(ws, s, MARK_BOARD);
      }
    }
  }
}

/** Step 4: `destBest[j]` for every `j ≥ k` is the best egress arrival with ≤ j rides. */
function settleEgress(ws: Workspace, k: number, egress: readonly StopTime[]): void {
  const { tau, destBest } = ws;
  const cur = k * ws.n;
  let best = destBest[k];
  for (const e of egress) {
    const t = tau[cur + e.stop] + e.seconds;
    if (t < best) best = t;
  }
  for (let j = k; j <= ws.K; j++) if (best < destBest[j]) destBest[j] = best;
}

/**
 * The legs behind `tau[k][stop]`, access first. A walk continues from the
 * ride pointer at (k, wFrom); a ride from round k − 1's label of kind
 * `rFromLbl` at its boarding stop. Throws on a chain longer than `2K + 1`
 * legs or an unset label.
 */
export function backtrack(net: TransitNetwork, ws: Workspace, k: number, stop: number): RawLeg[] {
  const { n } = ws;
  const legs: RawLeg[] = [];
  let s = stop;
  let kind: number = ws.lbl[k * n + stop];
  for (;;) {
    if (legs.length > 2 * ws.K) throw new Error(`backtrack: chain longer than ${2 * ws.K + 1} legs at round ${k}, stop ${s}`);
    const i = k * n + s;
    if (kind === Lbl.Access && k === 0 && ws.arrWalk[i] < INF) {
      legs.push({ kind: "access", stop: s, seconds: ws.accSeconds[s], meters: ws.accMeters[s] });
      return legs.reverse();
    }
    if (kind === Lbl.Walk && k > 0 && ws.arrWalk[i] < INF) {
      legs.push({ kind: "walk", from: ws.wFrom[i], to: s, seconds: ws.wSeconds[i], transferKind: ws.wKind[i] });
      s = ws.wFrom[i];
      kind = Lbl.Ride;
    } else if (kind === Lbl.Ride && k > 0 && ws.arrRide[i] < INF) {
      legs.push({
        kind: "ride",
        pattern: ws.rPattern[i],
        boardPos: ws.rBoardPos[i],
        alightPos: ws.rAlightPos[i],
        trip: ws.rTrip[i],
        window: ws.rWindow[i],
        boardTime: ws.rBoardTime[i],
      });
      s = ws.rFrom[i];
      kind = ws.rFromLbl[i];
      k--;
    } else {
      throw new Error(`backtrack: no ${kind === Lbl.None ? "" : "matching "}label at round ${k}, stop ${net.stops.id[s] ?? s}`);
    }
  }
}
