import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceRide,
  isLoopRoute,
  rideDestinations,
  rideMinutes,
  rideSequence,
  type RideStop,
} from '../model';

// Stops ~500 m apart heading east along the equator-ish line.
const step = 0.0045;
const stop = (i: number): RideStop => ({ stopId: `S${i}`, name: `Stop ${i}`, lat: 3.1, lng: 101.6 + i * step });
const ordered = [0, 1, 2, 3, 4, 5].map(stop);
const at = (i: number, frac = 0) => ({ lat: 3.1, lng: 101.6 + (i + frac) * step });

test('destinations follow the boarding stop; loops end back at the hub', () => {
  assert.deepEqual(rideDestinations(ordered, 'S2', false).map((s) => s.stopId), ['S3', 'S4', 'S5']);
  assert.deepEqual(rideDestinations(ordered, 'S2', true).map((s) => s.stopId), ['S3', 'S4', 'S5', 'S0']);
  assert.deepEqual(rideDestinations(ordered, 'nope', true), []);
});

test('sequence runs from the boarding stop to the destination', () => {
  assert.deepEqual(rideSequence(ordered, 'S1', 'S4', false).map((s) => s.stopId), ['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(rideSequence(ordered, 'S4', 'S0', true).map((s) => s.stopId), ['S4', 'S5', 'S0']);
});

test('counts stops to go and flags the last one', () => {
  const seq = rideSequence(ordered, 'S0', 'S4', false);
  const start = advanceRide(seq, at(0), 0);
  assert.equal(start.stopsToGo, 4);
  assert.equal(start.phase, 'riding');
  assert.equal(start.nextStop?.stopId, 'S1');

  const between = advanceRide(seq, at(2, 0.6), start.passedIndex);
  assert.equal(between.passedIndex, 2);
  assert.equal(between.stopsToGo, 2);

  const nextIsYours = advanceRide(seq, at(3, 0.3), between.passedIndex);
  assert.equal(nextIsYours.phase, 'next-is-yours');
  assert.equal(nextIsYours.nextStop?.stopId, 'S4');

  const arrived = advanceRide(seq, at(4), nextIsYours.passedIndex);
  assert.equal(arrived.phase, 'arrived');
  assert.equal(arrived.stopsToGo, 0);
});

test('approaching a stop has not passed it yet', () => {
  const seq = rideSequence(ordered, 'S0', 'S4', false);
  // 60% of the way from S1 to S2, i.e. nearer S2 but not there.
  assert.equal(advanceRide(seq, at(1, 0.6), 0).passedIndex, 1);
});

test('progress never goes backwards, and no position keeps the last fix', () => {
  const seq = rideSequence(ordered, 'S0', 'S5', false);
  assert.equal(advanceRide(seq, at(0), 3).passedIndex, 3);
  const still = advanceRide(seq, null, 2);
  assert.equal(still.stopsToGo, 3);
  assert.ok(still.remainingMeters > 1400 && still.remainingMeters < 1600);
});

test('minutes and loop detection', () => {
  assert.equal(rideMinutes(0), 0);
  assert.equal(rideMinutes(301), 2);
  assert.equal(isLoopRoute([at(0), at(3), at(0, 0.2)]), true);
  assert.equal(isLoopRoute([at(0), at(3)]), false);
});
