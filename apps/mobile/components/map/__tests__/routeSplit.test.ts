import assert from 'node:assert/strict';
import test from 'node:test';

import { splitRoute } from '@/components/map/routeSplit';

// A straight line east along the equator, 0.001° (~111 m) per vertex.
const line = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: 0, lng: i * 0.001 }));
const at = (x: number) => ({ lat: 0.00001, lng: x * 0.001 });
const lngs = (run: { lng: number }[]) => run.map((p) => Math.round(p.lng * 10000) / 10);

test('bus before your stop: behind, ahead, beyond in order', () => {
  const s = splitRoute(line, at(1.5), at(3.5));
  assert.deepEqual(s.behind.map(lngs), [[0, 1, 1.5]]);
  assert.deepEqual(s.ahead.map(lngs), [[1.5, 2, 3, 3.5]]);
  assert.deepEqual(s.beyond.map(lngs), [[3.5, 4, 5]]);
});

test('bus after your stop on a loop: ahead wraps round, the road behind it stays ink', () => {
  const s = splitRoute(line, at(4.5), at(1.5));
  assert.deepEqual(s.behind.map(lngs), [[1.5, 2, 3, 4, 4.5]]);
  assert.deepEqual(s.ahead.map(lngs), [
    [4.5, 5],
    [0, 1, 1.5],
  ]);
  assert.deepEqual(s.beyond, []);
});

test('no live bus: ink up to your stop, light after it', () => {
  const s = splitRoute(line, null, at(2.5));
  assert.deepEqual(s.behind.map(lngs), [[0, 1, 2, 2.5]]);
  assert.deepEqual(s.ahead, []);
  assert.deepEqual(s.beyond.map(lngs), [[2.5, 3, 4, 5]]);
});

test('no stop: the whole route is plain ink', () => {
  const s = splitRoute(line, at(2), null);
  assert.equal(s.behind.length, 1);
  assert.equal(s.behind[0].length, line.length);
  assert.deepEqual(s.ahead, []);
  assert.deepEqual(s.beyond, []);
});
