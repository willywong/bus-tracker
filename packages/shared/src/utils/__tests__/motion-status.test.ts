import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMotionStatus } from "../motion-status.js";

const KL_POSITION = { lat: 3.117, lng: 101.6298 };
const SIGNAL_AT_POSITION = [
  { id: 300811866, lat: 3.1172772, lng: 101.6298497 },
];
const SIGNAL_FAR_AWAY = [
  // 300m+ from KL_POSITION
  { id: 999, lat: 3.12, lng: 101.63 },
];

describe("getMotionStatus", () => {
  it("returns null when speed is missing", () => {
    assert.equal(
      getMotionStatus({
        speedKmh: null,
        position: KL_POSITION,
        signals: [],
      }),
      null,
    );
  });

  it("returns null when position is missing", () => {
    assert.equal(
      getMotionStatus({
        speedKmh: 0,
        position: null,
        signals: SIGNAL_AT_POSITION,
      }),
      null,
    );
  });

  it("classifies bus stopped near a signal as 'at-signal'", () => {
    const r = getMotionStatus({
      speedKmh: 0,
      position: KL_POSITION,
      signals: SIGNAL_AT_POSITION,
    });
    assert.equal(r?.kind, "at-signal");
    assert.equal(r?.label, "Stopped at a traffic light");
    assert.equal(r?.nearestSignalId, 300811866);
  });

  it("classifies bus stopped away from any signal as 'stopped'", () => {
    const r = getMotionStatus({
      speedKmh: 0,
      position: KL_POSITION,
      signals: SIGNAL_FAR_AWAY,
    });
    assert.equal(r?.kind, "stopped");
    assert.equal(r?.label, "Stopped");
    assert.equal(r?.nearestSignalId, null);
  });

  it("ignores signal proximity when the bus is moving", () => {
    const r = getMotionStatus({
      speedKmh: 25,
      position: KL_POSITION,
      signals: SIGNAL_AT_POSITION,
    });
    assert.equal(r?.kind, "moving");
    assert.match(r?.label ?? "", /On the move/);
    assert.match(r?.label ?? "", /25 km\/h/);
  });

  it("classifies sub-15 km/h non-stopped as 'slow'", () => {
    const r = getMotionStatus({
      speedKmh: 8,
      position: KL_POSITION,
      signals: [],
    });
    assert.equal(r?.kind, "slow");
    assert.equal(r?.label, "Slow traffic · 8 km/h");
  });

  it("treats 4 km/h as the boundary above 'stopped'", () => {
    const r = getMotionStatus({
      speedKmh: 4,
      position: KL_POSITION,
      signals: SIGNAL_AT_POSITION,
    });
    // 4 is NOT < 4, so bus is 'slow', not 'at-signal'.
    assert.equal(r?.kind, "slow");
  });

  it("treats empty signal list as no signal nearby", () => {
    const r = getMotionStatus({
      speedKmh: 0,
      position: KL_POSITION,
      signals: [],
    });
    assert.equal(r?.kind, "stopped");
  });
});
