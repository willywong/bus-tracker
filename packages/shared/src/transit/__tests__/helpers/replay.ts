import assert from "node:assert/strict";

import { arrAt, depAt } from "../../boarding.js";
import type { TransitNetwork } from "../../network.js";
import { CHANGE_SEC, INF, type RawLeg } from "../../raptor.js";

/**
 * Replays `legs` forward from `dep` (access → … → `stop`), checking every
 * boarding is reachable, and returns the arrival.
 */
export function replay(net: TransitNetwork, legs: RawLeg[], dep: number, stop: number): number {
  const P = net.patterns;
  let t = INF;
  let at = -1;
  let rode = false;
  for (const leg of legs) {
    if (leg.kind === "access") {
      assert.equal(at, -1, "access comes first");
      at = leg.stop;
      t = dep + leg.seconds;
    } else if (leg.kind === "walk") {
      assert.ok(rode, "a walk follows a ride");
      assert.equal(leg.from, at);
      at = leg.to;
      t += leg.seconds;
      rode = false;
    } else {
      assert.equal(P.stops[P.stopStart[leg.pattern] + leg.boardPos], at, "boards where the last leg ended");
      assert.ok(leg.alightPos > leg.boardPos);
      const ride = leg.trip >= 0 ? { kind: 0 as const, trip: leg.trip, window: -1, start: -1 } : freqRide(net, leg);
      assert.equal(depAt(net, leg.pattern, ride, leg.boardPos), leg.boardTime);
      assert.ok(leg.boardTime >= t + (rode ? CHANGE_SEC : 0), `boards at ${leg.boardTime}, ready at ${t}`);
      at = P.stops[P.stopStart[leg.pattern] + leg.alightPos];
      t = arrAt(net, leg.pattern, ride, leg.alightPos);
      rode = true;
    }
  }
  assert.equal(at, stop, "ends at the stop");
  return t;
}
export const freqRide = (net: TransitNetwork, leg: Extract<RawLeg, { kind: "ride" }>) => ({
  kind: 1 as const,
  trip: -1,
  window: leg.window,
  start: leg.boardTime - net.patterns.runOffset[net.patterns.stopStart[leg.pattern] + leg.boardPos],
});
