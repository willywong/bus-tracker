import type { BoardOut } from "./boarding.js";
import type { TransitNetwork } from "./network.js";
import { INF, MAX_RIDES } from "./raptor.js";

/**
 * Every array the round engine touches, allocated once per network. Per-round
 * arrays have `K + 1` rows of `n` stops, indexed `k * n + s`. Labels persist
 * between departures until {@link resetWorkspace} (rRAPTOR); the `…Star`
 * arrays and marks are per departure (`startDeparture`).
 *
 * Two arrival labels per (k, s), because transfers are not transitively
 * closed and a change at the same stop costs `CHANGE_SEC`:
 * - `arrRide`: off a ride. Footpaths start only here; boarding again is
 *   ready `CHANGE_SEC` later.
 * - `arrWalk`: off a footpath (round 0: the access walk). Ready to board at
 *   once, never walked on.
 * `tau` is the earlier of the two (the egress label) and `lbl` says which.
 */
export interface Workspace {
  n: number;
  K: number;
  /** (K+1)·n: best arrival with exactly k rides, `min(arrRide, arrWalk)` (INF). */
  tau: Int32Array;
  /** (K+1)·n: ride arrival in round k, with its ride pointer (footpath source). */
  arrRide: Int32Array;
  /** (K+1)·n: walk arrival in round k, with its walk pointer; round 0 holds the access labels. */
  arrWalk: Int32Array;
  /** (K+1)·n: `Lbl` of `tau[k][s]`. */
  lbl: Uint8Array;
  // Ride pointer at (k, s), for `arrRide`: rode pattern `rPattern` from `rFrom`,
  // boarding off the round k − 1 label of kind `rFromLbl` there.
  rPattern: Int32Array;
  rBoardPos: Int32Array;
  rAlightPos: Int32Array;
  /** Trip index within the pattern, or -1 for a window run. */
  rTrip: Int32Array;
  /** Frequency window, or -1 for a trip. */
  rWindow: Int32Array;
  rBoardTime: Int32Array;
  rFrom: Int32Array;
  rFromLbl: Uint8Array;
  // Walk pointer at (k, s), for `arrWalk`: walked from `wFrom`, whose ride pointer is at (k, wFrom).
  wFrom: Int32Array;
  wSeconds: Int32Array;
  wKind: Uint8Array;
  /** n: the access walk behind `arrWalk[0][s]`. */
  accSeconds: Int32Array;
  accMeters: Int32Array;
  /** n: best ride arrival this departure (prunes `arrRide`). */
  rideStar: Int32Array;
  /** n: earliest time this departure could board at s (ride + `CHANGE_SEC`, walk, access); prunes `arrWalk`. */
  readyStar: Int32Array;
  /** n: mark flags of this round (1 = board from it next round, 2 = walk on from its ride arrival). */
  marked: Uint8Array;
  markedList: Int32Array;
  markedCount: number;
  /** Per pattern: earliest queued position, or -1. */
  queuePos: Int32Array;
  queueList: Int32Array;
  queueCount: number;
  /** K+1: best egress arrival with ≤ k rides over the departures run so far (target pruning). */
  destBest: Int32Array;
  /** Scratch answer of `earliestBoardInto`. */
  board: BoardOut;
}

const workspaces = new WeakMap<TransitNetwork, Workspace>();

/**
 * The network's workspace, allocated on first use (~1.7 MB for 6.4k stops).
 * One per network: two plans on one network must not interleave.
 */
export function workspaceFor(net: TransitNetwork): Workspace {
  let ws = workspaces.get(net);
  if (!ws) {
    const n = net.stops.count;
    const K = MAX_RIDES;
    const rows = (K + 1) * n;
    const patterns = net.patterns.count;
    ws = {
      n,
      K,
      tau: new Int32Array(rows),
      arrRide: new Int32Array(rows),
      arrWalk: new Int32Array(rows),
      lbl: new Uint8Array(rows),
      rPattern: new Int32Array(rows),
      rBoardPos: new Int32Array(rows),
      rAlightPos: new Int32Array(rows),
      rTrip: new Int32Array(rows),
      rWindow: new Int32Array(rows),
      rBoardTime: new Int32Array(rows),
      rFrom: new Int32Array(rows),
      rFromLbl: new Uint8Array(rows),
      wFrom: new Int32Array(rows),
      wSeconds: new Int32Array(rows),
      wKind: new Uint8Array(rows),
      accSeconds: new Int32Array(n),
      accMeters: new Int32Array(n),
      rideStar: new Int32Array(n),
      readyStar: new Int32Array(n),
      marked: new Uint8Array(n),
      markedList: new Int32Array(n),
      markedCount: 0,
      queuePos: new Int32Array(patterns),
      queueList: new Int32Array(patterns),
      queueCount: 0,
      destBest: new Int32Array(K + 1),
      board: { kind: 0, trip: -1, window: -1, start: -1, dep: -1 },
    };
    workspaces.set(net, ws);
    resetWorkspace(ws);
  }
  return ws;
}

/**
 * Clears every label: once per plan(), not per range departure. Pointers are
 * left as they are; they are read only behind a set label.
 */
export function resetWorkspace(ws: Workspace): void {
  ws.tau.fill(INF);
  ws.arrRide.fill(INF);
  ws.arrWalk.fill(INF);
  ws.lbl.fill(0);
  ws.rideStar.fill(INF);
  ws.readyStar.fill(INF);
  ws.marked.fill(0);
  ws.markedCount = 0;
  ws.queuePos.fill(-1);
  ws.queueCount = 0;
  ws.destBest.fill(INF);
}
