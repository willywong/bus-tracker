import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SavedPlace } from '@/hooks/useSettings';

import { addPin, MAX_PINS, placeToPlannerPlace, removePlace, setHome, setWork, type PlaceDraft } from '../saved';

const KLCC: PlaceDraft = { name: 'Suria KLCC', address: 'Jalan Ampang', lat: 3.15798, lng: 101.71204, ref: null };
const LISA: PlaceDraft = {
  name: 'Hotel Lisa De Inn',
  address: null,
  lat: 3.05,
  lng: 101.58,
  ref: { kind: 'stop', id: '1005840' },
};
const SENTRAL: PlaceDraft = {
  name: 'KL Sentral',
  address: null,
  lat: 3.1343,
  lng: 101.6862,
  ref: { kind: 'station', id: 'kl-sentral' },
};

/** Six pins about a kilometre apart along a line. */
function sixPins(): SavedPlace[] {
  let list: SavedPlace[] = [];
  for (let i = 0; i < MAX_PINS; i++) {
    const r = addPin(list, { name: `Pin ${i}`, address: null, lat: 3 + i * 0.01, lng: 101.5, ref: null }, 1000 + i);
    assert.ok(r.ok);
    list = r.list;
  }
  return list;
}

test('home replaces home', () => {
  let list = setWork([], SENTRAL, 1);
  list = setHome(list, KLCC, 2);
  list = setHome(list, LISA, 3);
  assert.deepEqual(
    list.map((p) => [p.id, p.kind, p.name, p.createdAt]),
    [
      ['work', 'work', 'KL Sentral', 1],
      ['home', 'home', 'Hotel Lisa De Inn', 3],
    ],
  );
  assert.deepEqual(list[1]!.ref, { kind: 'stop', id: '1005840' });
  // A pin of the new Home goes.
  const pinned = addPin([], KLCC, 4);
  assert.ok(pinned.ok);
  assert.deepEqual(
    setHome(pinned.list, KLCC, 5).map((p) => p.id),
    ['home'],
  );
});

test('seventh pin is refused', () => {
  const list = sixPins();
  assert.equal(list.length, MAX_PINS);
  assert.deepEqual(addPin(list, KLCC, 9), { ok: false, reason: 'pins-full' });
  // Home and Work don't count towards the six.
  assert.equal(setHome(list, KLCC, 9).length, MAX_PINS + 1);
});

test('duplicate pin is refused', () => {
  const first = addPin([], LISA, 1);
  assert.ok(first.ok);
  // The same stop, even placed elsewhere.
  assert.deepEqual(addPin(first.list, { ...LISA, lat: 3.2, name: 'Lisa' }, 2), { ok: false, reason: 'duplicate' });
  // About 20 m away, with no ref.
  assert.deepEqual(addPin(first.list, { ...KLCC, lat: 3.05018, lng: 101.58 }, 2), { ok: false, reason: 'duplicate' });
  // Your Home is already saved.
  assert.deepEqual(addPin(setHome([], KLCC, 1), KLCC, 2), { ok: false, reason: 'duplicate' });
  // About 110 m away is a different place.
  assert.ok(addPin(first.list, { ...KLCC, lat: 3.051, lng: 101.58 }, 2).ok);
});

test('remove keeps order', () => {
  let list = setHome([], KLCC, 1);
  list = setWork(list, SENTRAL, 2);
  for (const [i, p] of sixPins().entries()) {
    const r = addPin(list, p, 10 + i);
    assert.ok(r.ok);
    list = r.list;
  }
  const ids = list.map((p) => p.id);
  const next = removePlace(list, ids[3]!);
  assert.deepEqual(
    next.map((p) => p.id),
    ids.filter((_, i) => i !== 3),
  );
  assert.deepEqual(removePlace(next, 'nope'), next);
});

test('stop ref becomes a stop place', () => {
  const [home] = setHome([], LISA, 1);
  assert.deepEqual(placeToPlannerPlace(home!), {
    kind: 'stop',
    name: 'Hotel Lisa De Inn',
    lat: 3.05,
    lng: 101.58,
    ref: '1005840',
  });
  const [work] = setWork([], KLCC, 1);
  assert.deepEqual(placeToPlannerPlace(work!), { kind: 'place', name: 'Suria KLCC', lat: 3.15798, lng: 101.71204 });
});
