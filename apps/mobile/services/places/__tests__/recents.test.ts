import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_RECENTS, mergeRecent, parseRecents, type RecentPlace } from '../recents';

const KLCC = { kind: 'place' as const, name: 'Suria KLCC', lat: 3.15798, lng: 101.71204 };
const SENTRAL = { kind: 'station' as const, name: 'KL Sentral', lat: 3.1343, lng: 101.6862, ref: 'kl-sentral' };
const LISA = { kind: 'stop' as const, name: 'Hotel Lisa De Inn', lat: 3.05, lng: 101.58, ref: '1005840' };

test('newest first', () => {
  let list: RecentPlace[] = [];
  list = mergeRecent(list, KLCC, 1);
  list = mergeRecent(list, SENTRAL, 2);
  list = mergeRecent(list, LISA, 3);
  assert.deepEqual(
    list.map((r) => [r.name, r.usedAt]),
    [
      ['Hotel Lisa De Inn', 3],
      ['KL Sentral', 2],
      ['Suria KLCC', 1],
    ],
  );
});

test('dedupes by ref', () => {
  let list = mergeRecent([], SENTRAL, 1);
  list = mergeRecent(list, KLCC, 2);
  // Same station, picked from a slightly different point.
  list = mergeRecent(list, { ...SENTRAL, lat: 3.1349, lng: 101.687 }, 3);
  assert.equal(list.length, 2);
  assert.equal(list[0].ref, 'kl-sentral');
  assert.equal(list[0].usedAt, 3);
  assert.equal(list[1].name, 'Suria KLCC');
});

test('dedupes by rounded coords', () => {
  let list = mergeRecent([], KLCC, 1);
  list = mergeRecent(list, { ...KLCC, name: 'KLCC', lat: 3.15801, lng: 101.71196 }, 2);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'KLCC');
  // Further than 4 dp apart is a different place.
  list = mergeRecent(list, { ...KLCC, lat: 3.1592 }, 3);
  assert.equal(list.length, 2);
});

test('caps at six', () => {
  let list: RecentPlace[] = [];
  for (let i = 0; i < 9; i++) {
    list = mergeRecent(list, { kind: 'place', name: `P${i}`, lat: 3 + i / 100, lng: 101.6 }, i);
  }
  assert.equal(list.length, MAX_RECENTS);
  assert.equal(list[0].name, 'P8');
  assert.equal(list[5].name, 'P3');
});

test('my location is never a recent', () => {
  const list = mergeRecent([], { kind: 'here', name: 'My location', lat: Number.NaN, lng: Number.NaN }, 1);
  assert.deepEqual(list, []);
});

test('parse drops malformed entries and round-trips', () => {
  const list = mergeRecent(mergeRecent([], { ...KLCC, address: 'Kuala Lumpur City Centre' }, 1), SENTRAL, 2);
  const raw = JSON.stringify([...list, { kind: 'here', name: 'x', lat: 1, lng: 1, usedAt: 0 }, { name: 'no kind' }, 7]);
  assert.deepEqual(parseRecents(raw), list);
  assert.deepEqual(parseRecents('not json'), []);
  assert.deepEqual(parseRecents(null), []);
});
