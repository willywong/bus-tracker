import assert from 'node:assert/strict';
import test from 'node:test';

import { Glider, planGlide, positionAt, stepAt, type MarkerMover } from '@/components/map/glide';

const A = { lat: 3.1, lng: 101.6 };
const B = { lat: 3.1, lng: 101.62 };
const C = { lat: 3.12, lng: 101.62 };

test('glide: each leg gets its share of the time by length', () => {
  const plan = planGlide(
    A,
    [
      { to: B, meters: 300, bearing: 90 },
      { to: C, meters: 100, bearing: 0 },
    ],
    1000,
    4000,
  );
  assert.deepEqual(
    plan.steps.map((s) => [s.startMs, s.endMs]),
    [
      [1000, 4000],
      [4000, 5000],
    ],
  );
  assert.equal(stepAt(plan, 999), 0);
  assert.equal(stepAt(plan, 4000), 1);
  assert.equal(stepAt(plan, 5000), 2);
});

test('glide: the position runs straight along each leg', () => {
  const plan = planGlide(
    A,
    [
      { to: B, meters: 1, bearing: 90 },
      { to: C, meters: 1, bearing: 0 },
    ],
    0,
    2000,
  );
  assert.deepEqual(positionAt(plan, 0), A);
  assert.ok(Math.abs(positionAt(plan, 500).lng - 101.61) < 1e-9);
  assert.deepEqual(positionAt(plan, 1000), B);
  assert.ok(Math.abs(positionAt(plan, 1500).lat - 3.11) < 1e-9);
  assert.deepEqual(positionAt(plan, 9000), C);
});

test('glider: one native move per leg, turning at each corner', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const moves: [number, number, number | undefined][] = [];
  const marker: MarkerMover = {
    animateMarkerToCoordinate: (c, ms) => void moves.push([c.latitude, c.longitude, ms]),
  };
  const glider = new Glider(A, undefined, () => now);
  glider.attach(marker);
  moves.length = 0;
  glider.glide(
    [
      { to: B, meters: 1, bearing: 90 },
      { to: C, meters: 1, bearing: 0 },
    ],
    2000,
  );
  assert.deepEqual(moves, [[B.lat, B.lng, 1000]]);
  assert.equal(glider.heading.get(), 90);
  now = 1000;
  t.mock.timers.tick(1000);
  assert.deepEqual(moves.at(-1), [C.lat, C.lng, 1000]);
  assert.equal(glider.heading.get(), 0);
  assert.deepEqual(glider.target, C);
});

test('glider: a jump ends the glide at once, facing its last leg', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const moves: (number | undefined)[] = [];
  const glider = new Glider(A, undefined, () => 0);
  glider.attach({ animateMarkerToCoordinate: (_c, ms) => void moves.push(ms) });
  glider.glide(
    [
      { to: B, meters: 1, bearing: 90 },
      { to: C, meters: 1, bearing: 0 },
    ],
    2000,
  );
  glider.jump();
  assert.equal(moves.at(-1), 0);
  assert.deepEqual(glider.at(), C);
  assert.equal(glider.heading.get(), 0);
});

test('glider: a marker mounting mid-glide picks up the leg under way', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const glider = new Glider(A, undefined, () => now);
  glider.glide([{ to: B, meters: 1, bearing: 90 }], 2000);
  now = 500;
  const moves: [number, number | undefined][] = [];
  glider.attach({ animateMarkerToCoordinate: (c, ms) => void moves.push([c.longitude, ms]) });
  assert.deepEqual(moves, [[B.lng, 1500]]);
  assert.ok(Math.abs(glider.at().lng - 101.605) < 1e-9);
});
